"""Social Media Campaign Generation API (PRD §5 — Module 3)."""
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Response, UploadFile, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import get_current_user, require_editor
from app.db.session import get_db
from app.models.campaign import (
    Campaign,
    CampaignPlatform,
    CampaignStatus,
    Platform,
    Post,
    PostAsset,
    PostImage,
)
from app.models.client import Client
from app.models.user import User
from app.schemas.campaign import (
    CampaignCreate,
    CampaignDetail,
    CampaignListItem,
    CampaignOut,
    CampaignUpdate,
    CanvasUpdate,
    GenerateImageRequest,
    PostAssetOut,
    PostOut,
    PostImageOut,
    PostUpdate,
    PromptUpdate,
    RegenerateRequest,
)
from app.services import audit, storage
from app.services.campaign_gen import generate_posts_copy
from app.services.compositing import composite_post_image
from app.services.export import EXPORTERS
from app.services.extraction import ExtractionError
from app.services.image_gen import generate_image, get_image_model
from app.services.platforms import PLATFORM_SPECS
from app.workers.tasks import generate_campaign, regenerate_platform

router = APIRouter(prefix="/campaigns", tags=["campaigns"])

ALLOWED_ASSET_TYPES = {"image/png", "image/jpeg", "image/svg+xml", "image/webp"}
MAX_ASSET_BYTES = 10 * 1024 * 1024


# --- helpers ---


def _get_campaign_or_404(db: Session, campaign_id: str) -> Campaign:
    campaign = db.get(Campaign, campaign_id)
    if campaign is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Campaign not found")
    return campaign


def _get_image_or_404(db: Session, campaign_id: str, image_id: str) -> PostImage:
    image = db.get(PostImage, image_id)
    if image is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Image slot not found")
    post = db.get(Post, image.post_id)
    if post is None or post.campaign_id != campaign_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Image slot not found")
    return image


# --- platform metadata (literal path declared before /{campaign_id}) ---


@router.get("/platforms")
def platform_specs(_: User = Depends(get_current_user)):
    return [
        {
            "platform": platform.value,
            "label": s.label,
            "char_limit": s.char_limit,
            "aspect_ratios": s.aspect_ratios,
            "formats": [f.value for f in s.formats],
        }
        for platform, s in PLATFORM_SPECS.items()
    ]


# --- campaign CRUD ---


@router.get("", response_model=list[CampaignListItem])
def list_campaigns(
    client_id: str | None = None, db: Session = Depends(get_db), _: User = Depends(get_current_user)
):
    query = select(Campaign).order_by(Campaign.updated_at.desc())
    if client_id:
        query = query.where(Campaign.client_id == client_id)
    return db.scalars(query).all()


@router.post("", response_model=CampaignOut, status_code=status.HTTP_202_ACCEPTED)
def create_campaign(body: CampaignCreate, db: Session = Depends(get_db), actor: User = Depends(require_editor)):
    client = db.get(Client, body.client_id)
    if client is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Client not found")
    if not any(p.is_active for p in body.platforms):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Select at least one active platform")
    if body.generation_mode == "article" and not (body.article_id or body.article_url or body.article_text):
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "Article-to-Content needs a library article, an external URL, or pasted text.",
        )

    campaign = Campaign(
        client_id=client.id,
        name=body.name.strip() or "Untitled campaign",
        objective=body.objective,
        central_theme=body.central_theme,
        content_language=body.content_language,
        creativity_level=body.creativity_level,
        start_date=body.start_date,
        end_date=body.end_date,
        article_id=body.article_id,
        article_url=body.article_url,
        generation_mode=body.generation_mode,
        content_angle=body.content_angle,
        article_text=body.article_text,
        include_article_link=body.include_article_link,
        link_format=body.link_format,
        mention_author=body.mention_author,
        generate_images=body.generate_images,
        status=CampaignStatus.generating,
        created_by=actor.id,
    )
    db.add(campaign)
    db.flush()

    for pc in body.platforms:
        db.add(
            CampaignPlatform(
                campaign_id=campaign.id,
                platform=pc.platform,
                is_active=pc.is_active,
                num_posts=pc.num_posts,
                images_per_post=pc.images_per_post,
                visual_format=pc.visual_format,
                carousel_slides=pc.carousel_slides,
                tone=pc.tone,
                include_cta=pc.include_cta,
                cta_text=pc.cta_text,
                hashtag_count=pc.hashtag_count,
                hashtag_mix=pc.hashtag_mix,
                emojis=pc.emojis,
            )
        )
    db.commit()
    generate_campaign.delay(campaign.id)
    audit.record(db, actor, "campaign.create", "campaign", campaign.id, {"name": campaign.name})
    db.refresh(campaign)
    return campaign


@router.get("/{campaign_id}", response_model=CampaignDetail)
def get_campaign(campaign_id: str, db: Session = Depends(get_db), _: User = Depends(get_current_user)):
    campaign = _get_campaign_or_404(db, campaign_id)
    detail = CampaignDetail.model_validate(campaign)
    posts = db.scalars(
        select(Post).where(Post.campaign_id == campaign_id).order_by(Post.platform, Post.position)
    ).all()
    detail.posts = [PostOut.model_validate(p) for p in posts]
    return detail


@router.get("/{campaign_id}/status", response_model=CampaignOut)
def campaign_status(campaign_id: str, db: Session = Depends(get_db), _: User = Depends(get_current_user)):
    return _get_campaign_or_404(db, campaign_id)


@router.patch("/{campaign_id}", response_model=CampaignOut)
def update_campaign(
    campaign_id: str, body: CampaignUpdate, db: Session = Depends(get_db), actor: User = Depends(require_editor)
):
    campaign = _get_campaign_or_404(db, campaign_id)
    for field, value in body.model_dump(exclude_unset=True).items():
        setattr(campaign, field, value)
    db.commit()
    db.refresh(campaign)
    return campaign


@router.delete("/{campaign_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_campaign(campaign_id: str, db: Session = Depends(get_db), actor: User = Depends(require_editor)):
    campaign = _get_campaign_or_404(db, campaign_id)
    db.delete(campaign)
    db.commit()
    audit.record(db, actor, "campaign.delete", "campaign", campaign_id)


# --- regeneration (PRD §5.6 step 21) ---


@router.post("/{campaign_id}/regenerate", response_model=CampaignOut, status_code=status.HTTP_202_ACCEPTED)
def regenerate_campaign(
    campaign_id: str, body: RegenerateRequest, db: Session = Depends(get_db), actor: User = Depends(require_editor)
):
    campaign = _get_campaign_or_404(db, campaign_id)
    if body.creativity_level is not None:
        campaign.creativity_level = body.creativity_level
    if body.central_theme is not None:
        campaign.central_theme = body.central_theme
    campaign.status = CampaignStatus.generating
    db.commit()
    generate_campaign.delay(campaign_id)
    return campaign


@router.post(
    "/{campaign_id}/platforms/{platform}/regenerate",
    response_model=CampaignOut,
    status_code=status.HTTP_202_ACCEPTED,
)
def regenerate_one_platform(
    campaign_id: str, platform: Platform, db: Session = Depends(get_db), actor: User = Depends(require_editor)
):
    campaign = _get_campaign_or_404(db, campaign_id)
    campaign.status = CampaignStatus.generating
    db.commit()
    regenerate_platform.delay(campaign_id, platform.value)
    return campaign


# --- post copy editing (PRD §5.6 step 21a) ---


@router.patch("/{campaign_id}/posts/{post_id}", response_model=PostOut)
def update_post(
    campaign_id: str,
    post_id: str,
    body: PostUpdate,
    db: Session = Depends(get_db),
    actor: User = Depends(require_editor),
):
    post = db.get(Post, post_id)
    if post is None or post.campaign_id != campaign_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Post not found")
    for field, value in body.model_dump(exclude_unset=True).items():
        setattr(post, field, value)
    db.commit()
    db.refresh(post)
    return post


@router.post("/{campaign_id}/posts/{post_id}/regenerate", response_model=PostOut)
def regenerate_post(
    campaign_id: str, post_id: str, db: Session = Depends(get_db), actor: User = Depends(require_editor)
):
    """Synchronously regenerate the copy of a single post (keeps its image slots)."""
    campaign = _get_campaign_or_404(db, campaign_id)
    post = db.get(Post, post_id)
    if post is None or post.campaign_id != campaign_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Post not found")
    client = db.get(Client, campaign.client_id)
    cp = db.scalar(
        select(CampaignPlatform).where(
            CampaignPlatform.campaign_id == campaign_id, CampaignPlatform.platform == post.platform
        )
    )
    if client is None or cp is None:
        raise HTTPException(status.HTTP_409_CONFLICT, "Campaign platform configuration missing")

    from app.services.campaign_gen import build_context, generate_article_posts_copy, resolve_article

    article = resolve_article(db, campaign)
    context = build_context(db, client, campaign, article["text"])
    original = cp.num_posts
    cp.num_posts = 1
    try:
        if campaign.generation_mode == "article":
            data = generate_article_posts_copy(db, client, campaign, cp, context, article)[0]
        else:
            data = generate_posts_copy(db, client, campaign, cp, context)[0]
    except ExtractionError as exc:
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, str(exc))
    finally:
        cp.num_posts = original

    post.headline = data["headline"]
    post.copy = data["copy"]
    post.cta = data["cta"]
    post.hashtags = data["hashtags"]
    post.best_time = data["best_time"]
    post.rationale = data["rationale"]
    db.commit()
    db.refresh(post)
    return post


# --- image prompts (PRD §5.5.3) ---


@router.patch("/{campaign_id}/images/{image_id}/prompt", response_model=PostImageOut)
def update_image_prompt(
    campaign_id: str,
    image_id: str,
    body: PromptUpdate,
    db: Session = Depends(get_db),
    actor: User = Depends(require_editor),
):
    image = _get_image_or_404(db, campaign_id, image_id)
    changes = body.model_dump(exclude_unset=True)
    # Snapshot the current prompt before overwriting so the user can restore it.
    if "prompt" in changes or "negative_prompt" in changes:
        history = list(image.prompt_history)
        history.append({
            "prompt": image.prompt,
            "negative_prompt": image.negative_prompt,
            "created_at": datetime.now(timezone.utc).isoformat(),
        })
        image.prompt_history = history
    for field, value in changes.items():
        setattr(image, field, value)
    db.commit()
    db.refresh(image)
    return image


@router.post("/{campaign_id}/images/{image_id}/restore-prompt/{index}", response_model=PostImageOut)
def restore_prompt(
    campaign_id: str, image_id: str, index: int, db: Session = Depends(get_db), actor: User = Depends(require_editor)
):
    image = _get_image_or_404(db, campaign_id, image_id)
    if index < 0 or index >= len(image.prompt_history):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "No such prompt version")
    version = image.prompt_history[index]
    image.prompt = version.get("prompt", image.prompt)
    image.negative_prompt = version.get("negative_prompt", image.negative_prompt)
    db.commit()
    db.refresh(image)
    return image


# --- image generation (PRD §5.5.4) ---


@router.post("/{campaign_id}/images/{image_id}/generate", response_model=PostImageOut)
def generate_slot_image(
    campaign_id: str,
    image_id: str,
    body: GenerateImageRequest,
    db: Session = Depends(get_db),
    actor: User = Depends(require_editor),
):
    image = _get_image_or_404(db, campaign_id, image_id)
    model = get_image_model(db, body.image_model_id)
    prompt = image.prompt
    if image.additional_guidance:
        prompt = f"{prompt}\n\nAdditional guidance: {image.additional_guidance}"
    try:
        data, content_type = generate_image(db, model, prompt, image.negative_prompt, image.aspect_ratio)
    except ExtractionError as exc:
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, str(exc))

    version = len(image.generation_history) + 1
    key = f"campaigns/{campaign_id}/images/{image_id}/v{version}.png"
    storage.upload_object(key, data, content_type)

    history = list(image.generation_history)
    history.append({
        "object_key": key,
        "prompt": prompt,
        "created_at": datetime.now(timezone.utc).isoformat(),
    })
    image.generation_history = history
    image.base_object_key = key
    image.is_uploaded = False
    image.image_model_id = model.id
    image.composited_object_key = ""  # base changed; previous composite is stale
    db.commit()
    db.refresh(image)
    audit.record(db, actor, "campaign.image_generate", "campaign", campaign_id, {"image_id": image_id})
    return image


@router.post("/{campaign_id}/images/{image_id}/upload", response_model=PostImageOut)
def upload_slot_image(
    campaign_id: str,
    image_id: str,
    file: UploadFile,
    db: Session = Depends(get_db),
    actor: User = Depends(require_editor),
):
    image = _get_image_or_404(db, campaign_id, image_id)
    if file.content_type not in {"image/png", "image/jpeg", "image/webp"}:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Image must be PNG, JPG, or WebP")
    data = file.file.read()
    if len(data) > MAX_ASSET_BYTES:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Image must be 10 MB or smaller")
    key = f"campaigns/{campaign_id}/images/{image_id}/uploaded.png"
    storage.upload_object(key, data, file.content_type)
    image.base_object_key = key
    image.is_uploaded = True
    image.composited_object_key = ""
    db.commit()
    db.refresh(image)
    return image


@router.get("/{campaign_id}/images/{image_id}/base")
def get_base_image(
    campaign_id: str, image_id: str, db: Session = Depends(get_db), _: User = Depends(get_current_user)
):
    image = _get_image_or_404(db, campaign_id, image_id)
    if not image.base_object_key:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "No image generated yet")
    data, content_type = storage.get_object(image.base_object_key)
    return Response(content=data, media_type=content_type)


@router.get("/{campaign_id}/images/{image_id}/composite")
def get_composite_image(
    campaign_id: str, image_id: str, db: Session = Depends(get_db), _: User = Depends(get_current_user)
):
    image = _get_image_or_404(db, campaign_id, image_id)
    if not image.base_object_key:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "No image generated yet")
    campaign = _get_campaign_or_404(db, campaign_id)
    client = db.get(Client, campaign.client_id)
    try:
        data = composite_post_image(db, image, client)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status.HTTP_500_INTERNAL_SERVER_ERROR, f"Compositing failed: {exc}")
    key = f"campaigns/{campaign_id}/images/{image_id}/composite.png"
    storage.upload_object(key, data, "image/png")
    image.composited_object_key = key
    db.commit()
    return Response(content=data, media_type="image/png")


@router.put("/{campaign_id}/images/{image_id}/canvas", response_model=PostImageOut)
def save_canvas(
    campaign_id: str,
    image_id: str,
    body: CanvasUpdate,
    db: Session = Depends(get_db),
    actor: User = Depends(require_editor),
):
    image = _get_image_or_404(db, campaign_id, image_id)
    image.canvas_state = body.canvas_state
    image.composited_object_key = ""  # canvas changed; re-composite on next export/preview
    db.commit()
    db.refresh(image)
    return image


# --- custom assets (PRD §5.5.2) ---


@router.get("/{campaign_id}/assets", response_model=list[PostAssetOut])
def list_assets(campaign_id: str, db: Session = Depends(get_db), _: User = Depends(get_current_user)):
    _get_campaign_or_404(db, campaign_id)
    return db.scalars(
        select(PostAsset).where(PostAsset.campaign_id == campaign_id).order_by(PostAsset.created_at)
    ).all()


@router.post("/{campaign_id}/assets", response_model=PostAssetOut, status_code=status.HTTP_201_CREATED)
def upload_asset(
    campaign_id: str, file: UploadFile, db: Session = Depends(get_db), actor: User = Depends(require_editor)
):
    _get_campaign_or_404(db, campaign_id)
    if file.content_type not in ALLOWED_ASSET_TYPES:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Asset must be PNG, JPG, SVG, or WebP")
    data = file.file.read()
    if len(data) > MAX_ASSET_BYTES:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Asset must be 10 MB or smaller")
    asset = PostAsset(
        campaign_id=campaign_id,
        object_key="",
        filename=file.filename or "asset",
        content_type=file.content_type,
        created_by=actor.id,
    )
    db.add(asset)
    db.flush()
    key = f"campaigns/{campaign_id}/assets/{asset.id}"
    storage.upload_object(key, data, file.content_type)
    asset.object_key = key
    db.commit()
    db.refresh(asset)
    return asset


@router.get("/{campaign_id}/assets/{asset_id}/file")
def get_asset_file(
    campaign_id: str, asset_id: str, db: Session = Depends(get_db), _: User = Depends(get_current_user)
):
    asset = db.get(PostAsset, asset_id)
    if asset is None or asset.campaign_id != campaign_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Asset not found")
    data, content_type = storage.get_object(asset.object_key)
    return Response(content=data, media_type=content_type)


@router.delete("/{campaign_id}/assets/{asset_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_asset(
    campaign_id: str, asset_id: str, db: Session = Depends(get_db), actor: User = Depends(require_editor)
):
    asset = db.get(PostAsset, asset_id)
    if asset is None or asset.campaign_id != campaign_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Asset not found")
    db.delete(asset)
    db.commit()


# --- export (PRD §5.7) ---


@router.get("/{campaign_id}/export")
def export_campaign(
    campaign_id: str,
    format: str = "zip",
    db: Session = Depends(get_db),
    actor: User = Depends(require_editor),
):
    campaign = _get_campaign_or_404(db, campaign_id)
    client = db.get(Client, campaign.client_id)
    exporter = EXPORTERS.get(format)
    if exporter is None:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Format must be one of: zip, pdf, json, csv")
    data, filename, content_type = exporter(db, campaign, client)
    audit.record(db, actor, "campaign.export", "campaign", campaign_id, {"format": format})
    return Response(
        content=data,
        media_type=content_type,
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
