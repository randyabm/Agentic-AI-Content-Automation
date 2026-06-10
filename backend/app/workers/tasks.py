"""Background jobs: website crawl + LLM extraction (PRD §3.3)."""
import logging

from sqlalchemy import select

from app.db.session import SessionLocal
from app.models.client import Client, ExtractionJob, JobStatus
from app.models.setting import Setting
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
