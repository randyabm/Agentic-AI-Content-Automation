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
        "You are the Visual Creative Director for a social-media marketing platform. "
        "For each campaign element you return a structured style direction + a "
        "single image prompt that is the FINAL rendered asset — headline, subtitle, "
        "CTA and brand logo are rendered INSIDE the image itself, not added afterwards "
        "by a separate layout step. Feature chips are OPTIONAL and belong only to "
        "styles whose visual_cues call for a chip/pill row — do not default to a "
        "rounded-pill footer on every style, and place the logo using language that "
        "matches the chosen style_family (a discreet corner mark for a dark luxury "
        "style is not the same as a footer bar for a bold typographic one). Pick a "
        "style_family from the closed list given in the user prompt (read the "
        "style_cards section there for the full library) and AVOID the ones the user "
        "has just seen (the penalty block in CONTEXT), unless the user prompt's "
        "creativity guidance explicitly allows you to remix two families together — "
        "in that case set is_remix=true and base_families to exactly two closed-list "
        "values, never an invented name. NEVER use the banned phrases listed in the "
        "user prompt (modern clean, beautiful poster, eye-catching, high quality, "
        "professional, vibrant, stunning, etc.) — pick a different style_family if "
        "you catch yourself reaching for them. Return strict JSON in the schema "
        "specified in the user prompt, no prose, no code fences."
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
    # (display_name, provider, model_name, is_default)
    ("Gemini 2.5 Flash Image (Nano Banana)", "openrouter", "google/gemini-2.5-flash-image", True),
    ("Gemini 3 Pro Image (Preview)", "openrouter", "google/gemini-3-pro-image-preview", False),
    ("GPT-5.5 (OpenAI Responses)", "openai_responses", "gpt-5.5", False),
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
    # The visual_agent now produces very long outputs (each element's
    # image_prompt includes the marketing copy + font/colour/composition
    # details + visual_keywords array + text_overlay_plan). 4096 tokens
    # is regularly exceeded when a campaign has 4+ elements; the response
    # gets truncated mid-JSON and the whole generation fails. Sonnet
    # supports up to 8192 output tokens so we cap there.
    _HIGH_TOKEN_FUNCTIONS = {LLMFunction.visual_agent, LLMFunction.editorial_agent}
    for function in LLMFunction:
        if function not in existing_configs:
            db.add(
                LLMConfig(
                    function=function,
                    provider="anthropic",
                    model_name="claude-haiku-4-5-20251001" if function in _HAIKU_FUNCTIONS else "claude-sonnet-4-6",
                    api_key_encrypted=anthropic_key,
                    temperature=0.3 if "extraction" in function.value or "analysis" in function.value else 0.7,
                    max_tokens=8192 if function in _HIGH_TOKEN_FUNCTIONS else 4096,
                    system_prompt=DEFAULT_SYSTEM_PROMPTS.get(function, ""),
                )
            )

    if db.scalar(select(ImageModel).limit(1)) is None:
        openrouter_key = encrypt_secret(settings.openrouter_api_key)
        for display_name, provider, model_name, is_default in DEFAULT_IMAGE_MODELS:
            # OpenAI-backed rows resolve the central "openai" credential at runtime,
            # so they don't need a per-row key here.
            db.add(
                ImageModel(
                    display_name=display_name,
                    provider=provider,
                    model_name=model_name,
                    api_key_encrypted=openrouter_key if provider == "openrouter" else encrypt_secret(""),
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

    _seed_default_style_cards(db)

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


# Visual style cards — the curated library the Visual Agent picks from. Seeded
# once on first boot; admins can add brand-scoped overrides later. The 6
# families below are the ones documented in the visual-style research
# blueprint (June 2026): each one is a self-contained visual direction so
# generation doesn't have to invent a direction from scratch every call.
DEFAULT_STYLE_CARDS: list[dict] = [
    {
        "id": "bold_typographic",
        "family": "bold_typographic",
        "name": "Bold typographic poster",
        "description": "SaaS-product-marketing style: oversized typographic headline "
                       "with ONE emphasis word in a contrasting brand colour, split or "
                       "centred layout, soft gradient background, 1-2 glowing orb "
                       "accents, laptop and/or phone mockup showing the actual product "
                       "UI, brand logo top-left, footer with feature chips. The image "
                       "IS the final asset — copy is rendered inside it.",
        "best_for": ["SaaS product launches", "Punchy offers", "Hero ads",
                     "Awareness campaigns", "Event announcements"],
        "not_for": ["Long body copy", "Lifestyle storytelling", "Quiet brand voice"],
        "visual_cues": [
            "split layout (text on the left third, product mockup on the right two-thirds)",
            "oversized geometric sans-serif headline, weight 800, with ONE emphasis word in a contrasting brand colour at weight 700",
            "italic quote in weight 400 below the headline",
            "regular body copy in weight 400, brand colour",
            "soft diagonal gradient background (white/cream top-left to brand-accent bottom-right)",
            "1-2 glowing orb accents in brand colours (cyan + magenta typical), soft blur, placed as decoration NOT centre",
            "laptop and/or phone mockup showing the actual product UI (sidebar, dashboard, metrics, modals)",
            "brand logo top-left, optional badge top-right, footer row of 4 feature chips (icon + label)",
            "clear typographic hierarchy: headline > quote > body > chips",
        ],
        "negative_constraints": [
            "no centered template look (off-centre is the goal)",
            "no generic gradient blob (the gradient must support a focal point, not just wash the canvas)",
            "no repeated icon grid (the footer chips are 4 distinct, not a uniform 8-up)",
            "no stock-photo composition (must look AI-crafted, not a Shutterstock image)",
            "no AI-looking perfection (imperfect is fine, sterile is not)",
            "no flat illustration (this is a real-render style with depth and shadow)",
        ],
    },
    {
        "id": "lifestyle_ugc",
        "family": "lifestyle_ugc",
        "name": "Lifestyle UGC / photo-real",
        "description": "Real-world setting, candid human moment, phone-camera feel. "
                       "Builds trust for local services, community brands, and product "
                       "testimonials.",
        "best_for": ["Trust-building", "Local services", "Community brands", "UGC reposts"],
        "not_for": ["Premium / technical polish", "Strict corporate brands",
                     "Impersonal product launches"],
        "visual_cues": [
            "natural lighting, golden hour or soft window light",
            "slight grain or phone-camera texture (NOT clean studio)",
            "real environment, not a studio backdrop",
            "subject candid, mid-action, not posed for the camera",
            "muted, lived-in colour palette",
            "single subject in the frame, not a collage",
            "subtle hand-written or chalkboard text if copy is included",
        ],
        "negative_constraints": [
            "no studio polish",
            "no overly posed models",
            "no AI-looking perfection (slight asymmetry, natural skin, real lighting)",
            "no flat illustration",
        ],
    },
    {
        "id": "editorial_collage",
        "family": "editorial_collage",
        "name": "Editorial collage",
        "description": "Cut-outs, layered paper, torn edges, mixed type scale, "
                       "asymmetric grid. Fashion-magazine energy for campaigns, "
                       "events, and creative services.",
        "best_for": ["Campaigns", "Fashion", "Events", "Creative services",
                     "Limited-time drops"],
        "not_for": ["Strict corporate brands", "Regulated industries",
                     "Long-form product detail"],
        "visual_cues": [
            "cut-paper or torn-edge textures",
            "layered product cut-outs with soft drop shadows",
            "asymmetric grid with intentional empty space",
            "mixed type scale (one headline large, others small body)",
            "warm neutrals with one strong accent colour",
            "sticker-like decorative elements",
            "polaroid or magazine-clipping framing",
        ],
        "negative_constraints": [
            "no centered template look",
            "no repeated icon grid",
            "no flat illustration (cut-outs must have texture and shadow)",
            "no AI-looking perfection (collage is meant to be handmade-feeling)",
        ],
    },
    {
        "id": "3d_product_hero",
        "family": "3d_product_hero",
        "name": "3D product hero",
        "description": "Single hero object rendered with studio lighting, depth, "
                       "and reflective surfaces. For products, SaaS feature launches, "
                       "and tech where the product is the hero.",
        "best_for": ["Products", "SaaS feature launches", "Tech announcements",
                     "Hero placements"],
        "not_for": ["Emotional storytelling", "Local services",
                     "Multi-subject compositions"],
        "visual_cues": [
            "single hero object, off-centre or floating",
            "studio lighting with rim light and soft key",
            "soft shadow + reflective surface beneath the hero",
            "depth of field with bokeh background",
            "high-fidelity material rendering (metal, glass, plastic, fabric)",
            "dark or gradient studio backdrop",
            "optional floating UI elements / particles around the hero",
        ],
        "negative_constraints": [
            "no flat illustration (this is the polar opposite — depth required)",
            "no more than one hero subject",
            "no cluttered background (bokeh only, no competing elements)",
        ],
    },
    {
        "id": "imperfect_hand_drawn",
        "family": "imperfect_hand_drawn",
        "name": "Imperfect hand-drawn",
        "description": "Scribbles, marker textures, uneven shapes, playful grid. "
                       "Friendly, human, and approachable for education and small "
                       "business brands.",
        "best_for": ["Friendly brands", "Education", "Small business",
                     "Internal comms", "Explainer content"],
        "not_for": ["Luxury or high-trust", "Finance / legal", "Regulated content"],
        "visual_cues": [
            "scribbles and marker textures",
            "uneven, hand-drawn shapes",
            "playful grid with intentional roughness",
            "warm, paper-like background",
            "muted earth-tone palette",
            "doodle-like icons and arrows",
            "hand-lettered headlines (real hand-lettering feel, not fonts)",
        ],
        "negative_constraints": [
            "no luxury aesthetic",
            "no clean lines (the imperfection IS the style)",
            "no corporate stock-photo polish",
            "no AI-looking perfection (asymmetry is the point)",
        ],
    },
    {
        "id": "surreal_seasonal_scene",
        "family": "surreal_seasonal_scene",
        "name": "Surreal seasonal scene",
        "description": "Unexpected scale, dreamlike backgrounds, cinematic colour. "
                       "For awareness campaigns, festivals, and playful seasonal "
                       "offers.",
        "best_for": ["Awareness", "Festivals", "Playful offers",
                     "Seasonal launches", "Mood pieces"],
        "not_for": ["Regulated industries", "Serious topics", "B2B / B2G"],
        "visual_cues": [
            "unexpected scale (oversized props, miniature subjects)",
            "dreamlike gradient sky or backdrop (saturated, painterly)",
            "cinematic colour grade (teal-and-orange, pastel bloom, etc.)",
            "soft, golden-hour lighting with strong rim",
            "subject in mid-air or mid-moment (floating, leaping, twirling)",
            "seasonal motifs as background props (snow, blossoms, lanterns, fireworks)",
        ],
        "negative_constraints": [
            "no regulated or serious tone",
            "no flat illustration (this style demands depth and atmosphere)",
            "no stock-photo composition (must feel hand-crafted, dreamlike)",
        ],
    },
    # ── 2025-2026 trend styles (10 new families) ──────────────────────────
    {
        "id": "glassmorphism_layered",
        "family": "glassmorphism_layered",
        "name": "Glassmorphism / frosted layers",
        "description": "Frosted-glass translucent panels stacked over a vivid blurred "
                       "background, soft inner glow, thin light-catching borders. For "
                       "SaaS dashboards, fintech, and premium digital-product launches "
                       "that want a futuristic-but-light feel.",
        "best_for": ["SaaS dashboards", "Fintech", "Premium digital products",
                     "App feature highlights", "Subscription launches"],
        "not_for": ["Heritage/legacy brands", "Print-feel campaigns",
                    "Hand-crafted or artisanal positioning"],
        "visual_cues": [
            "2-3 translucent frosted-glass panels at different depths, soft blur behind each",
            "vivid blurred gradient background (saturated colour bleed) visible through the glass",
            "thin 1px light-catching border on each glass panel edge",
            "soft inner glow / highlight along the top edge of each panel (simulated light source)",
            "UI elements or product mockup rendered as if floating inside one glass panel",
            "subtle drop shadow beneath each panel for depth separation",
            "cool-to-vivid colour pairing (e.g. icy blue + violet, mint + magenta)",
            "headline rendered on the frontmost, most-opaque panel for legibility",
        ],
        "negative_constraints": [
            "no opaque flat cards (translucency is the entire point)",
            "no muddy/low-contrast glass (panels must stay legible against the background)",
            "no more than 3 stacked panels (clutter kills the effect)",
            "no flat illustration (this is a rendered-depth style)",
            "no AI-looking perfection on the blur (slight imperfection in the blur edge is fine)",
        ],
    },
    {
        "id": "neo_brutalist_web",
        "family": "neo_brutalist_web",
        "name": "Neo-brutalist / raw web-core",
        "description": "Raw, unpolished, high-contrast layout inspired by early-web and "
                       "brutalist graphic design: thick black borders, harsh drop shadows, "
                       "clashing flat colours, deliberately 'undesigned' grid. For brands "
                       "that want to look confident, anti-corporate, and culturally current.",
        "best_for": ["Streetwear / youth brands", "Music / events", "Indie tech products",
                     "Anti-corporate positioning", "Gen-Z audiences"],
        "not_for": ["Healthcare / finance / legal", "Luxury brands", "Trust-first B2B"],
        "visual_cues": [
            "thick (8-12px) solid black border around the main content block",
            "harsh, offset drop shadow (hard edge, not soft blur) behind cards/buttons",
            "flat, clashing colour blocks (e.g. acid yellow + electric blue + black, no gradients)",
            "deliberately raw/grid-breaking layout — elements slightly mis-aligned on purpose",
            "monospace or oversized condensed sans headline, no decorative font flourishes",
            "visible 'underline' or 'box' around key words instead of colour emphasis",
            "flat 2D shapes (no shadows on shapes themselves, only on cards)",
            "high contrast only — no soft mid-tones",
        ],
        "negative_constraints": [
            "no gradients anywhere (flat colour only)",
            "no soft drop shadows (shadows must be hard-edged and offset)",
            "no rounded corners on the main border (sharp corners only)",
            "no muted or pastel palette (high-saturation clashing colours required)",
            "no polished/premium feel (rawness is the brand asset)",
        ],
    },
    {
        "id": "y2k_retro_futurism",
        "family": "y2k_retro_futurism",
        "name": "Y2K / retro-futurism",
        "description": "Late-90s/early-2000s digital optimism: chrome/metallic gradients, "
                       "bubble shapes, pixel/glow accents, holographic sheen. For youth "
                       "brands, nostalgia plays, and playful product drops.",
        "best_for": ["Gen-Z / youth brands", "Music / entertainment", "Nostalgia campaigns",
                     "Playful product drops", "Beauty / fashion"],
        "not_for": ["B2B / enterprise", "Finance / legal", "Serious / regulated topics"],
        "visual_cues": [
            "chrome/metallic gradient text or shapes (silver-to-blue-to-pink sheen)",
            "holographic/iridescent foil texture on at least one element",
            "bubble or blob-shaped UI frames (rounded, candy-like)",
            "low-poly or pixel-art accents as decorative detail (not the whole image)",
            "starburst, swirl, or lens-flare accents",
            "saturated candy colour palette (cyber-lilac, bubblegum pink, acid lime)",
            "thin chrome outline on the headline typography",
            "subtle scanline or CRT-glow texture on a background element",
        ],
        "negative_constraints": [
            "no muted/earthy palette (saturation is mandatory)",
            "no minimalist negative space (the frame should feel maximal/busy in a fun way)",
            "no modern flat-UI mockups (this style predates flat design — keep skeuomorphic chrome)",
            "no corporate tone in colour choice",
        ],
    },
    {
        "id": "dark_mode_luxury",
        "family": "dark_mode_luxury",
        "name": "Dark-mode luxury",
        "description": "Near-black or deep charcoal background, single metallic accent "
                       "(gold, copper, or champagne), generous negative space, refined "
                       "thin-weight serif or geometric type. For premium/high-ticket "
                       "products, finance, and exclusive offers.",
        "best_for": ["Luxury goods", "Finance / wealth management", "Premium memberships",
                     "High-ticket B2B", "Exclusive / VIP offers"],
        "not_for": ["Budget / value positioning", "Playful or youth brands",
                    "High-information-density layouts"],
        "visual_cues": [
            "near-black (#0a0a0a–#161616) or deep charcoal background, not pure black",
            "single metallic accent colour (gold, copper, or champagne) used sparingly",
            "generous negative space — subject occupies well under half the canvas",
            "thin-weight serif or geometric sans headline (weight 300-400, NOT bold)",
            "subtle gold or hairline rule dividing sections",
            "soft, directional studio light on the hero subject only (rest stays dark)",
            "matte material rendering, minimal reflections except on the metallic accent",
            "centred or rule-of-thirds composition, never cluttered",
        ],
        "negative_constraints": [
            "no more than one accent colour besides black/white",
            "no bold/heavy typography (heaviness reads as cheap, not premium)",
            "no busy backgrounds or competing visual elements",
            "no bright saturated colours anywhere",
            "no flat illustration (must read as photographic/rendered depth)",
        ],
    },
    {
        "id": "claymorphism_soft_3d",
        "family": "claymorphism_soft_3d",
        "name": "Claymorphism / soft-3D",
        "description": "Puffy, matte, clay-like 3D shapes with soft rounded edges and "
                       "gentle inset/outset shadows — looks tactile, friendly, and "
                       "premium-casual. For consumer apps, wellness, and friendly fintech.",
        "best_for": ["Consumer apps", "Wellness / health", "Friendly fintech",
                     "Onboarding / explainer visuals", "Family-friendly brands"],
        "not_for": ["Heritage / luxury brands", "Serious B2B",
                    "Editorial / text-heavy content"],
        "visual_cues": [
            "matte clay-like material on every 3D shape (no glossy/reflective surfaces)",
            "soft, heavily rounded edges on every shape (no sharp corners)",
            "dual shadow technique: soft inset shadow + soft outset shadow per shape (puffy look)",
            "pastel or muted-saturated colour palette (soft blue, soft coral, soft mint)",
            "simple geometric clay shapes (rounded blobs, pill shapes, soft cubes) as props",
            "even, soft diffused lighting — no hard highlights",
            "playful, slightly oversized proportions on hero objects",
            "flat-matte background in a single soft colour or very subtle gradient",
        ],
        "negative_constraints": [
            "no glossy or reflective materials (matte only — polar opposite of 3d_product_hero)",
            "no sharp edges or corners anywhere",
            "no hard shadows (every shadow must be soft and diffused)",
            "no photographic textures (this is a rendered/illustrated style)",
            "no dark or moody palette (claymorphism reads as light and friendly)",
        ],
    },
    {
        "id": "maximalist_eclectic_collage",
        "family": "maximalist_eclectic_collage",
        "name": "Maximalist eclectic collage",
        "description": "Deliberately 'too much': clashing patterns, mixed media, dense "
                       "layering, multiple focal points, saturated colour-blocking. For "
                       "fashion, festivals, and brands that want energetic abundance "
                       "rather than restraint.",
        "best_for": ["Fashion / streetwear", "Festivals / events", "Gen-Z social campaigns",
                     "Limited drops", "Music / entertainment"],
        "not_for": ["Minimalist / quiet brand voice", "B2B / enterprise",
                    "Regulated industries"],
        "visual_cues": [
            "3+ distinct focal elements competing for attention (intentional, not accidental)",
            "clashing pattern-on-pattern (e.g. polka dot near stripe near floral)",
            "dense layering with little to no negative space",
            "saturated colour-blocking — 4+ strong colours in one frame",
            "mixed media feel (photo + illustration + sticker + type all in one frame)",
            "rotated/overlapping elements at varied angles (nothing axis-aligned)",
            "oversized decorative type mixed with small fine-print-style accents",
            "collectible-sticker or zine aesthetic for small decorative elements",
        ],
        "negative_constraints": [
            "no large empty negative-space areas (density is the point)",
            "no single dominant focal point (must feel multi-focus)",
            "no restrained 2-colour palette (4+ colours required)",
            "no centered template look",
            "no AI-looking perfection (intentional visual chaos, not a tidy grid)",
        ],
    },
    {
        "id": "swiss_international_minimal",
        "family": "swiss_international_minimal",
        "name": "Swiss / international typographic minimalism",
        "description": "Grid-driven, restrained, high-contrast typographic design rooted "
                       "in the Swiss/International Style: strict baseline grid, "
                       "sans-serif (Helvetica-like) type, asymmetric but mathematically "
                       "precise layout, one or two flat colours. For confident, "
                       "design-forward B2B and editorial brands.",
        "best_for": ["Design-forward B2B", "Architecture / professional services",
                     "Editorial / publishing", "Conference / event branding"],
        "not_for": ["Playful / youth brands", "Maximalist or busy compositions",
                    "Photo-heavy lifestyle content"],
        "visual_cues": [
            "strict modular grid — every element aligns to a visible column/baseline system",
            "geometric grotesque sans-serif (Helvetica/Akzidenz-like), weight 400-700 only",
            "asymmetric but mathematically precise composition (off-centre, intentional ratios)",
            "flat colour blocks only — one or two colours plus black/white, no gradients",
            "large confident numerals or a single oversized letterform as a graphic element",
            "generous structured whitespace (not empty — organized)",
            "thin rule lines used as grid dividers, not decoration",
            "left-aligned or strict-grid text blocks, never centred body text",
        ],
        "negative_constraints": [
            "no gradients, no glow effects, no drop shadows",
            "no script or decorative typefaces",
            "no centred symmetrical layout (the grid must read as deliberately asymmetric)",
            "no more than 2 colours plus black/white",
            "no photographic clutter (if a photo is used, it is cropped to a grid module)",
        ],
    },
    {
        "id": "gradient_mesh_abstract",
        "family": "gradient_mesh_abstract",
        "name": "Gradient-mesh abstract",
        "description": "Smooth, multi-point colour-mesh gradients forming soft abstract "
                       "backdrops (the 2025 evolution of 'aurora' gradients), paired "
                       "with crisp foreground type or a UI mockup. For SaaS, AI "
                       "products, and brands wanting a soft-futuristic energy without "
                       "literal 3D.",
        "best_for": ["SaaS / AI products", "Developer tools", "Modern B2B",
                     "App launch announcements", "Conference / webinar promos"],
        "not_for": ["Heritage / traditional brands", "Photo-real lifestyle content",
                    "Print-feel campaigns"],
        "visual_cues": [
            "multi-point mesh gradient background (4+ colour nodes blending smoothly, not 2-colour linear)",
            "soft organic colour transitions — no hard edges within the gradient itself",
            "foreground content (type / UI mockup) on a flat or near-flat card floating above the mesh",
            "fine grain/noise texture overlaid on the gradient to avoid banding (subtle, not visible grain)",
            "one or two saturated 'hero' colours in the mesh plus darker/lighter supporting tones",
            "soft glow halo behind the foreground card where it meets the gradient",
            "asymmetric placement of the gradient's brightest point (not centred)",
            "crisp, high-contrast foreground typography against the soft background",
        ],
        "negative_constraints": [
            "no simple 2-stop linear gradient (must be a multi-point mesh, not a basic blend)",
            "no banding artifacts (the grain/noise texture is required to avoid this)",
            "no literal 3D rendering in the background (the mesh is flat/painterly, not a 3D render)",
            "no muted palette (the mesh must read as vivid and current)",
            "no busy foreground competing with the gradient for attention",
        ],
    },
    {
        "id": "organic_blob_botanical",
        "family": "organic_blob_botanical",
        "name": "Organic blob / botanical modern",
        "description": "Soft organic blob shapes, hand-cut botanical/plant motifs, and "
                       "earthy-but-bright colour palettes — the wellness/clean-beauty "
                       "aesthetic refreshed for 2025-2026 with more colour confidence. "
                       "For wellness, clean beauty, and sustainability-forward brands.",
        "best_for": ["Wellness / clean beauty", "Sustainable / eco brands", "Food & beverage",
                     "Health products", "Spa / self-care"],
        "not_for": ["Tech / SaaS", "High-energy youth brands", "Corporate / finance"],
        "visual_cues": [
            "soft organic blob shapes (irregular, no straight edges) as background or frame elements",
            "hand-cut or vector botanical motifs (leaves, florals, stems) as supporting decoration",
            "bright-but-earthy palette (terracotta, sage, cream, sunset coral — saturated, not dusty)",
            "product or subject nested inside or overlapping a blob shape",
            "soft natural shadow beneath the hero subject (no studio hard light)",
            "rounded, friendly sans-serif or warm serif headline type",
            "asymmetric organic composition — nothing on a rigid grid",
            "subtle paper or linen texture on the background blob fill",
        ],
        "negative_constraints": [
            "no straight-edged geometric shapes (organic/rounded only)",
            "no cold/clinical colour palette (must read warm and bright)",
            "no glossy/synthetic materials (this is a soft, natural-feeling style)",
            "no dense clutter (generous breathing room around the blob composition)",
            "no AI-looking perfection (slight asymmetry in the botanical line work is wanted)",
        ],
    },
    {
        "id": "kinetic_motion_typography",
        "family": "kinetic_motion_typography",
        "name": "Kinetic motion-inspired typography",
        "description": "Static image that implies motion: type and shapes with directional "
                       "blur trails, speed-line accents, and dynamic diagonal energy — "
                       "borrows from kinetic-typography video design. For high-energy "
                       "launches, sales/urgency campaigns, and sports/fitness brands.",
        "best_for": ["Flash sales / urgency offers", "Sports / fitness",
                     "Event countdowns", "High-energy product drops", "App / game launches"],
        "not_for": ["Calm / luxury positioning", "Long-form informational content",
                    "Regulated / serious industries"],
        "visual_cues": [
            "directional motion blur trail behind the headline word or hero object",
            "diagonal compositional energy — primary axis is 15-30 degrees off horizontal",
            "speed-line or streak accents reinforcing the direction of motion",
            "one word or number rendered large with a 'just landed' offset double-exposure ghost",
            "bold condensed sans-serif headline, weight 800-900, italicised or skewed",
            "high-contrast colour pairing with one 'hot' accent (orange-red, electric yellow)",
            "fragmented or split-exposure treatment on a secondary element for energy",
            "sharp focal subject against a slightly blurred or streaked background",
        ],
        "negative_constraints": [
            "no static, axis-aligned layout (diagonal energy is mandatory)",
            "no soft/calm colour palette (high contrast and one hot accent required)",
            "no literal video-frame artifacts (this is a single rendered still, not a video screenshot)",
            "no cluttered competing motion directions (one clear direction of energy only)",
        ],
    },
]


def _seed_default_style_cards(db: Session) -> None:
    """Idempotent: insert the 6 global style cards on first boot, skip if any
    of them already exist. Brand-scoped cards (brand_id NOT NULL) are not
    touched — admins add those later through the API.
    """
    from app.models.style_card import StyleCard

    existing = {c.id for c in db.scalars(select(StyleCard)).all()}
    added = 0
    for row in DEFAULT_STYLE_CARDS:
        if row["id"] in existing:
            continue
        db.add(StyleCard(
            id=row["id"],
            name=row["name"],
            family=row["family"],
            description=row["description"],
            best_for=row["best_for"],
            not_for=row["not_for"],
            visual_cues=row["visual_cues"],
            negative_constraints=row["negative_constraints"],
            is_global=True,
            is_active=True,
        ))
        added += 1
    if added:
        db.commit()
        logger.info("Seeded %d default style card(s).", added)
