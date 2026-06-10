"""Background jobs: website crawl + LLM extraction (PRD §3.3), competitive
intelligence (PRD §4), and article library auto-sync (PRD §7)."""
import logging
from datetime import datetime, timedelta, timezone

import anthropic

from sqlalchemy import select

from app.db.session import SessionLocal
from app.models.article import Article, ArticleEntryType, ArticleSource, ArticleStatus, SyncFrequency
from app.models.campaign import (
    Campaign,
    CampaignPlatform,
    CampaignStatus,
    Post,
    PostImage,
    PostStatus,
)
from app.models.client import Client, ExtractionJob, JobStatus
from app.models.competitor import AnalysisStatus, Competitor, CompetitorSearchJob, CompetitorSource, SearchJobStatus
from app.models.llm import LLMFunction
from app.models.setting import Setting
from app.services.article_intel import discover_article_urls, extract_article, fetch_clean_page
from app.services.campaign_gen import build_context, generate_for_platform, resolve_article
from app.services.competitor_intel import compare_with_client, identify_competitors
from app.services.crawler import CrawlConfig, crawl_site
from app.services.extraction import ExtractionError, extract_client_profile
from app.workers.celery_app import celery_app

logger = logging.getLogger(__name__)

FREQUENCY_INTERVALS = {
    SyncFrequency.daily: timedelta(days=1),
    SyncFrequency.weekly: timedelta(weeks=1),
}


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


# --- Article library auto-sync (PRD §7) ---


def _normalize_url(url: str) -> str:
    return url.rstrip("/").lower()


def _is_duplicate(db, source: ArticleSource, url: str, title: str, pub_date) -> bool:
    if db.scalar(select(Article).where(Article.source_url == url.rstrip("/"))):
        return True
    if source.duplicate_detection and title:
        existing = db.scalar(
            select(Article).where(Article.title == title, Article.publication_date == pub_date)
        )
        if existing:
            return True
    return False


@celery_app.task(name="article_sync.check_due")
def check_due_sources() -> None:
    """Periodic (Celery Beat) sweep: trigger a sync for each active source that is due."""
    db = SessionLocal()
    try:
        now = datetime.now(timezone.utc)
        sources = db.scalars(select(ArticleSource).where(ArticleSource.is_active.is_(True))).all()
        for source in sources:
            if source.frequency == SyncFrequency.on_demand:
                continue
            interval = FREQUENCY_INTERVALS.get(source.frequency)
            if interval is None:
                continue
            last = source.last_synced_at
            if last is None or last.replace(tzinfo=timezone.utc) + interval <= now:
                if source.last_sync_status != "running":
                    sync_source.delay(source.id)
    finally:
        db.close()


@celery_app.task(
    name="article_sync.run_source",
    autoretry_for=(anthropic.RateLimitError,),
    retry_backoff=70,
    retry_backoff_max=300,
    max_retries=3,
)
def sync_source(source_id: str) -> None:
    """Discover and import new articles from one configured source (PRD §7.2.1, §7.4)."""
    db = SessionLocal()
    try:
        source = db.get(ArticleSource, source_id)
        if source is None:
            logger.error("Article source %s not found", source_id)
            return
        source.last_sync_status = "running"
        source.last_sync_detail = ""
        db.commit()

        candidates = discover_article_urls(db, source.url, source.max_articles_per_sync)
        imported = 0
        skipped = 0
        for url in candidates:
            if imported >= source.max_articles_per_sync:
                break
            if _is_duplicate(db, source, url, "", None):
                skipped += 1
                continue
            try:
                page = fetch_clean_page(db, url)
                data = extract_article(db, page)
            except ExtractionError as exc:
                logger.warning("Skipping %s: %s", url, exc)
                skipped += 1
                continue
            if not data["is_article"]:
                skipped += 1
                continue
            if _is_duplicate(db, source, url, data["title"], data["publication_date"]):
                skipped += 1
                continue
            db.add(
                Article(
                    title=data["title"],
                    author=data["author"],
                    publication_date=data["publication_date"],
                    source_url=url.rstrip("/"),
                    summary=data["summary"],
                    body=data["body"],
                    tags=data["tags"],
                    entry_type=ArticleEntryType.auto,
                    status=ArticleStatus.active,
                    needs_review=not source.auto_publish,
                    source_id=source.id,
                )
            )
            db.commit()
            imported += 1

        source.last_synced_at = datetime.now(timezone.utc)
        source.last_sync_status = "ok"
        source.last_sync_detail = f"Imported {imported}, skipped {skipped} of {len(candidates)} candidates"
        db.commit()
        logger.info("Source %s sync done: %s", source_id, source.last_sync_detail)
    except anthropic.RateLimitError:
        db.rollback()
        src = db.get(ArticleSource, source_id)
        if src:
            src.last_sync_status = "running"
            db.commit()
        raise
    except Exception as exc:  # noqa: BLE001 — always leave the source in a terminal state
        logger.exception("Article source %s sync crashed", source_id)
        db.rollback()
        src = db.get(ArticleSource, source_id)
        if src:
            src.last_sync_status = "error"
            src.last_sync_detail = str(exc)
            src.last_synced_at = datetime.now(timezone.utc)
            db.commit()
    finally:
        db.close()


# --- Campaign generation (PRD §5 — Module 3) ---


def _resolve_article(db, campaign: Campaign) -> dict:
    """Resolve the article reference and mark library articles as used."""
    if campaign.article_id:
        article = db.get(Article, campaign.article_id)
        if article:
            article.last_used_in_campaign = datetime.now(timezone.utc)
            db.commit()
    return resolve_article(db, campaign)


@celery_app.task(
    name="campaign.generate",
    autoretry_for=(anthropic.RateLimitError,),
    retry_backoff=70,
    retry_backoff_max=300,
    max_retries=4,
)
def generate_campaign(campaign_id: str) -> None:
    """Run the Editorial and Visual agents for every active platform (PRD §5.6)."""
    db = SessionLocal()
    try:
        campaign = db.get(Campaign, campaign_id)
        if campaign is None:
            logger.error("Campaign %s not found", campaign_id)
            return
        client = db.get(Client, campaign.client_id)
        if client is None:
            campaign.status = CampaignStatus.failed
            campaign.error = "Client no longer exists"
            db.commit()
            return

        campaign.status = CampaignStatus.generating
        campaign.error = ""
        db.commit()

        # Replace any prior generation output (regenerate-whole-campaign case).
        for old in db.scalars(select(Post).where(Post.campaign_id == campaign.id)).all():
            db.delete(old)
        db.commit()

        article = _resolve_article(db, campaign)
        context = build_context(db, client, campaign, article["text"])

        active = db.scalars(
            select(CampaignPlatform).where(
                CampaignPlatform.campaign_id == campaign.id, CampaignPlatform.is_active.is_(True)
            )
        ).all()
        if not active:
            campaign.status = CampaignStatus.failed
            campaign.error = "No active platforms were selected for this campaign."
            db.commit()
            return

        for cp in active:
            posts_data, image_prompts = generate_for_platform(db, client, campaign, cp, context, article)
            for position, (pdata, slots) in enumerate(zip(posts_data, image_prompts)):
                post = Post(
                    campaign_id=campaign.id,
                    platform=cp.platform,
                    position=position,
                    headline=pdata["headline"],
                    copy=pdata["copy"],
                    cta=pdata["cta"],
                    hashtags=pdata["hashtags"],
                    best_time=pdata["best_time"],
                    rationale=pdata["rationale"],
                    status=PostStatus.ready,
                )
                db.add(post)
                db.flush()
                for slot_index, slot in enumerate(slots):
                    db.add(
                        PostImage(
                            post_id=post.id,
                            slot_index=slot_index,
                            aspect_ratio=slot["aspect_ratio"],
                            prompt=slot["prompt"],
                            negative_prompt=slot["negative_prompt"],
                        )
                    )
            db.commit()

        campaign.status = CampaignStatus.ready
        db.commit()
        logger.info("Campaign %s generated for %d platform(s)", campaign_id, len(active))
    except anthropic.RateLimitError:
        db.rollback()
        raise
    except ExtractionError as exc:
        _fail_campaign(db, campaign_id, str(exc))
    except Exception as exc:  # noqa: BLE001 — always leave the campaign in a terminal state
        logger.exception("Campaign %s generation crashed", campaign_id)
        _fail_campaign(db, campaign_id, f"Unexpected error: {exc}")
    finally:
        db.close()


def _fail_campaign(db, campaign_id: str, error: str) -> None:
    campaign = db.get(Campaign, campaign_id)
    if campaign is not None:
        campaign.status = CampaignStatus.failed
        campaign.error = error
        db.commit()


@celery_app.task(
    name="campaign.regenerate_platform",
    autoretry_for=(anthropic.RateLimitError,),
    retry_backoff=70,
    max_retries=4,
)
def regenerate_platform(campaign_id: str, platform: str) -> None:
    """Regenerate all posts for a single platform (PRD §5.6 step 21c)."""
    db = SessionLocal()
    try:
        campaign = db.get(Campaign, campaign_id)
        if campaign is None:
            return
        client = db.get(Client, campaign.client_id)
        cp = db.scalar(
            select(CampaignPlatform).where(
                CampaignPlatform.campaign_id == campaign_id, CampaignPlatform.platform == platform
            )
        )
        if client is None or cp is None:
            return

        for old in db.scalars(
            select(Post).where(Post.campaign_id == campaign_id, Post.platform == cp.platform)
        ).all():
            db.delete(old)
        db.commit()

        article = _resolve_article(db, campaign)
        context = build_context(db, client, campaign, article["text"])
        posts_data, image_prompts = generate_for_platform(db, client, campaign, cp, context, article)
        for position, (pdata, slots) in enumerate(zip(posts_data, image_prompts)):
            post = Post(
                campaign_id=campaign.id, platform=cp.platform, position=position,
                headline=pdata["headline"], copy=pdata["copy"], cta=pdata["cta"],
                hashtags=pdata["hashtags"], best_time=pdata["best_time"],
                rationale=pdata["rationale"], status=PostStatus.ready,
            )
            db.add(post)
            db.flush()
            for slot_index, slot in enumerate(slots):
                db.add(PostImage(
                    post_id=post.id, slot_index=slot_index, aspect_ratio=slot["aspect_ratio"],
                    prompt=slot["prompt"], negative_prompt=slot["negative_prompt"],
                ))
        campaign.status = CampaignStatus.ready
        db.commit()
    except anthropic.RateLimitError:
        db.rollback()
        raise
    except Exception as exc:  # noqa: BLE001
        logger.exception("Platform regeneration crashed for campaign %s", campaign_id)
        _fail_campaign(db, campaign_id, f"Unexpected error: {exc}")
    finally:
        db.close()


@celery_app.task(name="article.import_url")
def import_article_from_url(article_id: str) -> None:
    """Fetch + extract a manually added article (added as a placeholder row first)."""
    db = SessionLocal()
    try:
        article = db.get(Article, article_id)
        if article is None:
            return
        page = fetch_clean_page(db, article.source_url)
        data = extract_article(db, page)
        article.title = data["title"] or article.title
        article.author = data["author"]
        article.publication_date = data["publication_date"]
        article.summary = data["summary"]
        article.body = data["body"]
        article.tags = data["tags"]
        article.status = ArticleStatus.active
        db.commit()
        logger.info("Imported manual article %s from %s", article_id, article.source_url)
    except ExtractionError as exc:
        article = db.get(Article, article_id)
        if article:
            article.summary = f"[Extraction failed: {exc}]"
            db.commit()
    except Exception as exc:  # noqa: BLE001
        logger.exception("Manual article import %s crashed", article_id)
        article = db.get(Article, article_id)
        if article:
            article.summary = f"[Extraction error: {exc}]"
            db.commit()
    finally:
        db.close()
