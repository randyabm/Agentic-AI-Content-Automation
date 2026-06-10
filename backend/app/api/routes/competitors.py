from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import get_current_user, require_editor
from app.db.session import get_db
from app.models.client import Client
from app.models.competitor import AnalysisStatus, Competitor, CompetitorSearchJob, SearchJobStatus
from app.models.user import User
from app.schemas.competitor import (
    CompetitorCreate,
    CompetitorOut,
    CompetitorSearchJobOut,
    CompetitorSearchRequest,
    CompetitorUpdate,
)
from app.services import audit
from app.workers.tasks import run_competitor_analysis, run_competitor_search

router = APIRouter(prefix="/clients/{client_id}/competitors", tags=["competitors"])

RUNNING_ANALYSIS = [AnalysisStatus.pending, AnalysisStatus.crawling, AnalysisStatus.extracting, AnalysisStatus.comparing]


def _get_client_or_404(db: Session, client_id: str) -> Client:
    client = db.get(Client, client_id)
    if client is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Client not found")
    return client


def _get_competitor_or_404(db: Session, client_id: str, competitor_id: str) -> Competitor:
    competitor = db.get(Competitor, competitor_id)
    if competitor is None or competitor.client_id != client_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Competitor not found")
    return competitor


@router.get("", response_model=list[CompetitorOut])
def list_competitors(client_id: str, db: Session = Depends(get_db), _: User = Depends(get_current_user)):
    _get_client_or_404(db, client_id)
    return db.scalars(
        select(Competitor).where(Competitor.client_id == client_id).order_by(Competitor.created_at)
    ).all()


@router.post("", response_model=CompetitorOut, status_code=status.HTTP_201_CREATED)
def add_competitor(
    client_id: str, body: CompetitorCreate, db: Session = Depends(get_db), actor: User = Depends(require_editor)
):
    """Manually add a competitor by URL (PRD §4.3 step 12). Analysis starts automatically."""
    client = _get_client_or_404(db, client_id)
    url = str(body.website_url).rstrip("/")
    duplicate = db.scalar(
        select(Competitor).where(Competitor.client_id == client.id, Competitor.website_url == url)
    )
    if duplicate:
        raise HTTPException(status.HTTP_409_CONFLICT, "This competitor URL is already registered")
    competitor = Competitor(
        client_id=client.id,
        company_name=body.company_name or url,
        website_url=url,
    )
    db.add(competitor)
    db.commit()
    run_competitor_analysis.delay(competitor.id)
    audit.record(db, actor, "competitor.create", "competitor", competitor.id, {"url": url})
    return competitor


@router.post("/search", response_model=CompetitorSearchJobOut, status_code=status.HTTP_202_ACCEPTED)
def start_search(
    client_id: str,
    body: CompetitorSearchRequest,
    db: Session = Depends(get_db),
    actor: User = Depends(require_editor),
):
    """Start automatic competitor identification (PRD §4.2–4.3)."""
    client = _get_client_or_404(db, client_id)
    if not client.description and not client.products_services:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            "Run the client website analysis first so the profile can guide competitor identification",
        )
    active = db.scalar(
        select(CompetitorSearchJob).where(
            CompetitorSearchJob.client_id == client.id,
            CompetitorSearchJob.status.in_([SearchJobStatus.pending, SearchJobStatus.identifying]),
        )
    )
    if active:
        raise HTTPException(status.HTTP_409_CONFLICT, "A competitor search is already running for this client")
    job = CompetitorSearchJob(
        client_id=client.id,
        num_competitors=body.num_competitors,
        competitor_type=body.competitor_type,
        geographic_scope=body.geographic_scope,
        created_by=actor.id,
    )
    db.add(job)
    db.commit()
    run_competitor_search.delay(job.id)
    audit.record(db, actor, "competitor.search", "client", client.id, {"job_id": job.id})
    return job


@router.get("/search/latest", response_model=CompetitorSearchJobOut | None)
def latest_search(client_id: str, db: Session = Depends(get_db), _: User = Depends(get_current_user)):
    _get_client_or_404(db, client_id)
    return db.scalar(
        select(CompetitorSearchJob)
        .where(CompetitorSearchJob.client_id == client_id)
        .order_by(CompetitorSearchJob.created_at.desc())
        .limit(1)
    )


@router.post("/{competitor_id}/analyze", response_model=CompetitorOut, status_code=status.HTTP_202_ACCEPTED)
def reanalyze(
    client_id: str, competitor_id: str, db: Session = Depends(get_db), actor: User = Depends(require_editor)
):
    competitor = _get_competitor_or_404(db, client_id, competitor_id)
    if competitor.analysis_status in RUNNING_ANALYSIS and competitor.analysis_status != AnalysisStatus.pending:
        raise HTTPException(status.HTTP_409_CONFLICT, "An analysis is already running for this competitor")
    competitor.analysis_status = AnalysisStatus.pending
    competitor.analysis_error = ""
    db.commit()
    run_competitor_analysis.delay(competitor.id)
    audit.record(db, actor, "competitor.analyze", "competitor", competitor.id)
    return competitor


@router.patch("/{competitor_id}", response_model=CompetitorOut)
def update_competitor(
    client_id: str,
    competitor_id: str,
    body: CompetitorUpdate,
    db: Session = Depends(get_db),
    actor: User = Depends(require_editor),
):
    competitor = _get_competitor_or_404(db, client_id, competitor_id)
    changes = body.model_dump(exclude_unset=True)
    if "website_url" in changes:
        changes["website_url"] = str(changes["website_url"]).rstrip("/")
    for field, value in changes.items():
        setattr(competitor, field, value)
    db.commit()
    audit.record(db, actor, "competitor.update", "competitor", competitor.id, {"fields": list(changes.keys())})
    return competitor


@router.delete("/{competitor_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_competitor(
    client_id: str, competitor_id: str, db: Session = Depends(get_db), actor: User = Depends(require_editor)
):
    competitor = _get_competitor_or_404(db, client_id, competitor_id)
    db.delete(competitor)
    db.commit()
    audit.record(db, actor, "competitor.delete", "competitor", competitor_id)
