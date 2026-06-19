from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Response, UploadFile, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session
from sqlalchemy.orm.attributes import flag_modified

from app.api.deps import assert_client_access, get_current_user, org_client_filter, require_editor
from app.db.session import get_db
from app.models.article import Article
from app.models.campaign import Campaign
from app.models.client import BrandMemoryVersion, Client, ExtractionJob, JobStatus
from app.models.competitor import Competitor
from app.models.onboarding import OnboardingJob, OnboardingStatus, initial_steps
from app.models.org import Organization
from app.models.setting import Setting
from app.models.user import User
from app.schemas.client import (
    BrandMemoryUpdate,
    BrandMemoryVersionOut,
    ClientCreate,
    ClientOut,
    ClientUpdate,
    ExtractionConfirm,
    ExtractionJobOut,
    OnboardingJobOut,
)
from app.models.article import ArticleEntryType, ArticleStatus
from app.schemas.article import (
    ClientUrlImportRequest,
    ClientUrlImportResponse,
    WordPressImportRequest,
    WordPressImportResponse,
)
from app.services import audit, storage
from app.services.wordpress import discover_wp_api
from app.workers.tasks import (
    import_client_articles,
    run_extraction,
    run_onboarding,
    run_onboarding_step,
)

BRAND_MEMORY_FIELDS = (
    "brand_tone", "brand_words_required", "brand_words_forbidden", "brand_colors",
    "brand_visual_style", "brand_copy_examples", "brand_legal_disclaimer",
)

router = APIRouter(prefix="/clients", tags=["clients"])

ALLOWED_LOGO_TYPES = {"image/png", "image/jpeg", "image/svg+xml", "image/webp"}
ALLOWED_AVATAR_TYPES = {"image/png", "image/jpeg", "image/webp"}
MAX_LOGO_BYTES = 5 * 1024 * 1024


def _default_org_id(db: Session) -> str | None:
    """Fallback org for clients created by a platform admin acting without an org
    context (e.g. the dev/single-tenant setup) — the seeded Default org."""
    org = db.scalar(select(Organization).where(Organization.slug == "default"))
    return org.id if org else None


def _get_client_or_404(db: Session, client_id: str, user: User) -> Client:
    client = db.get(Client, client_id)
    if client is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Client not found")
    assert_client_access(user, client)
    return client


@router.get("", response_model=list[ClientOut])
def list_clients(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    query = select(Client).order_by(Client.company_name)
    scope = org_client_filter(user)
    if scope is not None:
        query = query.where(scope)
    return db.scalars(query).all()


@router.post("", response_model=ClientOut, status_code=status.HTTP_201_CREATED)
def create_client(body: ClientCreate, db: Session = Depends(get_db), actor: User = Depends(require_editor)):
    org_id = actor.org_id or _default_org_id(db)
    client = Client(
        org_id=org_id,
        company_name=body.company_name,
        website_url=str(body.website_url),
        notes=body.notes,
    )
    db.add(client)
    db.commit()
    audit.record(db, actor, "client.create", "client", client.id, {"name": client.company_name})

    # Kick off the full onboarding pipeline in the background unless disabled.
    auto = db.get(Setting, "onboarding_auto_run")
    if auto is None or auto.value != "false":
        job = OnboardingJob(client_id=client.id, steps=initial_steps(), created_by=actor.id)
        db.add(job)
        db.commit()
        run_onboarding.delay(job.id)
    return client


@router.get("/onboarding-statuses")
def onboarding_statuses(
    db: Session = Depends(get_db), user: User = Depends(get_current_user)
) -> dict[str, str]:
    """Latest onboarding status per client, for badges on the clients list."""
    jobs = db.scalars(select(OnboardingJob).order_by(OnboardingJob.created_at.desc())).all()
    out: dict[str, str] = {}
    for job in jobs:
        out.setdefault(job.client_id, job.status.value)
    return out


@router.get("/{client_id}", response_model=ClientOut)
def get_client(client_id: str, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    return _get_client_or_404(db, client_id, user)


@router.patch("/{client_id}", response_model=ClientOut)
def update_client(
    client_id: str, body: ClientUpdate, db: Session = Depends(get_db), actor: User = Depends(require_editor)
):
    client = _get_client_or_404(db, client_id, actor)
    changes = body.model_dump(exclude_unset=True)
    if "website_url" in changes:
        changes["website_url"] = str(changes["website_url"])
    for field, value in changes.items():
        setattr(client, field, value)
    db.commit()
    audit.record(db, actor, "client.update", "client", client.id, {"fields": list(changes.keys())})
    return client


@router.get("/{client_id}/deletion-summary")
def deletion_summary(
    client_id: str, db: Session = Depends(get_db), actor: User = Depends(require_editor)
):
    """Counts of the related records that deleting this client will cascade-delete,
    so the UI can warn the user with concrete numbers before confirming."""
    client = _get_client_or_404(db, client_id, actor)
    return {
        "campaigns": db.scalar(select(func.count()).select_from(Campaign).where(Campaign.client_id == client.id)),
        "competitors": db.scalar(select(func.count()).select_from(Competitor).where(Competitor.client_id == client.id)),
        "articles": db.scalar(select(func.count()).select_from(Article).where(Article.client_id == client.id)),
    }


@router.delete("/{client_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_client(client_id: str, db: Session = Depends(get_db), actor: User = Depends(require_editor)):
    client = _get_client_or_404(db, client_id, actor)
    db.delete(client)
    db.commit()
    audit.record(db, actor, "client.delete", "client", client_id)


@router.post("/{client_id}/logo", response_model=ClientOut)
def upload_logo(
    client_id: str, file: UploadFile, db: Session = Depends(get_db), actor: User = Depends(require_editor)
):
    client = _get_client_or_404(db, client_id, actor)
    if file.content_type not in ALLOWED_LOGO_TYPES:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Logo must be PNG, JPG, SVG, or WebP")
    data = file.file.read()
    if len(data) > MAX_LOGO_BYTES:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Logo file must be 5 MB or smaller")
    key = f"clients/{client.id}/logo"
    storage.upload_object(key, data, file.content_type)
    client.logo_object_key = key
    db.commit()
    audit.record(db, actor, "client.logo_upload", "client", client.id)
    return client


@router.get("/{client_id}/logo")
def get_logo(client_id: str, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    client = _get_client_or_404(db, client_id, actor)
    if not client.logo_object_key:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "This client has no logo")
    data, content_type = storage.get_object(client.logo_object_key)
    return Response(content=data, media_type=content_type)


@router.post("/{client_id}/avatar", response_model=ClientOut)
def upload_avatar(
    client_id: str, file: UploadFile, db: Session = Depends(get_db), actor: User = Depends(require_editor)
):
    """Upload the client's profile photo (shown as the author avatar in post previews)."""
    client = _get_client_or_404(db, client_id, actor)
    if file.content_type not in ALLOWED_AVATAR_TYPES:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Profile photo must be PNG, JPG, or WebP")
    data = file.file.read()
    if len(data) > MAX_LOGO_BYTES:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Profile photo must be 5 MB or smaller")
    key = f"clients/{client.id}/avatar"
    storage.upload_object(key, data, file.content_type)
    client.avatar_object_key = key
    db.commit()
    audit.record(db, actor, "client.avatar_upload", "client", client.id)
    return client


@router.get("/{client_id}/avatar")
def get_avatar(client_id: str, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    client = _get_client_or_404(db, client_id, actor)
    if not client.avatar_object_key:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "This client has no profile photo")
    data, content_type = storage.get_object(client.avatar_object_key)
    return Response(content=data, media_type=content_type)


# --- Brand Memory (PRD §5.3.3) ---


@router.put("/{client_id}/brand-memory", response_model=ClientOut)
def update_brand_memory(
    client_id: str, body: BrandMemoryUpdate, db: Session = Depends(get_db), actor: User = Depends(require_editor)
):
    """Save Brand Memory and snapshot a new version (change history is maintained)."""
    client = _get_client_or_404(db, client_id, actor)
    data = body.model_dump()
    for field in BRAND_MEMORY_FIELDS:
        setattr(client, field, data[field])
    db.add(BrandMemoryVersion(client_id=client.id, snapshot=data, created_by=actor.id))
    db.commit()
    audit.record(db, actor, "client.brand_memory_update", "client", client.id)
    db.refresh(client)
    return client


@router.get("/{client_id}/brand-memory/versions", response_model=list[BrandMemoryVersionOut])
def list_brand_memory_versions(
    client_id: str, db: Session = Depends(get_db), user: User = Depends(get_current_user)
):
    _get_client_or_404(db, client_id, user)
    return db.scalars(
        select(BrandMemoryVersion)
        .where(BrandMemoryVersion.client_id == client_id)
        .order_by(BrandMemoryVersion.created_at.desc())
        .limit(20)
    ).all()


# --- Automatic extraction (PRD §3.3) ---


@router.post("/{client_id}/analyze", response_model=ExtractionJobOut, status_code=status.HTTP_202_ACCEPTED)
def analyze_website(client_id: str, db: Session = Depends(get_db), actor: User = Depends(require_editor)):
    client = _get_client_or_404(db, client_id, actor)
    active = db.scalar(
        select(ExtractionJob).where(
            ExtractionJob.client_id == client.id,
            ExtractionJob.status.in_([JobStatus.pending, JobStatus.crawling, JobStatus.extracting]),
        )
    )
    if active:
        raise HTTPException(status.HTTP_409_CONFLICT, "An analysis is already running for this client")
    job = ExtractionJob(client_id=client.id, created_by=actor.id)
    db.add(job)
    db.commit()
    run_extraction.delay(job.id)
    audit.record(db, actor, "client.analyze", "client", client.id, {"job_id": job.id})
    return job


@router.post(
    "/{client_id}/import-articles",
    response_model=WordPressImportResponse,
    status_code=status.HTTP_202_ACCEPTED,
)
def import_articles_from_website(
    client_id: str,
    body: WordPressImportRequest = WordPressImportRequest(),
    db: Session = Depends(get_db),
    actor: User = Depends(require_editor),
):
    """Import the client's articles via their site's WordPress REST API (PRD §7).

    Detects the WP API synchronously so the caller gets immediate feedback if the
    site is not WordPress; the actual import runs in a Celery task.
    """
    client = _get_client_or_404(db, client_id, actor)
    api_base = discover_wp_api(db, client.website_url)
    if api_base is None:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            f"WordPress REST API not available at {client.website_url}",
        )
    from_date = body.from_date.isoformat() if body.from_date else None
    to_date = body.to_date.isoformat() if body.to_date else None
    import_client_articles.delay(client.id, api_base, body.limit, from_date, to_date)
    audit.record(db, actor, "client.import_articles", "client", client.id, {"limit": body.limit, "from_date": from_date, "to_date": to_date})
    return WordPressImportResponse(
        detail="Importing articles in the background.", api_base=api_base, limit=body.limit
    )


@router.post(
    "/{client_id}/import-article-url",
    response_model=ClientUrlImportResponse,
)
def import_article_by_url(
    client_id: str,
    body: ClientUrlImportRequest,
    db: Session = Depends(get_db),
    actor: User = Depends(require_editor),
):
    """Import a single article by URL for a client.

    Checks the DB first — if the URL already exists, returns immediately without
    running the LLM. Otherwise creates a placeholder Article (with client_id) and
    fires the background extraction task.
    """
    from app.workers.tasks import import_article_from_url

    client = _get_client_or_404(db, client_id, actor)
    url = body.url.rstrip("/")
    existing = db.scalar(select(Article).where(Article.source_url == url))
    if existing:
        return ClientUrlImportResponse(
            status="already_exists",
            detail="This article is already in the library.",
            article_id=existing.id,
        )
    article = Article(
        title=url,
        source_url=url,
        entry_type=ArticleEntryType.manual,
        status=ArticleStatus.active,
        summary="[Fetching and extracting…]",
        client_id=client.id,
    )
    db.add(article)
    db.commit()
    import_article_from_url.delay(article.id)
    audit.record(db, actor, "client.import_article_url", "article", article.id, {"url": url})
    return ClientUrlImportResponse(
        status="queued",
        detail="Article queued for import.",
        article_id=article.id,
    )


@router.get("/{client_id}/onboarding", response_model=OnboardingJobOut)
def get_onboarding(client_id: str, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    """Latest onboarding job for the client (polled by the UI for live progress)."""
    _get_client_or_404(db, client_id, user)
    job = db.scalar(
        select(OnboardingJob)
        .where(OnboardingJob.client_id == client_id)
        .order_by(OnboardingJob.created_at.desc())
        .limit(1)
    )
    if job is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "No onboarding job for this client")
    return job


@router.post("/{client_id}/onboard", response_model=OnboardingJobOut, status_code=status.HTTP_202_ACCEPTED)
def rerun_onboarding(client_id: str, db: Session = Depends(get_db), actor: User = Depends(require_editor)):
    """Re-run the full onboarding pipeline for an existing client."""
    client = _get_client_or_404(db, client_id, actor)
    running = db.scalar(
        select(OnboardingJob).where(
            OnboardingJob.client_id == client.id,
            OnboardingJob.status == OnboardingStatus.running,
        )
    )
    if running:
        raise HTTPException(status.HTTP_409_CONFLICT, "Onboarding is already running for this client")
    job = OnboardingJob(client_id=client.id, steps=initial_steps(), created_by=actor.id)
    db.add(job)
    db.commit()
    run_onboarding.delay(job.id)
    audit.record(db, actor, "client.onboard", "client", client.id, {"job_id": job.id})
    return job


@router.post(
    "/{client_id}/onboarding/retry/{step_key}",
    response_model=OnboardingJobOut,
    status_code=status.HTTP_202_ACCEPTED,
)
def retry_onboarding_step(
    client_id: str, step_key: str, db: Session = Depends(get_db), actor: User = Depends(require_editor)
):
    """Re-run a single onboarding step (e.g. retry just 'articles') without redoing the rest."""
    client = _get_client_or_404(db, client_id, actor)
    job = db.scalar(
        select(OnboardingJob)
        .where(OnboardingJob.client_id == client.id)
        .order_by(OnboardingJob.created_at.desc())
        .limit(1)
    )
    if job is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "No onboarding job for this client")
    if job.status == OnboardingStatus.running:
        raise HTTPException(status.HTTP_409_CONFLICT, "Onboarding is already running for this client")
    if not any(s["key"] == step_key for s in job.steps):
        raise HTTPException(status.HTTP_404_NOT_FOUND, f"Unknown onboarding step '{step_key}'")
    # Reflect "running" synchronously so the client starts polling immediately.
    for step in job.steps:
        if step["key"] == step_key:
            step["status"] = "running"
            step["detail"] = "Retrying…"
    flag_modified(job, "steps")
    job.status = OnboardingStatus.running
    db.commit()
    run_onboarding_step.delay(job.id, step_key)
    audit.record(db, actor, "client.onboard_step", "client", client.id, {"step": step_key})
    db.refresh(job)
    return job


@router.get("/{client_id}/jobs", response_model=list[ExtractionJobOut])
def list_jobs(client_id: str, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    _get_client_or_404(db, client_id, user)
    return db.scalars(
        select(ExtractionJob)
        .where(ExtractionJob.client_id == client_id)
        .order_by(ExtractionJob.created_at.desc())
        .limit(20)
    ).all()


@router.get("/{client_id}/jobs/{job_id}", response_model=ExtractionJobOut)
def get_job(client_id: str, job_id: str, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    job = db.get(ExtractionJob, job_id)
    if job is None or job.client_id != client_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Job not found")
    return job


@router.post("/{client_id}/jobs/{job_id}/confirm", response_model=ClientOut)
def confirm_extraction(
    client_id: str,
    job_id: str,
    body: ExtractionConfirm,
    db: Session = Depends(get_db),
    actor: User = Depends(require_editor),
):
    """Apply the user-reviewed (possibly edited) draft to the client profile (PRD §3.3 steps 5–6)."""
    client = _get_client_or_404(db, client_id, actor)
    job = db.get(ExtractionJob, job_id)
    if job is None or job.client_id != client_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Job not found")
    if job.status != JobStatus.awaiting_review:
        raise HTTPException(status.HTTP_409_CONFLICT, "This job is not awaiting review")

    client.industry = body.industry
    client.description = body.description
    client.products_services = body.products_services
    client.target_audience = body.target_audience
    client.value_proposition = body.value_proposition
    client.business_objectives = body.business_objectives
    client.communication_tone = body.communication_tone
    client.social_media_urls = body.social_media_urls
    if body.company_name:
        client.company_name = body.company_name
    client.last_extraction_at = datetime.now(timezone.utc)
    job.status = JobStatus.completed
    db.commit()
    audit.record(db, actor, "client.extraction_confirm", "client", client.id, {"job_id": job.id})
    return client
