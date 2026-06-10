"""Idempotent first-run seeding: admin user, LLM configs, image models, settings."""
import logging

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.crypto import encrypt_secret
from app.core.security import hash_password
from app.models.llm import ImageModel, LLMConfig, LLMFunction
from app.models.setting import Setting
from app.models.user import User, UserRole

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
        "and color palette aligned with the brand, plus a negative prompt. You always "
        "return valid JSON exactly as instructed."
    ),
}

DEFAULT_SETTINGS = [
    ("default_ui_language", "en", "Default UI language"),
    ("default_content_language", "en", "Default content generation language"),
    ("default_competitor_count", "5", "Default number of competitors to research"),
    ("crawler_max_depth", "5", "Max link levels to follow from the homepage"),
    ("crawler_max_pages", "200", "Max pages to crawl per site"),
    ("crawler_timeout_seconds", "10", "Max wait time per page response (seconds)"),
    ("crawler_excluded_paths", "", "Comma-separated regex patterns of URL paths to skip"),
    ("crawler_user_agent", "AIMarketingPlatformBot/1.0", "User-Agent header sent by the crawler"),
    ("competitor_crawl_max_depth", "3", "Max link depth when crawling competitor sites"),
    ("competitor_crawl_max_pages", "30", "Max pages when crawling competitor sites (keeps analysis fast)"),
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
            )
        )
        logger.info("Seeded initial admin user %s", settings.admin_email)

    anthropic_key = encrypt_secret(settings.anthropic_api_key)
    existing_functions = {c.function for c in db.scalars(select(LLMConfig)).all()}
    for function in LLMFunction:
        if function not in existing_functions:
            db.add(
                LLMConfig(
                    function=function,
                    provider="anthropic",
                    model_name="claude-sonnet-4-6",
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

    db.commit()
