"""Background jobs: website crawl + LLM extraction (PRD §3.3) and competitive
intelligence (PRD §4)."""
import logging
from datetime import datetime, timezone

import anthropic

from sqlalchemy import select

from app.db.session import SessionLocal
from app.models.client import Client, ExtractionJob, JobStatus
from app.models.competitor import AnalysisStatus, Competitor, CompetitorSearchJob, CompetitorSource, SearchJobStatus
from app.models.llm import LLMFunction
from app.models.setting import Setting
from app.services.competitor_intel import compare_with_client, identify_competitors
from app.services.crawler import CrawlConfig, crawl_site
from app.services.extraction import ExtractionError, extract_client_profile
from app.workers.celery_app import celery_app

logger = logging.getLogger(__name__)


def _crawl_config(db) -> CrawlConfig:
    values = {s.key: s.value for s in db.scalars(select(Setting)).all()}
    excluded = [p.strip() for p in values.get("crawler_excluded_paths", "").split(",") if p.strip()]
    return CrawlConfig(
        max_depth=int(values.get("crawler_max_depth", 5)),
        max_pages=int(values.get("crawler_max_pages", 200)),
        timeout_seconds=int(values.get("crawler_timeout_seconds", 10)),
        excluded_patterns=excluded,
        user_agent=values.get("crawler_user_agent", "AIMarketingPlatformBot/1.0"),
    )


@celery_app.task(name="extraction.run")
def run_extraction(job_id: str) -> None:
    db = SessionLocal()
    try:
        job = db.get(ExtractionJob, job_id)
        if job is None:
            logger.error("Extraction job %s not found", job_id)
            return
        client = db.get(Client, job.client_id)
        if client is None:
            job.status = JobStatus.failed
            job.error = "Client no longer exists"
            db.commit()
            return

        job.status = JobStatus.crawling
        db.commit()

        def on_progress(crawled: int, queued: int) -> None:
            job.pages_crawled = crawled
            job.pages_total_estimate = crawled + queued
            db.commit()

        config = _crawl_config(db)
        pages = crawl_site(client.website_url, config, on_progress=on_progress)

        job.status = JobStatus.extracting
        job.pages_crawled = len(pages)
        db.commit()

        draft = extract_client_profile(db, pages)
        job.draft = draft
        job.status = JobStatus.awaiting_review
        db.commit()
        logger.info("Extraction job %s ready for review (%d pages)", job_id, len(pages))
    except ExtractionError as exc:
        _fail(db, job_id, str(exc))
    except Exception as exc:  # noqa: BLE001 — job must always end in a terminal state
        logger.exception("Extraction job %s crashed", job_id)
        _fail(db, job_id, f"Unexpected error: {exc}")
    finally:
        db.close()


def _fail(db, job_id: str, error: str) -> None:
    job = db.get(ExtractionJob, job_id)
    if job is not None:
        job.status = JobStatus.failed
        job.error = error
        db.commit()


# --- Competitive intelligence (PRD §4) ---


def _competitor_crawl_config(db) -> CrawlConfig:
    """Competitor crawls use tighter limits than the client's own site."""
    config = _crawl_config(db)
    values = {s.key: s.value for s in db.scalars(select(Setting)).all()}
    config.max_depth = int(values.get("competitor_crawl_max_depth", 3))
    config.max_pages = int(values.get("competitor_crawl_max_pages", 30))
    return config


@celery_app.task(name="competitor_search.run")
def run_competitor_search(job_id: str) -> None:
    """Identify competitors via LLM + web search, then queue one analysis per competitor."""
    db = SessionLocal()
    try:
        job = db.get(CompetitorSearchJob, job_id)
        if job is None:
            logger.error("Competitor search job %s not found", job_id)
            return
        client = db.get(Client, job.client_id)
        if client is None:
            job.status = SearchJobStatus.failed
            job.error = "Client no longer exists"
            db.commit()
            return

        job.status = SearchJobStatus.identifying
        db.commit()

        identified = identify_competitors(
            db, client, job.num_competitors, job.competitor_type, job.geographic_scope
        )

        existing_urls = {
            c.website_url.rstrip("/").lower()
            for c in db.scalars(select(Competitor).where(Competitor.client_id == client.id)).all()
        }
        new_ids: list[str] = []
        for item in identified:
            if item["website_url"].rstrip("/").lower() in existing_urls:
                continue
            competitor = Competitor(
                client_id=client.id,
                company_name=item["company_name"],
                website_url=item["website_url"],
                source=CompetitorSource.auto,
                identification_reason=item["reason"],
            )
            db.add(competitor)
            db.flush()
            new_ids.append(competitor.id)

        job.identified = identified
        job.status = SearchJobStatus.completed
        db.commit()

        for competitor_id in new_ids:
            run_competitor_analysis.delay(competitor_id)
        logger.info("Search job %s identified %d competitors (%d new)", job_id, len(identified), len(new_ids))
    except ExtractionError as exc:
        _fail_search(db, job_id, str(exc))
    except Exception as exc:  # noqa: BLE001 — job must always end in a terminal state
        logger.exception("Competitor search job %s crashed", job_id)
        _fail_search(db, job_id, f"Unexpected error: {exc}")
    finally:
        db.close()


def _fail_search(db, job_id: str, error: str) -> None:
    job = db.get(CompetitorSearchJob, job_id)
    if job is not None:
        job.status = SearchJobStatus.failed
        job.error = error
        db.commit()


@celery_app.task(
    name="competitor.analyze",
    autoretry_for=(anthropic.RateLimitError,),
    retry_backoff=70,
    retry_backoff_max=300,
    max_retries=4,
)
def run_competitor_analysis(competitor_id: str) -> None:
    """Crawl + extract a competitor's profile (same as Module 1), then compare to the client."""
    db = SessionLocal()
    try:
        competitor = db.get(Competitor, competitor_id)
        if competitor is None:
            logger.error("Competitor %s not found", competitor_id)
            return
        client = db.get(Client, competitor.client_id)
        if client is None:
            return

        competitor.analysis_status = AnalysisStatus.crawling
        competitor.analysis_error = ""
        db.commit()

        def on_progress(crawled: int, _queued: int) -> None:
            competitor.pages_crawled = crawled
            db.commit()

        pages = crawl_site(competitor.website_url, _competitor_crawl_config(db), on_progress=on_progress)

        competitor.analysis_status = AnalysisStatus.extracting
        competitor.pages_crawled = len(pages)
        db.commit()

        profile = extract_client_profile(db, pages, function=LLMFunction.competitor_analysis)
        if profile.get("company_name") and not competitor.company_name:
            competitor.company_name = profile["company_name"]
        competitor.industry = profile["industry"]
        competitor.description = profile["description"]
        competitor.products_services = profile["products_services"]
        competitor.target_audience = profile["target_audience"]
        competitor.value_proposition = profile["value_proposition"]
        competitor.business_objectives = profile["business_objectives"]
        competitor.communication_tone = profile["communication_tone"]
        competitor.social_media_urls = profile["social_media_urls"]

        competitor.analysis_status = AnalysisStatus.comparing
        db.commit()

        comparison = compare_with_client(db, client, competitor)
        competitor.positioning = comparison["positioning"]
        competitor.strengths = comparison["strengths"]
        competitor.weaknesses = comparison["weaknesses"]
        competitor.analysis_status = AnalysisStatus.completed
        competitor.analyzed_at = datetime.now(timezone.utc)
        db.commit()
        logger.info("Competitor %s analyzed (%d pages)", competitor_id, len(pages))
    except anthropic.RateLimitError:
        # Let Celery's autoretry reschedule the task with backoff.
        db.rollback()
        raise
    except ExtractionError as exc:
        _fail_competitor(db, competitor_id, str(exc))
    except Exception as exc:  # noqa: BLE001
        logger.exception("Competitor analysis %s crashed", competitor_id)
        _fail_competitor(db, competitor_id, f"Unexpected error: {exc}")
    finally:
        db.close()


def _fail_competitor(db, competitor_id: str, error: str) -> None:
    competitor = db.get(Competitor, competitor_id)
    if competitor is not None:
        competitor.analysis_status = AnalysisStatus.failed
        competitor.analysis_error = error
        db.commit()
