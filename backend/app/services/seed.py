"""Idempotent first-run seeding: admin user, LLM configs, image models, settings."""
import logging

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.crypto import decrypt_secret, encrypt_secret
from app.core.security import hash_password
from app.models.client import Client
from app.models.llm import ImageModel, LLMConfig, LLMFunction, ProviderCredential, VideoModel
from app.models.org import Organization
from app.models.setting import Setting
from app.models.user import OrgRole, User, UserRole

logger = logging.getLogger(__name__)

DEFAULT_SYSTEM_PROMPTS = {
    LLMFunction.client_extraction: (
        "You are a marketing analyst. You receive the crawled text content of a company "
        "website and must extract a structured client profile. Be factual: only state what "
        "the content supports. Respond in English."
    ),
    LLMFunction.editorial_agent: (
        "You are an expert social media copywriter. You write platform-native copy that "
        "respects each platform's character limits, brand voice, and Brand Memory rules. "
        "You always return valid JSON exactly as instructed and never invent facts about "
        "the brand."
    ),
    LLMFunction.visual_agent: (
        "You are an expert art director who writes detailed prompts for AI image "
        "generation models. Your prompts specify subject, composition, style, lighting, "
        "and color palette aligned with the brand, plus a negative prompt. "
        "When the brand has a mascot or character, feature it as the protagonist with "
        "expressive, human-like poses and emotions. Favor meme-style social posts: a "
        "short, witty, first-person headline (max ~12 words) rendered as bold text at "
        "the top of the image — relatable industry humor, light sarcasm, never mean — "
        "with the exact headline wording in double quotes and a scene that visually "
        "sells the joke. You always return valid JSON exactly as instructed."
    ),
    LLMFunction.competitor_identification: (
        "You are a competitive intelligence analyst. Given a client profile, you "
        "identify real, currently operating competitor companies in the same market "
        "and region. You never invent companies and you always return valid JSON "
        "exactly as instructed."
    ),
    LLMFunction.competitor_analysis: (
        "You are a competitive intelligence analyst. You receive crawled content from "
        "a competitor's website and produce a factual analysis of their positioning, "
        "offerings, and messaging. Only state what the content supports. Respond in "
        "English and always return valid JSON exactly as instructed."
    ),
    LLMFunction.article_analysis: (
        "You are an editorial analyst. You receive the text of a web article and "
        "extract its key topics, claims, and takeaways relevant to the client's "
        "industry. Be factual and concise, and always return valid JSON exactly as "
        "instructed."
    ),
    LLMFunction.article_relevance_scoring: (
        "You are an editorial analyst. You score how relevant an article is to a "
        "client's brand, audience, and content strategy, with a short justification. "
        "You always return valid JSON exactly as instructed."
    ),
    LLMFunction.brand_memory: (
        "You are a brand strategist. From a company's profile you infer its Brand "
        "Memory: tone of voice, words/phrases to always or never use, visual style, "
        "a few on-brand example copy lines, and any recurring legal disclaimer. Be "
        "factual and only infer what the profile supports. Respond in English and "
        "always return valid JSON exactly as instructed."
    ),
}

DEFAULT_SETTINGS = [
    ("default_ui_language", "en", "Default UI language"),
    ("default_content_language", "en", "Default content generation language"),
    ("default_competitor_count", "5", "Default number of competitors to research"),
    ("crawler_max_depth", "5", "Max link levels to follow from the homepage"),
    ("crawler_max_pages", "200", "Max pages to crawl per site"),
    ("crawler_timeout_seconds", "10", "Max wait time per page response (seconds)"),
    ("crawler_concurrency", "8", "How many pages the crawler fetches in parallel per depth level"),
    ("crawler_excluded_paths", "", "Comma-separated regex patterns of URL paths to skip"),
    ("crawler_user_agent", "AIMarketingPlatformBot/1.0", "User-Agent header sent by the crawler"),
    ("competitor_crawl_max_depth", "3", "Max link depth when crawling competitor sites"),
    ("competitor_crawl_max_pages", "12", "Max pages when crawling competitor sites (keeps analysis fast)"),
    # Client onboarding pipeline defaults (auto-run on client creation)
    ("default_article_count", "30", "Default number of articles to import during client onboarding"),
    ("onboarding_competitor_depth", "analyze", "Competitor depth during onboarding: 'analyze' (identify + full analysis) or 'identify' (list only)"),
    ("onboarding_competitor_type", "direct", "Competitor type sought during onboarding: 'direct' or 'indirect'"),
    ("onboarding_competitor_scope", "national", "Competitor geographic scope during onboarding: 'local', 'national' or 'international'"),
    ("onboarding_auto_run", "true", "Automatically run the full onboarding pipeline when a client is created"),
    ("show_onboarding_panel", "false", "Show the Onboarding panel on the client detail page. Keep OFF in production; enable for testing/debugging the pipeline."),
    ("dev_mode", "false", "Developer/testing mode: shows admin action buttons (Analyze Website, Import Articles) on the client detail page."),
    ("show_article_library", "true", "Show the Article Library link in the left navigation sidebar. Disable to hide the global library and keep article access per-client."),
    # Direct social publishing scopes and OAuth URLs
    ("facebook_oauth_scopes", "pages_manage_posts,pages_read_engagement,pages_show_list", "OAuth scopes to request for Facebook Pages (comma-separated)"),
    ("instagram_oauth_scopes", "instagram_business_basic,instagram_business_content_publish", "OAuth scopes to request for Instagram (comma-separated)"),
    ("instagram_oauth_url", "https://api.instagram.com/oauth/authorize", "Instagram OAuth authorization URL"),
]

DEFAULT_IMAGE_MODELS = [
    ("Gemini 2.5 Flash Image (Nano Banana)", "google/gemini-2.5-flash-image", True),
    ("Gemini 3 Pro Image (Preview)", "google/gemini-3-pro-image-preview", False),
]


def seed(db: Session) -> None:
    settings = get_settings()

    if db.scalar(select(User).limit(1)) is None:
        db.add(
            User(
                email=settings.admin_email.lower(),
                full_name="Administrator",
                hashed_password=hash_password(settings.admin_password),
                role=UserRole.admin,
                is_platform_admin=True,  # the env admin is the platform system admin (us)
            )
        )
        logger.info("Seeded initial platform admin %s", settings.admin_email)

    anthropic_key = encrypt_secret(settings.anthropic_api_key)
    existing_configs = {c.function: c for c in db.scalars(select(LLMConfig)).all()}
    for cfg in existing_configs.values():
        if not cfg.system_prompt and (default := DEFAULT_SYSTEM_PROMPTS.get(cfg.function)):
            cfg.system_prompt = default
    # competitor_analysis uses Haiku: 3-5× faster, 20× cheaper, good enough for
    # comparative analysis. All other functions default to Sonnet.
    _HAIKU_FUNCTIONS = {LLMFunction.competitor_analysis}
    for function in LLMFunction:
        if function not in existing_configs:
            db.add(
                LLMConfig(
                    function=function,
                    provider="anthropic",
                    model_name="claude-haiku-4-5-20251001" if function in _HAIKU_FUNCTIONS else "claude-sonnet-4-6",
                    api_key_encrypted=anthropic_key,
                    temperature=0.3 if "extraction" in function.value or "analysis" in function.value else 0.7,
                    max_tokens=4096,
                    system_prompt=DEFAULT_SYSTEM_PROMPTS.get(function, ""),
                )
            )

    if db.scalar(select(ImageModel).limit(1)) is None:
        openrouter_key = encrypt_secret(settings.openrouter_api_key)
        for display_name, model_name, is_default in DEFAULT_IMAGE_MODELS:
            db.add(
                ImageModel(
                    display_name=display_name,
                    provider="openrouter",
                    model_name=model_name,
                    api_key_encrypted=openrouter_key,
                    is_default=is_default,
                )
            )

    existing_keys = {s.key for s in db.scalars(select(Setting)).all()}
    for key, value, description in DEFAULT_SETTINGS:
        if key not in existing_keys:
            db.add(Setting(key=key, value=value, description=description))

    # URL and publishing-mode settings — derived from .env defaults on first boot.
    _extra_settings = [
        (
            "social_publishing_mode",
            "zernio",
            "Social publishing connector: 'zernio' (Zernio middleman) or 'direct' (platform APIs directly)",
        ),
        (
            "app_public_url",
            settings.public_base_url,
            "Backend's publicly reachable URL — used for OAuth callbacks and signed media URLs",
        ),
        (
            "app_frontend_url",
            settings.public_base_url.replace(":8000", ":5173"),
            "Frontend URL — used to redirect the browser after OAuth authorization flows",
        ),
    ]
    for key, value, description in _extra_settings:
        if key not in existing_keys:
            db.add(Setting(key=key, value=value, description=description))

    _seed_provider_credentials(db, settings)

    # Zernio social-publishing key (encrypted, platform-admin managed).
    if settings.zernio_api_key:
        existing = db.scalar(
            select(ProviderCredential).where(ProviderCredential.provider == "zernio")
        )
        if existing is None:
            db.add(
                ProviderCredential(
                    provider="zernio",
                    label="Zernio",
                    api_key_encrypted=encrypt_secret(settings.zernio_api_key),
                )
            )
        elif not decrypt_secret(existing.api_key_encrypted):
            existing.api_key_encrypted = encrypt_secret(settings.zernio_api_key)

    db.commit()

    _seed_multitenancy(db, settings)


# Legacy global role -> tenant-scoped org role, for backfilling existing users.
_LEGACY_TO_ORG_ROLE = {
    UserRole.admin: OrgRole.org_admin,
    UserRole.editor: OrgRole.analyst,
    UserRole.viewer: OrgRole.viewer,
}


def _ensure_default_org_admin(db: Session, org, settings) -> None:
    """Guarantee the Default org has an org admin to manage brand/client work,
    kept separate from the platform super-admin. Derived from the env admin's
    email (orgadmin@<domain>) with the same ADMIN_PASSWORD; change it after boot."""
    if db.scalar(
        select(User).where(User.org_id == org.id, User.org_role == OrgRole.org_admin)
    ):
        return  # an org admin already exists (e.g. a backfilled legacy admin)
    _, _, domain = settings.admin_email.lower().partition("@")
    email = f"orgadmin@{domain or 'example.com'}"
    if db.scalar(select(User).where(User.email == email)):
        return
    db.add(
        User(
            email=email,
            full_name="Default Org Admin",
            hashed_password=hash_password(settings.admin_password),
            role=UserRole.admin,  # legacy field; org_role is authoritative
            org_id=org.id,
            org_role=OrgRole.org_admin,
        )
    )
    logger.info("Seeded Default org admin %s (password = ADMIN_PASSWORD — change it)", email)


def _seed_multitenancy(db: Session, settings) -> None:
    """Idempotently establish the multi-tenancy baseline (SOCIAL_PUBLISHING_PLAN.md):
    a Default organization, the platform system admin, and existing
    clients/users assigned to the Default org. Guarded so that, if the manual
    migration (backend/migrations/001_multitenancy.sql) has not yet been applied,
    we log a clear instruction instead of crashing API startup."""
    try:
        org = db.scalar(select(Organization).where(Organization.slug == "default"))
        if org is None:
            org = Organization(name="Default Organization", slug="default")
            db.add(org)
            db.flush()

        # The env admin is the PURE platform super-admin: system config only, no
        # org/brand membership. (Org work is done by org admins — see below.)
        admin = db.scalar(select(User).where(User.email == settings.admin_email.lower()))
        if admin is not None:
            admin.is_platform_admin = True
            admin.org_id = None
            admin.org_role = None

        # Backfill existing single-tenant data into the Default org.
        for client in db.scalars(select(Client).where(Client.org_id.is_(None))).all():
            client.org_id = org.id
        for user in db.scalars(
            select(User).where(User.org_id.is_(None), User.is_platform_admin.is_(False))
        ).all():
            user.org_id = org.id
            if user.org_role is None:
                user.org_role = _LEGACY_TO_ORG_ROLE.get(user.role, OrgRole.viewer)
        db.flush()

        _ensure_default_org_admin(db, org, settings)
        db.commit()
    except Exception:  # noqa: BLE001 — never block boot on the optional backfill
        db.rollback()
        logger.warning(
            "Multi-tenancy backfill skipped — apply backend/migrations/001_multitenancy.sql "
            "then restart the API. (org_id/org_role columns likely missing.)",
            exc_info=True,
        )


def _seed_provider_credentials(db: Session, settings) -> None:
    """Populate the central one-key-per-provider table from env keys and from any

    keys already stored on existing configs/models, so the move to central
    credentials is invisible: on next boot the admin already has their connections.
    """
    from app.services.providers import CANONICAL_PROVIDERS, credential_provider

    existing = {c.provider: c for c in db.scalars(select(ProviderCredential)).all()}
    labels = {p.key: p.label for p in CANONICAL_PROVIDERS}

    # Best key found per canonical provider: env first, then any entity that holds one.
    found: dict[str, str] = {}

    def offer(entity_provider: str, encrypted: str) -> None:
        cp = credential_provider(entity_provider)
        if cp in found:
            return
        key = decrypt_secret(encrypted or "")
        if key:
            found[cp] = key

    if settings.anthropic_api_key:
        found.setdefault("anthropic", settings.anthropic_api_key)
    if settings.openrouter_api_key:
        found.setdefault("openrouter", settings.openrouter_api_key)
    for cfg in db.scalars(select(LLMConfig)).all():
        offer(cfg.provider, cfg.api_key_encrypted)
    for m in db.scalars(select(ImageModel)).all():
        offer(m.provider, m.api_key_encrypted)
    for m in db.scalars(select(VideoModel)).all():
        offer(m.provider, m.api_key_encrypted)

    for cp, key in found.items():
        cred = existing.get(cp)
        if cred is None:
            db.add(ProviderCredential(provider=cp, label=labels.get(cp, cp), api_key_encrypted=encrypt_secret(key)))
        elif not decrypt_secret(cred.api_key_encrypted):
            cred.api_key_encrypted = encrypt_secret(key)
