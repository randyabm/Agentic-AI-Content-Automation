"""Social Media Campaign Generation API (PRD §5 — Module 3)."""
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Response, UploadFile, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import get_current_user, require_editor
from app.db.session import get_db
from app.models.campaign import (
    Campaign,
    CampaignElement,
    CampaignPlatform,
    CampaignStatus,
    Platform,
    Post,
    PostAsset,
    PostImage,
    PostVideo,
    ReferenceImage,
    VideoStatus,
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
    ElementOut,
    GenerateImageRequest,
    GenerateVideoRequest,
    LogoToggle,
    PostAssetOut,
    PostOut,
    PostImageOut,
    PostUpdate,
    ReferenceImageOut,
    PostVideoCreate,
    PostVideoOut,
    PromptUpdate,
    RegenerateRequest,
)
from app.services import audit, storage
from app.services.campaign_gen import generate_platform_copy
from app.services.compositing import composite_post_image
from app.services.export import EXPORTERS
from app.services.extraction import ExtractionError
from app.services.image_gen import generate_image, get_image_model
from app.services.platforms import PLATFORM_SPECS, resolve_platform_ratios
from app.workers.tasks import (
    derive_video_ratios,
    generate_campaign,
    regenerate_platform,
    run_image_generation,
    run_video_generation,
)

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
    element = db.get(CampaignElement, image.element_id)
    if element is None or element.campaign_id != campaign_id:
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
    campaigns = db.scalars(query).all()

    # Campaigns with any image/video still rendering (so the list can show a
    # "generating visuals" hint even after the campaign itself is ready).
    img_ids = db.scalars(
        select(CampaignElement.campaign_id)
        .join(PostImage, PostImage.element_id == CampaignElement.id)
        .where(PostImage.status == VideoStatus.generating)
    ).all()
    vid_ids = db.scalars(
        select(CampaignElement.campaign_id)
        .join(PostVideo, PostVideo.element_id == CampaignElement.id)
        .where(PostVideo.status == VideoStatus.generating)
    ).all()
    generating = set(img_ids) | set(vid_ids)

    return [
        CampaignListItem(
            id=c.id,
            client_id=c.client_id,
            name=c.name,
            objective=c.objective,
            status=c.status,
            created_at=c.created_at,
            updated_at=c.updated_at,
            visuals_generating=c.id in generating,
        )
        for c in campaigns
    ]


@router.post("", response_model=CampaignOut, status_code=status.HTTP_202_ACCEPTED)
def create_campaign(body: CampaignCreate, db: Session = Depends(get_db), actor: User = Depends(require_editor)):
    client = db.get(Client, body.client_id)
    if client is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Client not found")
    if not any(el.platforms for el in body.elements):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Every element needs at least one platform")
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

    for position, el in enumerate(body.elements):
        platforms = list(dict.fromkeys(el.platforms))
        db.add(
            CampaignElement(
                campaign_id=campaign.id,
                position=position,
                element_type=el.element_type,
                theme=el.theme,
                platforms=[p.value for p in platforms],
                platform_ratios=resolve_platform_ratios(platforms, el.ratio_overrides),
                carousel_slides=el.carousel_slides,
                video_duration_seconds=el.video_duration_seconds,
            )
        )

    # One settings row per platform used by any element; explicit settings win.
    settings_by_platform = {pc.platform: pc for pc in body.platforms}
    used = list(dict.fromkeys(p for el in body.elements for p in el.platforms))
    for platform in used:
        pc = settings_by_platform.get(platform)
        db.add(
            CampaignPlatform(
                campaign_id=campaign.id,
                platform=platform,
                is_active=pc.is_active if pc else True,
                tone=pc.tone if pc else "",
                include_cta=pc.include_cta if pc else True,
                cta_text=pc.cta_text if pc else "",
                hashtag_count=pc.hashtag_count if pc else 5,
                hashtag_mix=pc.hashtag_mix if pc else {"branded": 40, "trending": 30, "niche": 30},
                emojis=pc.emojis if pc else "moderate",
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
    detail.elements = [ElementOut.model_validate(el) for el in campaign.elements]
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
    element = db.get(CampaignElement, post.element_id) if post.element_id else None
    if client is None or cp is None or element is None:
        raise HTTPException(status.HTTP_409_CONFLICT, "Campaign platform configuration missing")

    from app.services.campaign_gen import build_context, resolve_article

    article = resolve_article(db, campaign)
    context = build_context(db, client, campaign, article["text"])
    try:
        data = generate_platform_copy(db, client, campaign, cp, [element], context, article)[0]
    except ExtractionError as exc:
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, str(exc))

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
    if image.status == VideoStatus.generating:
        raise HTTPException(status.HTTP_409_CONFLICT, "This image is already being generated.")
    # Validate the model now so a misconfiguration fails fast, then run async in Celery.
    try:
        model = get_image_model(db, body.image_model_id)
    except ExtractionError as exc:
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, str(exc))
    image.status = VideoStatus.generating
    image.error = ""
    db.commit()
    db.refresh(image)
    run_image_generation.delay(image_id, body.image_model_id or model.id)
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
    image.status = VideoStatus.ready
    image.error = ""
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


@router.patch("/{campaign_id}/images/{image_id}/logo", response_model=PostImageOut)
def toggle_image_logo(
    campaign_id: str,
    image_id: str,
    body: LogoToggle,
    db: Session = Depends(get_db),
    _: User = Depends(require_editor),
):
    """Show or hide the client logo on this image (logo is included by default)."""
    image = _get_image_or_404(db, campaign_id, image_id)
    state = dict(image.canvas_state or {})
    state["logo_enabled"] = body.enabled
    image.canvas_state = state
    image.composited_object_key = ""  # re-composite with/without the logo
    db.commit()
    db.refresh(image)
    return image


# --- videos (provider-abstracted generation; key configured later by an Admin) ---


def _get_video_or_404(db: Session, campaign_id: str, video_id: str) -> PostVideo:
    video = db.get(PostVideo, video_id)
    if video is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Video slot not found")
    element = db.get(CampaignElement, video.element_id)
    if element is None or element.campaign_id != campaign_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Video slot not found")
    return video


@router.post(
    "/{campaign_id}/elements/{element_id}/videos",
    response_model=PostVideoOut,
    status_code=status.HTTP_201_CREATED,
)
def create_video_slot(
    campaign_id: str,
    element_id: str,
    body: PostVideoCreate,
    db: Session = Depends(get_db),
    actor: User = Depends(require_editor),
):
    element = db.get(CampaignElement, element_id)
    if element is None or element.campaign_id != campaign_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Element not found")
    prompt = body.prompt.strip()
    if not prompt and element.images:
        # Seed the video prompt from the element's first image prompt — same visual concept in motion.
        prompt = element.images[0].prompt
    video = PostVideo(
        element_id=element.id,
        aspect_ratio=body.aspect_ratio,
        duration_seconds=body.duration_seconds,
        prompt=prompt,
    )
    db.add(video)
    db.commit()
    db.refresh(video)
    return video


@router.patch("/{campaign_id}/videos/{video_id}/prompt", response_model=PostVideoOut)
def update_video_prompt(
    campaign_id: str,
    video_id: str,
    body: PromptUpdate,
    db: Session = Depends(get_db),
    actor: User = Depends(require_editor),
):
    video = _get_video_or_404(db, campaign_id, video_id)
    changes = body.model_dump(exclude_unset=True)
    changes.pop("additional_guidance", None)  # image-only field
    if "prompt" in changes or "negative_prompt" in changes:
        history = list(video.prompt_history)
        history.append({
            "prompt": video.prompt,
            "negative_prompt": video.negative_prompt,
            "created_at": datetime.now(timezone.utc).isoformat(),
        })
        video.prompt_history = history
    for field, value in changes.items():
        setattr(video, field, value)
    db.commit()
    db.refresh(video)
    return video


@router.post(
    "/{campaign_id}/videos/{video_id}/generate",
    response_model=PostVideoOut,
    status_code=status.HTTP_202_ACCEPTED,
)
def generate_slot_video(
    campaign_id: str,
    video_id: str,
    body: GenerateVideoRequest,
    db: Session = Depends(get_db),
    actor: User = Depends(require_editor),
):
    """Queue async video generation (providers take minutes; the slot tracks status)."""
    video = _get_video_or_404(db, campaign_id, video_id)
    if video.status == VideoStatus.generating:
        raise HTTPException(status.HTTP_409_CONFLICT, "This video is already being generated")
    if not video.prompt.strip():
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Write a video prompt first")
    if body.video_model_id:
        video.video_model_id = body.video_model_id
    video.status = VideoStatus.generating
    video.error = ""
    db.commit()
    run_video_generation.delay(video.id)
    audit.record(db, actor, "campaign.video_generate", "campaign", campaign_id, {"video_id": video_id})
    db.refresh(video)
    return video


@router.post("/{campaign_id}/videos/{video_id}/derive-ratios", response_model=list[PostVideoOut])
def derive_video_ratio_variants(
    campaign_id: str, video_id: str, db: Session = Depends(get_db), actor: User = Depends(require_editor)
):
    """Reframe the base clip into the element's other aspect ratios (ffmpeg, no re-gen)."""
    source = _get_video_or_404(db, campaign_id, video_id)
    if not source.base_object_key:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Generate the base video first")
    element = db.get(CampaignElement, source.element_id)
    siblings = [v for v in element.videos if v.id != source.id and not v.is_uploaded]
    if not siblings:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "This element has only one aspect ratio")
    for v in siblings:
        v.status = VideoStatus.generating
        v.error = ""
    db.commit()
    derive_video_ratios.delay(source.id)
    audit.record(db, actor, "campaign.video_derive", "campaign", campaign_id, {"video_id": video_id})
    return list(element.videos)


@router.patch("/{campaign_id}/videos/{video_id}/logo", response_model=PostVideoOut)
def toggle_video_logo(
    campaign_id: str, video_id: str, body: LogoToggle, db: Session = Depends(get_db), _: User = Depends(require_editor)
):
    """Include the client logo when generating this video (applied on next generation)."""
    video = _get_video_or_404(db, campaign_id, video_id)
    video.logo_enabled = body.enabled
    db.commit()
    db.refresh(video)
    return video


@router.post("/{campaign_id}/videos/{video_id}/upload", response_model=PostVideoOut)
def upload_slot_video(
    campaign_id: str,
    video_id: str,
    file: UploadFile,
    db: Session = Depends(get_db),
    actor: User = Depends(require_editor),
):
    video = _get_video_or_404(db, campaign_id, video_id)
    if file.content_type not in {"video/mp4", "video/webm", "video/quicktime"}:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Video must be MP4, WebM, or MOV")
    data = file.file.read()
    if len(data) > 200 * 1024 * 1024:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Video must be 200 MB or smaller")
    key = f"campaigns/{campaign_id}/videos/{video.id}/uploaded"
    storage.upload_object(key, data, file.content_type)
    video.base_object_key = key
    video.is_uploaded = True
    video.status = VideoStatus.ready
    video.error = ""
    db.commit()
    db.refresh(video)
    return video


@router.get("/{campaign_id}/videos/{video_id}/file")
def get_video_file(
    campaign_id: str, video_id: str, db: Session = Depends(get_db), _: User = Depends(get_current_user)
):
    video = _get_video_or_404(db, campaign_id, video_id)
    if not video.base_object_key:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "No video generated yet")
    data, content_type = storage.get_object(video.base_object_key)
    return Response(content=data, media_type=content_type)


@router.delete("/{campaign_id}/videos/{video_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_video_slot(
    campaign_id: str, video_id: str, db: Session = Depends(get_db), actor: User = Depends(require_editor)
):
    video = _get_video_or_404(db, campaign_id, video_id)
    db.delete(video)
    db.commit()


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


# --- reference images (passed to the image model as visual reference) ---


@router.get("/{campaign_id}/references", response_model=list[ReferenceImageOut])
def list_references(campaign_id: str, db: Session = Depends(get_db), _: User = Depends(get_current_user)):
    _get_campaign_or_404(db, campaign_id)
    return db.scalars(
        select(ReferenceImage).where(ReferenceImage.campaign_id == campaign_id).order_by(ReferenceImage.created_at)
    ).all()


@router.post("/{campaign_id}/references", response_model=ReferenceImageOut, status_code=status.HTTP_201_CREATED)
def upload_reference(
    campaign_id: str, file: UploadFile, db: Session = Depends(get_db), actor: User = Depends(require_editor)
):
    _get_campaign_or_404(db, campaign_id)
    if file.content_type not in ("image/png", "image/jpeg", "image/jpg", "image/webp"):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Reference must be a PNG, JPG or WebP image")
    data = file.file.read()
    if len(data) > MAX_ASSET_BYTES:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Reference must be 10 MB or smaller")
    ref = ReferenceImage(
        campaign_id=campaign_id,
        object_key="",
        filename=file.filename or "reference",
        content_type=file.content_type,
        created_by=actor.id,
    )
    db.add(ref)
    db.flush()
    key = f"campaigns/{campaign_id}/references/{ref.id}"
    storage.upload_object(key, data, file.content_type)
    ref.object_key = key
    db.commit()
    db.refresh(ref)
    audit.record(db, actor, "campaign.reference_upload", "campaign", campaign_id, {"reference": ref.id})
    return ref


@router.get("/{campaign_id}/references/{reference_id}/file")
def get_reference_file(
    campaign_id: str, reference_id: str, db: Session = Depends(get_db), _: User = Depends(get_current_user)
):
    ref = db.get(ReferenceImage, reference_id)
    if ref is None or ref.campaign_id != campaign_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Reference not found")
    data, content_type = storage.get_object(ref.object_key)
    return Response(content=data, media_type=content_type)


@router.delete("/{campaign_id}/references/{reference_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_reference(
    campaign_id: str, reference_id: str, db: Session = Depends(get_db), actor: User = Depends(require_editor)
):
    ref = db.get(ReferenceImage, reference_id)
    if ref is None or ref.campaign_id != campaign_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Reference not found")
    db.delete(ref)
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
