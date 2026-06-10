"""Campaign generation agents (PRD §5.4).

Agent 1 (Editorial) produces copy, hashtags, CTA, posting time, and rationale for
every post on a platform. Agent 2 (Visual Creative) produces the image prompt and
negative prompt for every image slot. Both agents are grounded in the client
profile, competitive context, and the client's Brand Memory (§5.3.3).
"""
import logging

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.campaign import Campaign, CampaignPlatform, VisualFormat
from app.models.client import Client
from app.models.competitor import Competitor
from app.models.llm import LLMFunction
from app.services.extraction import (
    ExtractionError,
    complete_text,
    get_llm_config,
    parse_json_value,
)
from app.services.platforms import spec

logger = logging.getLogger(__name__)


def creativity_to_temperature(level: int) -> float:
    """Map the 1–10 creativity slider (§5.3.1) to an LLM temperature in [0.2, 1.0]."""
    level = max(1, min(10, level))
    return round(0.2 + (level - 1) / 9 * 0.8, 2)


def _brand_memory_text(client: Client) -> str:
    parts: list[str] = []
    if client.brand_tone:
        parts.append(f"Brand tone & voice: {client.brand_tone}")
    if client.brand_visual_style:
        parts.append(f"Preferred visual style: {client.brand_visual_style}")
    if client.brand_words_required:
        parts.append("Words/phrases that MUST be used: " + ", ".join(client.brand_words_required))
    if client.brand_words_forbidden:
        parts.append("Words/phrases that must NEVER be used: " + ", ".join(client.brand_words_forbidden))
    if client.brand_colors:
        parts.append("Corporate colors (hex): " + ", ".join(client.brand_colors))
    if client.brand_copy_examples:
        examples = "\n".join(f"  - {e}" for e in client.brand_copy_examples)
        parts.append(f"Approved copy examples (match this style):\n{examples}")
    if client.brand_legal_disclaimer:
        parts.append(f"Always include this legal/disclaimer text: {client.brand_legal_disclaimer}")
    return "\n".join(parts) if parts else "(No Brand Memory configured.)"


def _client_context(client: Client) -> str:
    lines = [f"Company: {client.company_name} ({client.website_url})"]
    for label, value in (
        ("Industry", client.industry),
        ("Description", client.description),
        ("Products/Services", client.products_services),
        ("Target audience", client.target_audience),
        ("Value proposition", client.value_proposition),
        ("Communication tone", client.communication_tone),
    ):
        if value:
            lines.append(f"{label}: {value}")
    return "\n".join(lines)


def _competitive_context(db: Session, client: Client) -> str:
    competitors = db.scalars(
        select(Competitor).where(Competitor.client_id == client.id).limit(5)
    ).all()
    done = [c for c in competitors if c.positioning]
    if not done:
        return ""
    lines = ["Competitive context (differentiate from these competitors):"]
    for c in done:
        lines.append(f"- {c.company_name}: {c.positioning[:300]}")
    return "\n".join(lines)


def build_context(db: Session, client: Client, campaign: Campaign, article_text: str = "") -> str:
    blocks = [
        "=== CLIENT PROFILE ===",
        _client_context(client),
        "",
        "=== BRAND MEMORY ===",
        _brand_memory_text(client),
    ]
    competitive = _competitive_context(db, client)
    if competitive:
        blocks += ["", "=== COMPETITIVE CONTEXT ===", competitive]
    if campaign.central_theme:
        blocks += ["", f"Campaign central theme/concept: {campaign.central_theme}"]
    if article_text:
        blocks += ["", "=== REFERENCE ARTICLE ===", article_text[:6000]]
    return "\n".join(blocks)


EDITORIAL_INSTRUCTIONS = """\
You are the Editorial Agent for a social media marketing platform. Generate {num_posts}
distinct {platform} post(s) for a campaign with objective "{objective}".

Platform rules:
- Copy MUST NOT exceed {char_limit} characters.
- Emoji usage: {emojis}.
- Include {hashtag_count} hashtags following this mix: {hashtag_mix} (branded/trending/niche percentages).
- Call to action: {cta_rule}
- Platform tone: {tone}
- Content language: {language}

Each post must be unique in angle and message. Answer ONLY with a JSON array of {num_posts}
object(s), each with exactly these keys:
[
  {{
    "headline": string (short opening hook),
    "copy": string (the main post copy, within the character limit),
    "cta": string (call to action, empty string if CTAs are disabled),
    "hashtags": [string, ...] (each starting with #),
    "best_time": string (suggested posting day/time, indicative),
    "rationale": string (1-2 sentences: why this message serves the objective)
  }},
  ...
]
Write all content in {language}. Ground everything in the context below.
"""

VISUAL_INSTRUCTIONS = """\
You are the Visual Creative Agent for a social media marketing platform. For each post
below, write detailed AI image-generation prompt(s) for {platform} (aspect ratio
{aspect_ratio}). Generate {images_per_post} image prompt(s) per post.

Each prompt must specify subject, composition, style, lighting, and a color palette that
aligns with the brand's visual style and corporate colors. Provide a negative prompt
listing elements to avoid. Do not include any text/words to render inside the image
unless essential.

Answer ONLY with a JSON array — one object per post, in the same order as given:
[
  {{
    "images": [
      {{"prompt": string, "negative_prompt": string}},
      ...
    ]
  }},
  ...
]
There must be exactly {images_per_post} image object(s) per post.
"""


def _emoji_rule(value: str) -> str:
    return {"none": "no emojis", "moderate": "a moderate number of emojis", "abundant": "abundant emojis"}.get(
        value, "a moderate number of emojis"
    )


def generate_posts_copy(
    db: Session, client: Client, campaign: Campaign, cp: CampaignPlatform, context: str
) -> list[dict]:
    """Editorial Agent: return one dict per post for the given platform."""
    cfg = get_llm_config(db, LLMFunction.editorial_agent)
    pspec = spec(cp.platform)
    cta_rule = (
        f"include a call to action ({cp.cta_text})" if cp.include_cta and cp.cta_text
        else "include a call to action" if cp.include_cta
        else "do not include a call to action"
    )
    instructions = EDITORIAL_INSTRUCTIONS.format(
        num_posts=cp.num_posts,
        platform=pspec.label,
        objective=campaign.objective.value,
        char_limit=pspec.char_limit,
        emojis=_emoji_rule(cp.emojis),
        hashtag_count=cp.hashtag_count,
        hashtag_mix=cp.hashtag_mix,
        cta_rule=cta_rule,
        tone=cp.tone or client.communication_tone or "match the brand voice",
        language=campaign.content_language,
    )
    temperature = creativity_to_temperature(campaign.creativity_level)
    raw = complete_text(cfg, cfg.system_prompt, f"{instructions}\n\nCONTEXT:\n{context}", temperature)
    results = parse_json_value(raw, opener="[", closer="]")
    if not isinstance(results, list) or not results:
        raise ExtractionError(f"The Editorial Agent did not return posts for {pspec.label}")
    posts: list[dict] = []
    for item in results[: cp.num_posts]:
        copy = str(item.get("copy", "")).strip()[: pspec.char_limit]
        posts.append({
            "headline": str(item.get("headline", "")).strip(),
            "copy": copy,
            "cta": str(item.get("cta", "")).strip(),
            "hashtags": [str(h).strip() for h in item.get("hashtags", []) if str(h).strip()],
            "best_time": str(item.get("best_time", "")).strip(),
            "rationale": str(item.get("rationale", "")).strip(),
        })
    return posts


def generate_image_prompts(
    db: Session,
    campaign: Campaign,
    cp: CampaignPlatform,
    posts_data: list[dict],
    context: str,
) -> list[list[dict]]:
    """Visual Agent: return, per post, a list of {prompt, negative_prompt} image slots."""
    cfg = get_llm_config(db, LLMFunction.visual_agent)
    pspec = spec(cp.platform)
    aspect = pspec.default_ratio
    images_per_post = cp.carousel_slides if cp.visual_format == VisualFormat.carousel else cp.images_per_post
    images_per_post = max(1, images_per_post)
    instructions = VISUAL_INSTRUCTIONS.format(
        platform=pspec.label,
        aspect_ratio=aspect,
        images_per_post=images_per_post,
    )
    posts_summary = "\n".join(
        f"POST {i + 1}: {p['headline']} | {p['copy'][:200]}" for i, p in enumerate(posts_data)
    )
    temperature = creativity_to_temperature(campaign.creativity_level)
    raw = complete_text(
        cfg, cfg.system_prompt, f"{instructions}\n\nCONTEXT:\n{context}\n\nPOSTS:\n{posts_summary}", temperature
    )
    results = parse_json_value(raw, opener="[", closer="]")
    if not isinstance(results, list):
        raise ExtractionError(f"The Visual Agent did not return image prompts for {pspec.label}")

    per_post: list[list[dict]] = []
    for idx in range(len(posts_data)):
        slots: list[dict] = []
        item = results[idx] if idx < len(results) else {}
        images = item.get("images", []) if isinstance(item, dict) else []
        for slot in range(images_per_post):
            img = images[slot] if slot < len(images) else {}
            slots.append({
                "aspect_ratio": aspect,
                "prompt": str(img.get("prompt", "")).strip(),
                "negative_prompt": str(img.get("negative_prompt", "")).strip(),
            })
        per_post.append(slots)
    return per_post
