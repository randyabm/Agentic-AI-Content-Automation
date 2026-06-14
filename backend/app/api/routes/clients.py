from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Response, UploadFile, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import get_current_user, require_editor
from app.db.session import get_db
from app.models.client import BrandMemoryVersion, Client, ExtractionJob, JobStatus
from app.models.user import User
from app.schemas.client import (
    BrandMemoryUpdate,
    BrandMemoryVersionOut,
    ClientCreate,
    ClientOut,
    ClientUpdate,
    ExtractionConfirm,
    ExtractionJobOut,
)
from app.services import audit, storage
from app.workers.tasks import run_extraction

BRAND_MEMORY_FIELDS = (
    "brand_tone", "brand_words_required", "brand_words_forbidden", "brand_colors",
    "brand_visual_style", "brand_copy_examples", "brand_legal_disclaimer",
)

router = APIRouter(prefix="/clients", tags=["clients"])

ALLOWED_LOGO_TYPES = {"image/png", "image/jpeg", "image/svg+xml", "image/webp"}
ALLOWED_AVATAR_TYPES = {"image/png", "image/jpeg", "image/webp"}
MAX_LOGO_BYTES = 5 * 1024 * 1024


def _get_client_or_404(db: Session, client_id: str) -> Client:
    client = db.get(Client, client_id)
    if client is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Client not found")
    return client


@router.get("", response_model=list[ClientOut])
def list_clients(db: Session = Depends(get_db), _: User = Depends(get_current_user)):
    return db.scalars(select(Client).order_by(Client.company_name)).all()


@router.post("", response_model=ClientOut, status_code=status.HTTP_201_CREATED)
def create_client(body: ClientCreate, db: Session = Depends(get_db), actor: User = Depends(require_editor)):
    client = Client(
        company_name=body.company_name,
        website_url=str(body.website_url),
        notes=body.notes,
    )
    db.add(client)
    db.commit()
    audit.record(db, actor, "client.create", "client", client.id, {"name": client.company_name})
    return client


@router.get("/{client_id}", response_model=ClientOut)
def get_client(client_id: str, db: Session = Depends(get_db), _: User = Depends(get_current_user)):
    return _get_client_or_404(db, client_id)


@router.patch("/{client_id}", response_model=ClientOut)
def update_client(
    client_id: str, body: ClientUpdate, db: Session = Depends(get_db), actor: User = Depends(require_editor)
):
    client = _get_client_or_404(db, client_id)
    changes = body.model_dump(exclude_unset=True)
    if "website_url" in changes:
        changes["website_url"] = str(changes["website_url"])
    for field, value in changes.items():
        setattr(client, field, value)
    db.commit()
    audit.record(db, actor, "client.update", "client", client.id, {"fields": list(changes.keys())})
    return client


@router.delete("/{client_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_client(client_id: str, db: Session = Depends(get_db), actor: User = Depends(require_editor)):
    client = _get_client_or_404(db, client_id)
    db.delete(client)
    db.commit()
    audit.record(db, actor, "client.delete", "client", client_id)


@router.post("/{client_id}/logo", response_model=ClientOut)
def upload_logo(
    client_id: str, file: UploadFile, db: Session = Depends(get_db), actor: User = Depends(require_editor)
):
    client = _get_client_or_404(db, client_id)
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
def get_logo(client_id: str, db: Session = Depends(get_db), _: User = Depends(get_current_user)):
    client = _get_client_or_404(db, client_id)
    if not client.logo_object_key:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "This client has no logo")
    data, content_type = storage.get_object(client.logo_object_key)
    return Response(content=data, media_type=content_type)


@router.post("/{client_id}/avatar", response_model=ClientOut)
def upload_avatar(
    client_id: str, file: UploadFile, db: Session = Depends(get_db), actor: User = Depends(require_editor)
):
    """Upload the client's profile photo (shown as the author avatar in post previews)."""
    client = _get_client_or_404(db, client_id)
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
def get_avatar(client_id: str, db: Session = Depends(get_db), _: User = Depends(get_current_user)):
    client = _get_client_or_404(db, client_id)
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
    client = _get_client_or_404(db, client_id)
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
    client_id: str, db: Session = Depends(get_db), _: User = Depends(get_current_user)
):
    _get_client_or_404(db, client_id)
    return db.scalars(
        select(BrandMemoryVersion)
        .where(BrandMemoryVersion.client_id == client_id)
        .order_by(BrandMemoryVersion.created_at.desc())
        .limit(20)
    ).all()


# --- Automatic extraction (PRD §3.3) ---


@router.post("/{client_id}/analyze", response_model=ExtractionJobOut, status_code=status.HTTP_202_ACCEPTED)
def analyze_website(client_id: str, db: Session = Depends(get_db), actor: User = Depends(require_editor)):
    client = _get_client_or_404(db, client_id)
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


@router.get("/{client_id}/jobs", response_model=list[ExtractionJobOut])
def list_jobs(client_id: str, db: Session = Depends(get_db), _: User = Depends(get_current_user)):
    _get_client_or_404(db, client_id)
    return db.scalars(
        select(ExtractionJob)
        .where(ExtractionJob.client_id == client_id)
        .order_by(ExtractionJob.created_at.desc())
        .limit(20)
    ).all()


@router.get("/{client_id}/jobs/{job_id}", response_model=ExtractionJobOut)
def get_job(client_id: str, job_id: str, db: Session = Depends(get_db), _: User = Depends(get_current_user)):
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
    client = _get_client_or_404(db, client_id)
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
