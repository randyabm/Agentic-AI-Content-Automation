"""Background jobs: website crawl + LLM extraction (PRD §3.3), competitive
intelligence (PRD §4), and article library auto-sync (PRD §7)."""
import logging
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timedelta, timezone

import anthropic

from sqlalchemy import func, select
from sqlalchemy.orm.attributes import flag_modified

from app.db.session import SessionLocal
from app.models.article import (
    Article,
    ArticleEntryType,
    ArticleSource,
    ArticleSourceSyncStatus,
    ArticleStatus,
    SyncFrequency,
)
from app.models.campaign import (
    ApprovalStatus,
    Campaign,
    CampaignElement,
    CampaignPlatform,
    CampaignStatus,
    ElementType,
    Platform,
    Post,
    PostImage,
    PostVideo,
)
from app.models.client import BrandMemoryVersion, Client, ExtractionJob, JobStatus
from app.models.competitor import AnalysisStatus, Competitor, CompetitorSearchJob, CompetitorSource, SearchJobStatus
from app.models.llm import LLMFunction
from app.models.onboarding import OnboardingJob, OnboardingStatus, OnboardingStepStatus
from app.models.setting import Setting
from app.services.article_intel import (
    discover_article_urls,
    extract_article,
    fetch_clean_page,
    summarize_article,
)
from app.services.campaign_gen import (
    build_context,
    generate_platform_copy,
    generate_visuals_and_copy,
    resolve_article,
)
from app.services import storage
from app.services.branding import extract_brand_colors, fetch_site_branding
from app.services.competitor_intel import analyze_competitor, identify_competitors
from app.services.wordpress import discover_wp_api, fetch_wp_post_by_url, fetch_wp_posts
from app.services.crawler import CrawlConfig, crawl_site
from app.services.extraction import ExtractionError, extract_client_profile, generate_brand_memory
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
        concurrency=int(values.get("crawler_concurrency", 8)),
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
        _apply_site_branding(db, client)
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


def _apply_site_branding(db, client: Client) -> None:
    """Recover the site icon (→ profile photo) and logo from the client's website.

    Only fills slots that are still empty, so a user's manual upload is never
    overwritten. Branding is best-effort: any failure is logged, never fatal.
    """
    if client.avatar_object_key and client.logo_object_key:
        return
    try:
        branding = fetch_site_branding(db, client.website_url)
        if branding["avatar"] and not client.avatar_object_key:
            key = f"clients/{client.id}/avatar"
            storage.upload_object(key, *branding["avatar"])
            client.avatar_object_key = key
        if branding["logo"] and not client.logo_object_key:
            key = f"clients/{client.id}/logo"
            storage.upload_object(key, *branding["logo"])
            client.logo_object_key = key
        db.commit()
    except Exception as exc:  # noqa: BLE001 — branding must never fail the analysis
        logger.warning("Site branding recovery failed for client %s: %s", client.id, exc)
        db.rollback()


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


# --- Client onboarding pipeline (auto-run on client creation) ---


def _setting(db, key: str, default: str) -> str:
    row = db.get(Setting, key)
    return row.value if row and row.value else default


def _set_step(
    db,
    job: OnboardingJob,
    key: str,
    status: OnboardingStepStatus | str,
    detail: str = "",
) -> None:
    # Accept the enum (preferred) or a string (for the watchdog fallback at
    # the bottom of this file, which compares against the raw JSON value).
    # The cast normalises both to a string for the SQL parameter.
    status_value = status.value if isinstance(status, OnboardingStepStatus) else status
    # Atomic JSONB UPDATE — no SELECT FOR UPDATE needed. Each call modifies only
    # the target key inside the array, so concurrent threads don't overwrite each other.
    from sqlalchemy import text
    db.execute(
        text("""
            UPDATE onboarding_jobs
            SET steps = (
                SELECT jsonb_agg(
                    CASE WHEN elem->>'key' = :key
                    THEN elem || jsonb_build_object('status', :status, 'detail', :detail)
                    ELSE elem
                    END
                )::json
                FROM jsonb_array_elements(steps::jsonb) elem
            ),
            updated_at = NOW()
            WHERE id = :job_id
        """),
        {"key": key, "status": status_value, "detail": detail, "job_id": str(job.id)},
    )
    db.commit()
    # Keep the caller's in-memory object in sync.
    for step in job.steps:
        if step["key"] == key:
            step["status"] = status_value
            step["detail"] = detail
            break


def _onboard_profile(db, job: OnboardingJob, client: Client) -> None:
    _set_step(db, job, "profile", "running", "Crawling website…")
    pages = crawl_site(client.website_url, _crawl_config(db))
    draft = extract_client_profile(db, pages)
    client.industry = draft["industry"]
    client.description = draft["description"]
    client.products_services = draft["products_services"]
    client.target_audience = draft["target_audience"]
    client.value_proposition = draft["value_proposition"]
    client.business_objectives = draft["business_objectives"]
    client.communication_tone = draft["communication_tone"]
    client.social_media_urls = draft["social_media_urls"]
    # The user typed the company name at creation, so keep it.
    client.last_extraction_at = datetime.now(timezone.utc)
    db.commit()
    _set_step(db, job, "profile", "ok", f"Profile extracted from {len(pages)} pages")


def _onboard_branding(db, job: OnboardingJob, client: Client) -> None:
    _set_step(db, job, "branding", "running", "Looking for logo & site icon…")
    _apply_site_branding(db, client)
    db.refresh(client)
    found = [name for name, key in (("logo", client.logo_object_key), ("photo", client.avatar_object_key)) if key]
    _set_step(db, job, "branding", "ok", "Recovered " + (" + ".join(found) if found else "nothing (left default)"))


def _onboard_brand(db, job: OnboardingJob, client: Client) -> None:
    # Respect Brand Memory a user edited by hand. The AI tags its own snapshots
    # as "onboarding", so an AI-generated version is still refreshed on re-run.
    latest = db.scalar(
        select(BrandMemoryVersion)
        .where(BrandMemoryVersion.client_id == client.id)
        .order_by(BrandMemoryVersion.created_at.desc())
        .limit(1)
    )
    if latest is not None and latest.created_by not in ("onboarding", ""):
        _set_step(db, job, "brand_memory", "skipped", "Kept manually-edited brand memory")
        return

    _set_step(db, job, "brand_memory", "running", "Inferring tone, words & colors…")
    profile_text = "\n".join(
        f"{label}: {value}"
        for label, value in (
            ("Company", client.company_name),
            ("Industry", client.industry),
            ("Description", client.description),
            ("Products & services", client.products_services),
            ("Target audience", client.target_audience),
            ("Value proposition", client.value_proposition),
            ("Communication tone", client.communication_tone),
        )
        if value
    )
    bm = generate_brand_memory(db, profile_text)

    # Colors come from the logo (fallback to the avatar) rather than the LLM.
    colors: list[str] = []
    key = client.logo_object_key or client.avatar_object_key
    if key:
        try:
            data, _ = storage.get_object(key)
            colors = extract_brand_colors(data)
        except Exception as exc:  # noqa: BLE001
            logger.info("Could not read %s for colors: %s", key, exc)

    client.brand_tone = bm["brand_tone"]
    client.brand_words_required = bm["brand_words_required"]
    client.brand_words_forbidden = bm["brand_words_forbidden"]
    client.brand_visual_style = bm["brand_visual_style"]
    client.brand_copy_examples = bm["brand_copy_examples"]
    client.brand_legal_disclaimer = bm["brand_legal_disclaimer"]
    if colors:
        client.brand_colors = colors
    snapshot = {**bm, "brand_colors": client.brand_colors}
    db.add(BrandMemoryVersion(client_id=client.id, snapshot=snapshot, created_by="onboarding"))
    db.commit()
    _set_step(db, job, "brand_memory", "ok", f"Tone, words set · {len(client.brand_colors)} colors")


def _onboard_competitors(db, job: OnboardingJob, client: Client) -> None:
    count = int(_setting(db, "default_competitor_count", "5"))
    ctype = _setting(db, "onboarding_competitor_type", "direct")
    scope = _setting(db, "onboarding_competitor_scope", "national")
    depth = _setting(db, "onboarding_competitor_depth", "analyze")
    _set_step(db, job, "competitors", "running", "Identifying competitors…")

    identified = identify_competitors(db, client, count, ctype, scope)
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
    db.commit()

    if depth != "analyze":
        _set_step(db, job, "competitors", "ok", f"{len(new_ids)} found (analysis pending)")
        return

    # Analyze all competitors in parallel (up to 5 concurrent). Haiku is the
    # default model for competitor_analysis — at ~2k tokens/competitor the burst
    # stays well within the 30k token/min rate limit; 429s auto-retry anyway.
    _set_step(db, job, "competitors", "running", f"Analyzing {len(new_ids)} competitors in parallel…")

    def _analyze_one(cid: str) -> None:
        run_competitor_analysis(cid)

    with ThreadPoolExecutor(max_workers=min(5, len(new_ids))) as executor:
        futures = {executor.submit(_analyze_one, cid): cid for cid in new_ids}
        for future in as_completed(futures):
            try:
                future.result()
            except Exception:  # noqa: BLE001
                logger.exception("Competitor analysis %s crashed", futures[future])

    _set_step(db, job, "competitors", "ok", f"{len(new_ids)} identified and analyzed")


def _onboard_articles(db, job: OnboardingJob, client: Client) -> None:
    limit = int(_setting(db, "default_article_count", "30"))
    _set_step(db, job, "articles", "running", "Looking for articles…")
    before = db.scalar(select(func.count()).select_from(Article).where(Article.client_id == client.id)) or 0

    api_base = discover_wp_api(db, client.website_url)
    if api_base:
        _import_articles_wp_parallel(client.id, api_base, limit)
    else:
        _import_articles_crawl_parallel(db, client.id, client.website_url, limit)

    after = db.scalar(select(func.count()).select_from(Article).where(Article.client_id == client.id)) or 0
    source = "WordPress API" if api_base else "site crawl"
    _set_step(db, job, "articles", "ok", f"{after - before} imported via {source}")


def _import_articles_wp_parallel(client_id: str, api_base: str, limit: int) -> None:
    """Fetch WP post list once, then generate summaries in parallel (max 5 threads).

    Each thread uses its own DB session. Duplicate-safe: URL already checked before
    scheduling, with a second check inside each thread as a race guard.
    """
    db = SessionLocal()
    try:
        posts = fetch_wp_posts(db, api_base, limit)
        new_posts = [
            p for p in posts
            if (p.get("url") or "").rstrip("/")
            and not db.scalar(select(Article).where(
                Article.source_url == p["url"].rstrip("/"),
                Article.client_id == client_id,
            ))
        ]
    finally:
        db.close()

    def _save_post(post: dict) -> None:
        thread_db = SessionLocal()
        try:
            url = post["url"].rstrip("/")
            if thread_db.scalar(select(Article).where(Article.source_url == url, Article.client_id == client_id)):
                return
            thread_db.add(Article(
                title=post["title"],
                author=post["author"],
                publication_date=post["publication_date"],
                source_url=url,
                summary=_wp_summary(thread_db, post),
                body=post["body"],
                tags=post["tags"],
                entry_type=ArticleEntryType.auto,
                status=ArticleStatus.active,
                needs_review=False,
                client_id=client_id,
            ))
            thread_db.commit()
        except Exception:  # noqa: BLE001
            thread_db.rollback()
            logger.exception("WP article import failed for %s", post.get("url"))
        finally:
            thread_db.close()

    if not new_posts:
        return
    with ThreadPoolExecutor(max_workers=min(5, len(new_posts))) as executor:
        list(executor.map(_save_post, new_posts))


def _import_articles_crawl_parallel(db, client_id: str, website_url: str, limit: int) -> None:
    """Discover article URLs then fetch + extract in parallel (max 5 threads).

    HTTP fetch and LLM extraction are both I/O-bound, so threading gives a big
    speed-up. Each thread gets its own DB session.
    """
    candidates = discover_article_urls(db, website_url, limit)
    new_urls = [
        url for url in candidates
        if not db.scalar(select(Article).where(
            Article.source_url == url.rstrip("/"),
            Article.client_id == client_id,
        ))
    ][:limit]

    def _process_url(url: str) -> None:
        thread_db = SessionLocal()
        try:
            page = fetch_clean_page(thread_db, url)
            data = extract_article(thread_db, page)
            if not data["is_article"]:
                return
            thread_db.add(Article(
                title=data["title"],
                author=data["author"],
                publication_date=data["publication_date"],
                source_url=url.rstrip("/"),
                summary=data["summary"],
                body=data["body"],
                tags=data["tags"],
                entry_type=ArticleEntryType.auto,
                status=ArticleStatus.active,
                needs_review=False,
                client_id=client_id,
            ))
            thread_db.commit()
        except Exception:  # noqa: BLE001
            thread_db.rollback()
            logger.warning("Article crawl import failed for %s", url)
        finally:
            thread_db.close()

    if not new_urls:
        return
    with ThreadPoolExecutor(max_workers=min(5, len(new_urls))) as executor:
        list(executor.map(_process_url, new_urls))


# Stage registry — drives both the full pipeline and single-step retries.
ONBOARD_STAGES = {
    "profile": _onboard_profile,
    "branding": _onboard_branding,
    "brand_memory": _onboard_brand,
    "competitors": _onboard_competitors,
    "articles": _onboard_articles,
}


def _run_stage(db, job: OnboardingJob, client: Client, key: str) -> bool:
    """Run one stage in isolation; returns True on success, False on error."""
    try:
        ONBOARD_STAGES[key](db, job, client)
        return True
    except Exception as exc:  # noqa: BLE001 — one stage must not abort the rest
        logger.exception("Onboarding %s: step %s failed", job.id, key)
        db.rollback()
        _set_step(db, job, key, "error", str(exc)[:500])
        return False


def _finalize_status(db, job: OnboardingJob) -> None:
    statuses = {s["status"] for s in job.steps}
    if "error" in statuses:
        job.status = OnboardingStatus.completed_with_errors
    elif statuses <= {"ok", "skipped"}:
        job.status = OnboardingStatus.completed
    else:
        job.status = OnboardingStatus.completed_with_errors
    db.commit()


@celery_app.task(name="client.onboard", time_limit=60 * 60, soft_time_limit=60 * 55)
def run_onboarding(job_id: str) -> None:
    """Full client onboarding: profile + branding + brand memory + competitors + articles.

    Execution is split into two phases:
    - Phase 1 (sequential): profile → branding → brand_memory
      (competitors and brand_memory both need the extracted profile data)
    - Phase 2 (parallel): competitors + articles run concurrently in threads,
      each with its own DB session, cutting total time to max(t_competitors, t_articles).

    Each stage is isolated — a failure marks only that step and the pipeline
    continues — so the client is populated as far as possible.
    """
    db = SessionLocal()
    try:
        job = db.get(OnboardingJob, job_id)
        if job is None:
            logger.error("Onboarding job %s not found", job_id)
            return
        client = db.get(Client, job.client_id)
        if client is None:
            job.status = OnboardingStatus.failed
            db.commit()
            return

        # Phase 1: sequential — each step feeds the next.
        for key in ["profile", "branding", "brand_memory"]:
            _run_stage(db, job, client, key)

        # Phase 2: competitors and articles are independent — run in parallel.
        def _run_in_thread(key: str) -> None:
            thread_db = SessionLocal()
            try:
                thread_job = thread_db.get(OnboardingJob, job_id)
                thread_client = thread_db.get(Client, job.client_id)
                if thread_job and thread_client:
                    _run_stage(thread_db, thread_job, thread_client, key)
            finally:
                thread_db.close()

        with ThreadPoolExecutor(max_workers=2) as executor:
            futures = {executor.submit(_run_in_thread, key): key for key in ["competitors", "articles"]}
            for future in as_completed(futures):
                try:
                    future.result()
                except Exception:  # noqa: BLE001
                    logger.exception("Onboarding %s: parallel stage %s crashed", job_id, futures[future])

        db.refresh(job)
        _finalize_status(db, job)
        logger.info("Onboarding job %s finished (%s)", job_id, job.status.value)
    except Exception:  # noqa: BLE001 — always leave the job in a terminal state
        logger.exception("Onboarding job %s crashed", job_id)
        db.rollback()
        job = db.get(OnboardingJob, job_id)
        if job is not None:
            job.status = OnboardingStatus.failed
            db.commit()
    finally:
        db.close()


@celery_app.task(name="client.onboard_step", time_limit=60 * 40, soft_time_limit=60 * 38)
def run_onboarding_step(job_id: str, step_key: str) -> None:
    """Re-run a single onboarding stage (e.g. retry just the failed articles step)."""
    db = SessionLocal()
    try:
        job = db.get(OnboardingJob, job_id)
        if job is None or step_key not in ONBOARD_STAGES:
            logger.error("Onboarding step %s/%s not found", job_id, step_key)
            return
        client = db.get(Client, job.client_id)
        if client is None:
            return
        job.status = OnboardingStatus.running
        _set_step(db, job, step_key, "running", "Retrying…")
        _run_stage(db, job, client, step_key)
        _finalize_status(db, job)
        logger.info("Onboarding step %s/%s finished (%s)", job_id, step_key, job.status.value)
    except Exception:  # noqa: BLE001
        logger.exception("Onboarding step %s/%s crashed", job_id, step_key)
        db.rollback()
    finally:
        db.close()


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

        # Profile extraction and client comparison happen in a single LLM call.
        competitor.analysis_status = AnalysisStatus.extracting
        competitor.pages_crawled = len(pages)
        db.commit()

        analysis = analyze_competitor(db, client, competitor, pages)
        competitor.industry = analysis["industry"]
        competitor.description = analysis["description"]
        competitor.products_services = analysis["products_services"]
        competitor.target_audience = analysis["target_audience"]
        competitor.value_proposition = analysis["value_proposition"]
        competitor.business_objectives = analysis["business_objectives"]
        competitor.communication_tone = analysis["communication_tone"]
        competitor.social_media_urls = analysis["social_media_urls"]
        competitor.positioning = analysis["positioning"]
        competitor.strengths = analysis["strengths"]
        competitor.weaknesses = analysis["weaknesses"]
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
                if source.last_sync_status != ArticleSourceSyncStatus.running:
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
        source.last_sync_status = ArticleSourceSyncStatus.running
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
        source.last_sync_status = ArticleSourceSyncStatus.ok
        source.last_sync_detail = f"Imported {imported}, skipped {skipped} of {len(candidates)} candidates"
        db.commit()
        logger.info("Source %s sync done: %s", source_id, source.last_sync_detail)
    except anthropic.RateLimitError:
        db.rollback()
        src = db.get(ArticleSource, source_id)
        if src:
            src.last_sync_status = ArticleSourceSyncStatus.running
            db.commit()
        raise
    except Exception as exc:  # noqa: BLE001 — always leave the source in a terminal state
        logger.exception("Article source %s sync crashed", source_id)
        db.rollback()
        src = db.get(ArticleSource, source_id)
        if src:
            src.last_sync_status = ArticleSourceSyncStatus.error
            src.last_sync_detail = str(exc)
            src.last_synced_at = datetime.now(timezone.utc)
            db.commit()
    finally:
        db.close()


# --- Social scheduling sweep (SOCIAL_PUBLISHING_PLAN.md Phase 3) ---


@celery_app.task(name="social.publish_due")
def publish_due_posts() -> None:
    """Celery Beat sweep: send every scheduled post whose time has arrived.

    Picks up `ScheduledPost` rows in `scheduled` / `retrying` / `throttled`
    state with `scheduled_at <= now` AND (`next_attempt_at` NULL or <= now),
    re-validates the post is still approved and the channel still connected,
    then hands each to the active connector (Zernio / direct / mock).

    Throttling: `publishing.send_scheduled_post` enforces per-day and min-gap
    limits per account. When a limit is hit, the post is marked `throttled`
    (deferred, NOT failed) and the sweep moves on — never burns through
    retry_count and never bursts a Meta account.

    Retries: transient and rate_limited errors are recorded on the row with
    `next_attempt_at` set by the backoff schedule. The same row is picked up
    again on a future tick once the backoff window has elapsed.

    Approval/channel: re-checked here (not at scheduling time) so a post
    un-approved or a channel disconnected after scheduling never publishes.
    Planned schedules (no channel) and unapproved posts stay pending.
    Each post is isolated — one failure never blocks the rest.
    """
    from app.models.social import ChannelStatus, PublishStatus, ScheduledPost, SocialAccount
    from app.services import publishing

    db = SessionLocal()
    try:
        now = datetime.now(timezone.utc)
        due = db.scalars(
            select(ScheduledPost)
            .where(
                ScheduledPost.status.in_(
                    (PublishStatus.scheduled, PublishStatus.retrying, PublishStatus.throttled)
                ),
                ScheduledPost.scheduled_at <= now,
                (ScheduledPost.next_attempt_at.is_(None)) | (ScheduledPost.next_attempt_at <= now),
            )
            .order_by(ScheduledPost.scheduled_at.asc(), ScheduledPost.created_at.asc())
        ).all()
        for sp in due:
            try:
                post = db.get(Post, sp.post_id)
                if post is None:
                    sp.status = PublishStatus.failed
                    sp.error = "The post no longer exists."
                    sp.error_code = "permanent"
                    sp.last_attempt_at = now
                    db.commit()
                    continue
                if post.approval_status != ApprovalStatus.approved:
                    # Planned schedule that isn't approved yet — leave it pending
                    # (don't fail, don't publish) until it's approved.
                    continue
                if not sp.social_account_id:
                    # Planned schedule with no channel yet — leave it pending
                    # (don't fail, don't publish) until a channel is connected.
                    continue
                channel = db.get(SocialAccount, sp.social_account_id)
                if channel is None or channel.status != ChannelStatus.connected:
                    sp.status = PublishStatus.failed
                    sp.error = "The target channel is no longer connected."
                    sp.error_code = "permanent"
                    sp.last_attempt_at = now
                    db.commit()
                    continue
                publishing.send_scheduled_post(db, sp, post, channel)
                logger.info(
                    "Scheduled post %s processed (status=%s error_code=%s retry=%s)",
                    sp.id, sp.status.value, sp.error_code, sp.retry_count,
                )
            except Exception as exc:  # noqa: BLE001 — one post must not abort the sweep
                logger.exception("Scheduled post %s failed to publish", sp.id)
                db.rollback()
                fresh = db.get(ScheduledPost, sp.id)
                if fresh is not None:
                    fresh.status = PublishStatus.failed
                    fresh.error = f"Unexpected error: {exc}"
                    fresh.error_code = "permanent"
                    fresh.last_attempt_at = datetime.now(timezone.utc)
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
        # Elements are kept; their posts and visual renditions are rebuilt.
        for old in db.scalars(select(Post).where(Post.campaign_id == campaign.id)).all():
            db.delete(old)
        elements = db.scalars(
            select(CampaignElement)
            .where(CampaignElement.campaign_id == campaign.id)
            .order_by(CampaignElement.position)
        ).all()
        for el in elements:
            for img in list(el.images):
                db.delete(img)
            for vid in list(el.videos):
                db.delete(vid)
        db.commit()

        if not elements:
            campaign.status = CampaignStatus.failed
            campaign.error = "This campaign has no elements to generate."
            db.commit()
            return

        article = _resolve_article(db, campaign)
        context = build_context(db, client, campaign, article["text"])
        cp_by_platform = {
            cp.platform: cp
            for cp in db.scalars(
                select(CampaignPlatform).where(
                    CampaignPlatform.campaign_id == campaign.id, CampaignPlatform.is_active.is_(True)
                )
            ).all()
        }

        # Visual Agent + per-platform Editorial Agents all run as one concurrent batch:
        # they are independent LLM calls over the same context, so the Visual round-trip
        # is hidden under the editorial waves. The shared editorial context is cached so
        # the fan-out stays within the rate limit.
        platforms_used = [p for p in Platform if any(p.value in (el.platforms or []) for el in elements)]
        platform_elements: list[tuple] = []
        els_by_platform: dict = {}
        for platform in platforms_used:
            cp = cp_by_platform.get(platform)
            if cp is None:
                continue
            els = [el for el in elements if platform.value in (el.platforms or [])]
            platform_elements.append((cp, els))
            els_by_platform[platform] = els

        prompts, posts_by_platform = generate_visuals_and_copy(
            db, client, campaign, elements, platform_elements, context,
            article_meta=article, generate_images=campaign.generate_images,
        )

        # Visual prompts → media rows (one per aspect ratio, reused across platforms).
        for el, slots in zip(elements, prompts):
            ratios = list(dict.fromkeys((el.platform_ratios or {}).values()))
            if el.element_type == ElementType.video:
                for ratio in ratios:
                    db.add(PostVideo(
                        element_id=el.id,
                        aspect_ratio=ratio,
                        duration_seconds=el.video_duration_seconds,
                        prompt=slots[0]["prompt"] if slots else "",
                        negative_prompt=slots[0]["negative_prompt"] if slots else "",
                    ))
            elif el.element_type != ElementType.text:
                for ratio in ratios:
                    for slot_index, slot in enumerate(slots):
                        db.add(PostImage(
                            element_id=el.id,
                            slot_index=slot_index,
                            aspect_ratio=ratio,
                            prompt=slot["prompt"],
                            negative_prompt=slot["negative_prompt"],
                        ))

        # Editorial copy → posts (one per element targeting each platform).
        for platform, posts_data in posts_by_platform.items():
            for position, (el, pdata) in enumerate(zip(els_by_platform[platform], posts_data)):
                db.add(Post(
                    campaign_id=campaign.id,
                    element_id=el.id,
                    platform=platform,
                    position=position,
                    headline=pdata["headline"],
                    copy=pdata["copy"],
                    cta=pdata["cta"],
                    hashtags=pdata["hashtags"],
                    best_time=pdata["best_time"],
                    rationale=pdata["rationale"],
                ))
        db.commit()

        campaign.status = CampaignStatus.ready
        db.commit()
        logger.info(
            "Campaign %s generated: %d element(s) on %d platform(s)",
            campaign_id, len(elements), len(platforms_used),
        )

        # Auto-dispatch image and video generation for every media record created above.
        all_images = db.scalars(
            select(PostImage).join(CampaignElement).where(CampaignElement.campaign_id == campaign_id)
        ).all()
        for img in all_images:
            run_image_generation.delay(img.id)

        all_videos = db.scalars(
            select(PostVideo).join(CampaignElement).where(CampaignElement.campaign_id == campaign_id)
        ).all()
        for vid in all_videos:
            run_video_generation.delay(vid.id)

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
    """Regenerate the copy for a single platform (PRD §5.6 step 21c).

    Visual renditions are shared across platforms, so only posts are rebuilt.
    """
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

        els = [
            el for el in db.scalars(
                select(CampaignElement)
                .where(CampaignElement.campaign_id == campaign_id)
                .order_by(CampaignElement.position)
            ).all()
            if cp.platform.value in (el.platforms or [])
        ]
        if els:
            article = _resolve_article(db, campaign)
            context = build_context(db, client, campaign, article["text"])
            posts_data = generate_platform_copy(db, client, campaign, cp, els, context, article)
            for position, (el, pdata) in enumerate(zip(els, posts_data)):
                db.add(Post(
                    campaign_id=campaign.id, element_id=el.id, platform=cp.platform, position=position,
                    headline=pdata["headline"], copy=pdata["copy"], cta=pdata["cta"],
                    hashtags=pdata["hashtags"], best_time=pdata["best_time"],
                    rationale=pdata["rationale"],
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


@celery_app.task(name="image.generate")
def run_image_generation(image_id: str, image_model_id: str | None = None) -> None:
    """Generate a post image with the configured provider (async, same as videos)."""
    from app.models.campaign import VideoStatus
    from app.services import storage
    from app.services.image_gen import generate_image, get_image_model

    db = SessionLocal()
    try:
        image = db.get(PostImage, image_id)
        if image is None:
            logger.error("Post image %s not found", image_id)
            return
        model = get_image_model(db, image_model_id or image.image_model_id)
        image.status = VideoStatus.generating
        image.error = ""
        db.commit()

        prompt = image.prompt
        if image.additional_guidance:
            prompt = f"{prompt}\n\nAdditional guidance: {image.additional_guidance}"

        element = db.get(CampaignElement, image.element_id)
        campaign_id = element.campaign_id if element else "unknown"
        # If this is the slide's base ratio, lock the other ratios right away.
        if element is not None and _is_primary_image(element, image):
            _set_slot_generating(db, element, image)
            db.commit()
        references = _campaign_reference_bytes(db, campaign_id) if element else []
        logo_bytes = _client_logo_bytes(db, campaign_id, image) if element else None
        fallback_logo = False
        try:
            data, content_type = generate_image(
                db, model, prompt, image.negative_prompt, image.aspect_ratio,
                reference_bytes=references, logo_bytes=logo_bytes,
            )
        except ExtractionError as exc:
            # The image-to-image endpoint (logo/refs) is flaky (OpenAI 520s). Rather
            # than fail the slot, fall back to plain text-to-image and composite the
            # logo afterwards if one was requested.
            if not (references or logo_bytes):
                raise
            logger.warning("Image-to-image failed for %s (%s); falling back to text-to-image", image.id, exc)
            data, content_type = generate_image(db, model, prompt, image.negative_prompt, image.aspect_ratio)
            fallback_logo = bool(logo_bytes)
        version = len(image.generation_history) + 1
        key = f"campaigns/{campaign_id}/images/{image.id}/v{version}.png"
        storage.upload_object(key, data, content_type)
        from app.services.display_variants import generate_display_variants
        generate_display_variants(data, f"campaigns/{campaign_id}/images/{image.id}/display_base")

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
        if fallback_logo:
            _composite_logo_fallback(db, image, data)  # bake failed → overlay the logo instead
        image.status = VideoStatus.ready
        db.commit()
        logger.info("Image %s generated (%d bytes)", image_id, len(data))

        # Auto-derive the element's other ratios from this base so every platform
        # shares one visual (AI reframe with a local centre-crop fallback). Only the
        # element's primary ratio cascades, so regenerating a sibling won't loop.
        if element is not None and _is_primary_image(element, image):
            if any(
                s.id != image.id and s.slot_index == image.slot_index and not s.is_uploaded
                for s in element.images
            ):
                derive_element_ratios.delay(image.id, model.id)
    except ExtractionError as exc:
        _fail_image(db, image_id, str(exc))
        _reset_slot_after_fail(db, image_id)
    except Exception as exc:  # noqa: BLE001 — slot must always end in a terminal state
        logger.exception("Image generation %s crashed", image_id)
        _fail_image(db, image_id, f"Unexpected error: {exc}")
        _reset_slot_after_fail(db, image_id)
    finally:
        db.close()


def _fail_image(db, image_id: str, error: str) -> None:
    from app.models.campaign import VideoStatus

    image = db.get(PostImage, image_id)
    if image is not None:
        image.status = VideoStatus.failed
        image.error = error
        db.commit()


def _campaign_reference_bytes(db, campaign_id: str) -> list[bytes]:
    """Load the campaign's reference images (product photos etc.) as raw bytes."""
    from app.models.campaign import ReferenceImage
    from app.services import storage

    out: list[bytes] = []
    refs = db.query(ReferenceImage).filter(ReferenceImage.campaign_id == campaign_id).all()
    for r in refs:
        try:
            data, _ = storage.get_object(r.object_key)
            out.append(data)
        except Exception as exc:  # noqa: BLE001 — a missing reference must not block generation
            logger.warning("Could not load reference image %s: %s", r.id, exc)
    return out


def _set_slot_generating(db, element: "CampaignElement", primary: PostImage) -> None:
    """Mark the other ratios of the same slide as generating the moment the base
    starts, so the UI locks them and the user can't kick off a rival generation."""
    from app.models.campaign import VideoStatus

    for sib in element.images:
        if sib.id != primary.id and sib.slot_index == primary.slot_index and not sib.is_uploaded:
            sib.status = VideoStatus.generating
            sib.error = ""


def _reset_slot_after_fail(db, image_id: str) -> None:
    """If the base generation failed, release the siblings we pre-marked so they
    don't stay stuck in 'generating' (derivation only runs on success)."""
    from app.models.campaign import CampaignElement, VideoStatus

    image = db.get(PostImage, image_id)
    element = db.get(CampaignElement, image.element_id) if image else None
    if element is None:
        return
    for sib in element.images:
        if (
            sib.id != image.id
            and sib.slot_index == image.slot_index
            and sib.status == VideoStatus.generating
            and not sib.is_uploaded
        ):
            sib.status = VideoStatus.ready if sib.base_object_key else VideoStatus.draft
            sib.error = ""
    db.commit()


def _composite_logo_fallback(db, image: PostImage, base_bytes: bytes) -> None:
    """When baking the logo into the image fails, place it as an overlay instead
    (vision-decided spot) so the logo still appears."""
    from app.services.logo_placement import compute_logo_geom

    try:
        state = dict(image.canvas_state or {})
        state["logo"] = compute_logo_geom(db, base_bytes)
        state.setdefault("logo_enabled", True)
        image.canvas_state = state
        image.composited_object_key = ""
    except Exception as exc:  # noqa: BLE001 — logo fallback must not fail generation
        logger.warning("Logo composite fallback failed for %s: %s", image.id, exc)


def _client_logo_bytes(db, campaign_id: str, image: PostImage) -> bytes | None:
    """Load the client logo so the image model can render it into the image —
    unless this image opted out of the logo (logo_enabled False)."""
    from app.models.campaign import Campaign
    from app.models.client import Client
    from app.services import storage

    state = image.canvas_state or {}
    if state.get("logo_enabled", True) is False:
        return None
    campaign = db.get(Campaign, campaign_id)
    client = db.get(Client, campaign.client_id) if campaign else None
    if client is None or not client.logo_object_key:
        return None
    try:
        data, _ = storage.get_object(client.logo_object_key)
        return data
    except Exception as exc:  # noqa: BLE001 — missing logo must not block generation
        logger.warning("Could not load client logo for %s: %s", image.id, exc)
        return None


# Ratio precedence for choosing an element's primary image (mirrors ratios.ts).
_RATIO_PRIORITY = ["1:1", "4:5", "9:16", "16:9", "1.91:1"]


def _ratio_rank(im: PostImage):
    r = _RATIO_PRIORITY.index(im.aspect_ratio) if im.aspect_ratio in _RATIO_PRIORITY else len(_RATIO_PRIORITY)
    return (r, im.created_at.isoformat() if im.created_at else "")


def _is_primary_image(element: "CampaignElement", image: PostImage) -> bool:
    """True if `image` is the base ratio of its carousel slide. Derivation is scoped

    to one slot (carousel slide): the other RATIOS of the same slide are derived
    from it — never the other slides, which are distinct content.
    """
    same_slot = [im for im in element.images if im.slot_index == image.slot_index]
    if len(same_slot) <= 1:
        return False
    return min(same_slot, key=_ratio_rank).id == image.id


@celery_app.task(name="image.derive_ratios")
def derive_element_ratios(source_image_id: str, image_model_id: str | None = None) -> None:
    """Regenerate every other ratio of an element from one base image, so all
    platforms share the same visual. AI outpainting first, local crop as fallback."""
    from app.models.campaign import VideoStatus
    from app.services import storage
    from app.services.image_gen import generate_image_from, get_image_model, reframe_local

    db = SessionLocal()
    try:
        source = db.get(PostImage, source_image_id)
        if source is None or not source.base_object_key:
            return
        element = db.get(CampaignElement, source.element_id)
        if element is None:
            return
        model = get_image_model(db, image_model_id or source.image_model_id)
        source_bytes, _ = storage.get_object(source.base_object_key)
        # If the base wears its logo as an overlay (baking failed/fallback), the
        # derived ratios must overlay one too so all ratios stay consistent.
        source_uses_composite_logo = bool((source.canvas_state or {}).get("logo"))

        for sib in element.images:
            # Only the OTHER RATIOS of the same carousel slide — never other slides.
            if sib.id == source.id or sib.slot_index != source.slot_index or sib.is_uploaded:
                continue
            sib.status = VideoStatus.generating
            sib.error = ""
            db.commit()
            try:
                effective_prompt = sib.prompt or source.prompt
                try:
                    data, ct = generate_image_from(
                        db, model, source_bytes, effective_prompt, sib.negative_prompt, sib.aspect_ratio
                    )
                except Exception as exc:  # noqa: BLE001 — any AI failure falls back to local crop
                    logger.warning("AI reframe failed for %s (%s); using local crop", sib.id, exc)
                    data, ct = reframe_local(source_bytes, sib.aspect_ratio)

                version = len(sib.generation_history) + 1
                key = f"campaigns/{element.campaign_id}/images/{sib.id}/v{version}.png"
                storage.upload_object(key, data, ct)
                from app.services.display_variants import generate_display_variants
                generate_display_variants(data, f"campaigns/{element.campaign_id}/images/{sib.id}/display_base")
                history = list(sib.generation_history)
                history.append({
                    "object_key": key,
                    "prompt": effective_prompt,
                    "created_at": datetime.now(timezone.utc).isoformat(),
                })
                sib.generation_history = history
                sib.base_object_key = key
                sib.is_uploaded = False
                sib.image_model_id = model.id
                sib.composited_object_key = ""
                if source_uses_composite_logo:
                    _composite_logo_fallback(db, sib, data)
                sib.status = VideoStatus.ready
                db.commit()
                logger.info("Derived ratio %s for image %s", sib.aspect_ratio, sib.id)
            except Exception as exc:  # noqa: BLE001 — each sibling ends in a terminal state
                logger.exception("Deriving ratio for %s failed", sib.id)
                _fail_image(db, sib.id, f"Reframe error: {exc}")
    finally:
        db.close()


@celery_app.task(name="video.generate")
def run_video_generation(video_id: str) -> None:
    """Generate a post video with the configured provider (long-running)."""
    from app.models.campaign import PostVideo, VideoStatus
    from app.services import storage
    from app.services.video_gen import generate_video, get_video_model

    db = SessionLocal()
    try:
        video = db.get(PostVideo, video_id)
        if video is None:
            logger.error("Post video %s not found", video_id)
            return
        model = get_video_model(db, video.video_model_id)
        video.status = VideoStatus.generating
        video.error = ""
        video.video_model_id = model.id
        db.commit()

        data, content_type = generate_video(
            model, video.prompt, video.negative_prompt, video.aspect_ratio, video.duration_seconds
        )

        element = db.get(CampaignElement, video.element_id)
        campaign_id = element.campaign_id if element else "unknown"
        # Overlay the client logo (vision-placed on the first frame) unless disabled.
        if element is not None and video.logo_enabled:
            data = _overlay_video_logo(db, campaign_id, data)
            content_type = "video/mp4"
        version = len(video.generation_history) + 1
        key = f"campaigns/{campaign_id}/videos/{video.id}/v{version}.mp4"
        storage.upload_object(key, data, content_type)

        history = list(video.generation_history)
        history.append({
            "object_key": key,
            "prompt": video.prompt,
            "created_at": datetime.now(timezone.utc).isoformat(),
        })
        video.generation_history = history
        video.base_object_key = key
        video.is_uploaded = False
        video.status = VideoStatus.ready
        db.commit()
        logger.info("Video %s generated (%d bytes)", video_id, len(data))
    except ExtractionError as exc:
        _fail_video(db, video_id, str(exc))
    except Exception as exc:  # noqa: BLE001 — slot must always end in a terminal state
        logger.exception("Video generation %s crashed", video_id)
        _fail_video(db, video_id, f"Unexpected error: {exc}")
    finally:
        db.close()


def _fail_video(db, video_id: str, error: str) -> None:
    from app.models.campaign import PostVideo, VideoStatus

    video = db.get(PostVideo, video_id)
    if video is not None:
        video.status = VideoStatus.failed
        video.error = error
        db.commit()


def _overlay_video_logo(db, campaign_id: str, video_bytes: bytes) -> bytes:
    """Overlay the client logo onto a generated clip — the vision model picks the
    spot from the first frame, then ffmpeg burns it in. Best-effort."""
    from app.models.campaign import Campaign
    from app.models.client import Client
    from app.services import storage
    from app.services.logo_placement import compute_logo_geom
    from app.services.video_edit import extract_first_frame, overlay_logo

    campaign = db.get(Campaign, campaign_id)
    client = db.get(Client, campaign.client_id) if campaign else None
    if client is None or not client.logo_object_key:
        return video_bytes
    try:
        logo_bytes, _ = storage.get_object(client.logo_object_key)
        geom = compute_logo_geom(db, extract_first_frame(video_bytes))
        return overlay_logo(video_bytes, logo_bytes, geom)
    except Exception as exc:  # noqa: BLE001 — overlay must not fail generation
        logger.warning("Video logo overlay failed for campaign %s: %s", campaign_id, exc)
        return video_bytes


@celery_app.task(name="video.derive_ratios")
def derive_video_ratios(source_video_id: str) -> None:
    """Reframe one base clip into the element's other aspect ratios locally with
    ffmpeg — cheap, no re-generation (user triggers this when happy with the base)."""
    from app.models.campaign import VideoStatus
    from app.services import storage
    from app.services.video_edit import reframe_video

    db = SessionLocal()
    try:
        source = db.get(PostVideo, source_video_id)
        if source is None or not source.base_object_key:
            return
        element = db.get(CampaignElement, source.element_id)
        if element is None:
            return
        source_bytes, _ = storage.get_object(source.base_object_key)
        for sib in element.videos:
            if sib.id == source.id or sib.is_uploaded:
                continue
            sib.status = VideoStatus.generating
            sib.error = ""
            db.commit()
            try:
                data = reframe_video(source_bytes, sib.aspect_ratio)
                version = len(sib.generation_history) + 1
                key = f"campaigns/{element.campaign_id}/videos/{sib.id}/v{version}.mp4"
                storage.upload_object(key, data, "video/mp4")
                history = list(sib.generation_history)
                history.append({
                    "object_key": key,
                    "prompt": source.prompt,
                    "created_at": datetime.now(timezone.utc).isoformat(),
                })
                sib.generation_history = history
                sib.base_object_key = key
                sib.is_uploaded = False
                sib.video_model_id = source.video_model_id
                sib.status = VideoStatus.ready
                db.commit()
                logger.info("Derived video ratio %s for %s", sib.aspect_ratio, sib.id)
            except Exception as exc:  # noqa: BLE001 — each sibling ends terminal
                logger.exception("Deriving video ratio for %s failed", sib.id)
                _fail_video(db, sib.id, f"Reframe error: {exc}")
    finally:
        db.close()


def _wp_summary(db, wp: dict) -> str:
    """LLM summary for a WordPress post, falling back to its excerpt on failure."""
    try:
        summary = summarize_article(db, wp["title"], wp["body"])
        if summary:
            return summary
    except anthropic.RateLimitError:
        raise
    except Exception as exc:  # noqa: BLE001 — never block import on summary failure
        logger.warning("WP summary failed for %s: %s", wp.get("url"), exc)
    return wp.get("excerpt", "")


@celery_app.task(
    name="article.import_client",
    autoretry_for=(anthropic.RateLimitError,),
    retry_backoff=70,
    retry_backoff_max=300,
    max_retries=3,
)
def import_client_articles(
    client_id: str,
    api_base: str,
    limit: int,
    from_date: str | None = None,
    to_date: str | None = None,
) -> None:
    """Import a client's articles via the WordPress REST API (PRD §7).

    Idempotent: existing articles (by URL) are skipped without calling the LLM, so
    re-running after a rate limit or re-importing the same date range is always safe.
    `from_date`/`to_date` are ISO date strings (YYYY-MM-DD); when supplied the WP
    REST API filters by publication date server-side.
    """
    from datetime import date as _date

    db = SessionLocal()
    try:
        client = db.get(Client, client_id)
        if client is None:
            logger.error("Client %s not found for article import", client_id)
            return
        after = _date.fromisoformat(from_date) if from_date else None
        before = _date.fromisoformat(to_date) if to_date else None
        posts = fetch_wp_posts(db, api_base, limit, after_date=after, before_date=before)
        imported = 0
        skipped = 0
        for post in posts:
            url = post["url"]
            if not url or db.scalar(select(Article).where(Article.source_url == url.rstrip("/"))):
                skipped += 1
                continue
            db.add(
                Article(
                    title=post["title"],
                    author=post["author"],
                    publication_date=post["publication_date"],
                    source_url=url.rstrip("/"),
                    summary=_wp_summary(db, post),
                    body=post["body"],
                    tags=post["tags"],
                    entry_type=ArticleEntryType.auto,
                    status=ArticleStatus.active,
                    needs_review=False,
                    client_id=client.id,
                )
            )
            db.commit()
            imported += 1
        logger.info(
            "Client %s WordPress import done: imported %d, skipped %d of %d",
            client_id, imported, skipped, len(posts),
        )
    except anthropic.RateLimitError:
        db.rollback()
        raise
    except Exception:  # noqa: BLE001
        logger.exception("Client %s WordPress import crashed", client_id)
        db.rollback()
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
        # Prefer the WordPress REST API (structured data, LLM only for the summary);
        # fall back to crawl + LLM extraction for non-WordPress pages.
        wp = fetch_wp_post_by_url(db, article.source_url)
        if wp is not None:
            article.title = wp["title"] or article.title
            article.author = wp["author"]
            article.publication_date = wp["publication_date"]
            article.body = wp["body"]
            article.tags = wp["tags"]
            article.summary = _wp_summary(db, wp)
        else:
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


# --- Watchdog (stalled-job cleanup) ---

# Conservative timeouts — well above task hard limits so we only catch truly
# abandoned jobs (worker crashed, OOM-killed, container restart mid-task).
_WATCHDOG_TIMEOUTS = {
    "onboarding":        timedelta(minutes=75),   # task hard limit: 60 min
    "extraction":        timedelta(minutes=45),   # no explicit limit; crawl ≤ 30 min
    "competitor_search": timedelta(minutes=25),   # identification + web search
    "competitor":        timedelta(minutes=25),   # per-competitor crawl + LLM
    "campaign":          timedelta(minutes=35),   # editorial + visual agents
    "post_image":        timedelta(minutes=20),   # image generation
    "post_video":        timedelta(minutes=50),   # video generation (longest)
}

_WATCHDOG_MSG = "Timed out — watchdog expired after {} min with no progress"


@celery_app.task(name="watchdog.sweep")
def watchdog_sweep() -> None:
    """Scan for jobs stuck in an in-progress state and mark them failed.

    Runs every 10 minutes via Celery beat. Uses updated_at as the staleness
    clock: every ORM write refreshes it automatically, so only truly abandoned
    records (worker crashed, OOM-killed, network loss) cross the threshold.

    Does NOT requeue — stuck tasks may have crashed for good reason. Users
    can retry manually via the UI retry buttons.
    """
    from app.models.campaign import PostImage, PostVideo, VideoStatus

    db = SessionLocal()
    now = datetime.now(timezone.utc)
    fixed = 0

    try:
        # OnboardingJob: running too long → failed; mark any "running" steps as error.
        cutoff = now - _WATCHDOG_TIMEOUTS["onboarding"]
        for job in db.scalars(
            select(OnboardingJob).where(
                OnboardingJob.status == OnboardingStatus.running,
                OnboardingJob.updated_at < cutoff,
            )
        ).all():
            for step in job.steps:
                if step["status"] == "running":
                    step["status"] = "error"
                    step["detail"] = _WATCHDOG_MSG.format(75)
            flag_modified(job, "steps")
            job.status = OnboardingStatus.failed
            fixed += 1
            logger.warning("Watchdog: OnboardingJob %s stuck >75 min — failed", job.id)

        # ExtractionJob: crawling or extracting too long.
        cutoff = now - _WATCHDOG_TIMEOUTS["extraction"]
        for job in db.scalars(
            select(ExtractionJob).where(
                ExtractionJob.status.in_([JobStatus.crawling, JobStatus.extracting]),
                ExtractionJob.updated_at < cutoff,
            )
        ).all():
            job.status = JobStatus.failed
            job.error = _WATCHDOG_MSG.format(45)
            fixed += 1
            logger.warning("Watchdog: ExtractionJob %s stuck >45 min — failed", job.id)

        # CompetitorSearchJob: stuck identifying.
        cutoff = now - _WATCHDOG_TIMEOUTS["competitor_search"]
        for job in db.scalars(
            select(CompetitorSearchJob).where(
                CompetitorSearchJob.status == SearchJobStatus.identifying,
                CompetitorSearchJob.updated_at < cutoff,
            )
        ).all():
            job.status = SearchJobStatus.failed
            job.error = _WATCHDOG_MSG.format(25)
            fixed += 1
            logger.warning("Watchdog: CompetitorSearchJob %s stuck >25 min — failed", job.id)

        # Competitor: stuck in any active analysis state.
        cutoff = now - _WATCHDOG_TIMEOUTS["competitor"]
        for comp in db.scalars(
            select(Competitor).where(
                Competitor.analysis_status.in_([
                    AnalysisStatus.crawling,
                    AnalysisStatus.extracting,
                ]),
                Competitor.updated_at < cutoff,
            )
        ).all():
            comp.analysis_status = AnalysisStatus.failed
            comp.analysis_error = _WATCHDOG_MSG.format(25)
            fixed += 1
            logger.warning(
                "Watchdog: Competitor %s (%s) stuck >25 min — failed",
                comp.id, comp.company_name,
            )

        # Campaign: stuck generating.
        cutoff = now - _WATCHDOG_TIMEOUTS["campaign"]
        for camp in db.scalars(
            select(Campaign).where(
                Campaign.status == CampaignStatus.generating,
                Campaign.updated_at < cutoff,
            )
        ).all():
            camp.status = CampaignStatus.failed
            camp.error = _WATCHDOG_MSG.format(35)
            fixed += 1
            logger.warning("Watchdog: Campaign %s stuck >35 min — failed", camp.id)

        # PostImage: stuck generating.
        cutoff = now - _WATCHDOG_TIMEOUTS["post_image"]
        for img in db.scalars(
            select(PostImage).where(
                PostImage.status == VideoStatus.generating,
                PostImage.updated_at < cutoff,
            )
        ).all():
            img.status = VideoStatus.failed
            img.error = _WATCHDOG_MSG.format(20)
            fixed += 1
            logger.warning("Watchdog: PostImage %s stuck >20 min — failed", img.id)

        # PostVideo: stuck generating.
        cutoff = now - _WATCHDOG_TIMEOUTS["post_video"]
        for vid in db.scalars(
            select(PostVideo).where(
                PostVideo.status == VideoStatus.generating,
                PostVideo.updated_at < cutoff,
            )
        ).all():
            vid.status = VideoStatus.failed
            vid.error = _WATCHDOG_MSG.format(50)
            fixed += 1
            logger.warning("Watchdog: PostVideo %s stuck >50 min — failed", vid.id)

        if fixed:
            db.commit()
            logger.info("Watchdog: resolved %d stalled job(s)", fixed)
        else:
            logger.debug("Watchdog: sweep clean — no stalled jobs")

    except Exception:  # noqa: BLE001
        logger.exception("Watchdog sweep crashed")
        db.rollback()
    finally:
        db.close()
