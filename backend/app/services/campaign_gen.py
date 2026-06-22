"""Campaign generation agents (PRD §5.4).

Agent 1 (Editorial) produces copy, hashtags, CTA, posting time, and rationale for
every post on a platform. Agent 2 (Visual Creative) produces the image prompt and
negative prompt for every image slot. Both agents are grounded in the client
profile, competitive context, and the client's Brand Memory (§5.3.3).
"""
import logging

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.article import Article
from app.models.campaign import Campaign, CampaignElement, CampaignPlatform, ElementType, Platform
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


def resolve_article(db: Session, campaign: Campaign) -> dict:
    """Resolve the campaign's article reference into text + metadata (PRD §6.2).

    Sources, in priority order: a library article, an external URL (fetched on
    demand), or pasted text. Returns {text, title, author, url}.
    """
    if campaign.article_id:
        article = db.get(Article, campaign.article_id)
        if article:
            return {
                "text": f"{article.title}\n\n{article.summary}\n\n{article.body[:5000]}",
                "title": article.title,
                "author": article.author,
                "url": article.source_url,
            }
    if campaign.article_url:
        from app.services.article_intel import fetch_clean_page

        try:
            page = fetch_clean_page(db, campaign.article_url)
            return {"text": page.text[:6000], "title": page.title, "author": "", "url": campaign.article_url}
        except ExtractionError:
            return {"text": "", "title": "", "author": "", "url": campaign.article_url}
    if campaign.article_text:
        return {"text": campaign.article_text[:6000], "title": "", "author": "", "url": ""}
    return {"text": "", "title": "", "author": "", "url": ""}


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


def _element_descriptor(el: CampaignElement) -> str:
    if el.element_type == ElementType.carousel:
        desc = f"a carousel of {el.carousel_slides} slides"
    elif el.element_type == ElementType.video:
        desc = f"a {el.video_duration_seconds}s video"
    elif el.element_type == ElementType.text:
        desc = "a text-only post (no visual)"
    else:
        desc = "a single image"
    if el.theme:
        desc += f" — concept/theme: {el.theme}"
    return desc


def _element_lines(elements: list[CampaignElement]) -> str:
    return "\n".join(f"POST {i + 1} accompanies {_element_descriptor(el)}" for i, el in enumerate(elements))


EDITORIAL_INSTRUCTIONS = """\
You are the Editorial Agent for a social media marketing platform. Generate {num_posts}
distinct {platform} post(s) for a campaign with objective "{objective}".

Each post accompanies one campaign element (its visual). Write copy that matches that
element's type and concept:
{element_lines}

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
You are the Visual Creative Agent for a social media marketing platform. For each
campaign element below, write detailed AI generation prompt(s). Image elements need 1
prompt, carousels need one prompt per slide (visually coherent as a sequence), and video
elements need 1 motion/video prompt.

Each prompt must specify subject, composition, style, lighting, and a color palette that
aligns with the brand's visual style and corporate colors. Provide a negative prompt
listing elements to avoid. If the brand style or your system instructions call for
headline text rendered inside the image, include the exact wording in double quotes in
the prompt and describe its placement and typography; otherwise avoid in-image text.
The same prompt will be rendered at several aspect ratios, so keep the main subject
centered and the composition flexible.

ELEMENTS:
{element_lines}

Answer ONLY with a JSON array — one object per element, in the same order as given:
[
  {{
    "prompts": [
      {{"prompt": string, "negative_prompt": string}},
      ...
    ]
  }},
  ...
]
Each element must get exactly the number of prompts stated above.
"""


def _emoji_rule(value: str) -> str:
    return {"none": "no emojis", "moderate": "a moderate number of emojis", "abundant": "abundant emojis"}.get(
        value, "a moderate number of emojis"
    )


def _parse_posts(raw: str, num_posts: int, pspec) -> list[dict]:
    results = parse_json_value(raw, opener="[", closer="]")
    if not isinstance(results, list) or not results:
        raise ExtractionError(f"The Editorial Agent did not return posts for {pspec.label}")
    posts: list[dict] = []
    for item in results[:num_posts]:
        posts.append({
            "headline": str(item.get("headline", "")).strip(),
            "copy": str(item.get("copy", "")).strip()[: pspec.char_limit],
            "cta": str(item.get("cta", "")).strip(),
            "hashtags": [str(h).strip() for h in item.get("hashtags", []) if str(h).strip()],
            "best_time": str(item.get("best_time", "")).strip(),
            "rationale": str(item.get("rationale", "")).strip(),
        })
    # Pad if the model returned fewer posts than elements so zip() stays aligned.
    while len(posts) < num_posts:
        posts.append({"headline": "", "copy": "", "cta": "", "hashtags": [], "best_time": "", "rationale": ""})
    return posts


def generate_posts_copy(
    db: Session,
    client: Client,
    campaign: Campaign,
    cp: CampaignPlatform,
    elements: list[CampaignElement],
    context: str,
) -> list[dict]:
    """Editorial Agent: one post per element for the given platform."""
    cfg = get_llm_config(db, LLMFunction.editorial_agent)
    pspec = spec(cp.platform)
    cta_rule = (
        f"include a call to action ({cp.cta_text})" if cp.include_cta and cp.cta_text
        else "include a call to action" if cp.include_cta
        else "do not include a call to action"
    )
    instructions = EDITORIAL_INSTRUCTIONS.format(
        num_posts=len(elements),
        platform=pspec.label,
        objective=campaign.objective.value,
        element_lines=_element_lines(elements),
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
    return _parse_posts(raw, len(elements), pspec)


ARTICLE_EDITORIAL_INSTRUCTIONS = """\
You are the Editorial Agent in Article-to-Content mode. Generate {num_posts} {platform}
post(s) that reference or promote the SOURCE ARTICLE below, with a {angle} angle.

Each post accompanies one campaign element (its visual). Write copy that matches that
element's type and concept:
{element_lines}

Platform rules:
- Copy MUST NOT exceed {char_limit} characters.
- Emoji usage: {emojis}.
- Include {hashtag_count} hashtags following this mix: {hashtag_mix} (branded/trending/niche percentages).
- Platform tone: {tone}
- Content language: {language}
- {link_behavior}

Each post must take a distinct angle on the article. Answer ONLY with a JSON array of
{num_posts} object(s), each with exactly these keys:
[
  {{
    "headline": string (short opening hook),
    "copy": string (the main post copy, within the character limit, referencing the article),
    "cta": string (call to action, empty string if none),
    "hashtags": [string, ...] (each starting with #),
    "best_time": string (suggested posting day/time, indicative),
    "rationale": string (1-2 sentences: why this angle suits the article and objective)
  }},
  ...
]
Write all content in {language}. Stay faithful to the article — do not invent facts.
"""

_ANGLE_LABELS = {
    "informational": "informational",
    "opinion": "opinion/thought-leadership",
    "promotional": "promotional",
    "educational": "educational",
}


def _link_behavior(
    platform: Platform, include_link: bool, link_format: str, url: str, mention_author: bool, author: str
) -> str:
    """Per-platform link handling guidance (PRD §6.4)."""
    link = url or "the article URL"
    parts: list[str] = []
    if platform == Platform.linkedin:
        parts.append(
            "Write in a 'mini-article' style; LinkedIn copy can be more extensive. "
            "Do NOT put the link in the body — instead end the copy by noting the link is "
            "in the first comment."
        )
        if mention_author and author:
            parts.append(f"Mention the article author ({author}).")
    elif platform in (Platform.instagram, Platform.tiktok):
        parts.append("Links are not clickable here: do not place a URL in the copy; reference 'Link in bio' instead.")
    elif platform == Platform.facebook:
        if include_link:
            parts.append(f"Include the article link directly in the post: {link}.")
        else:
            parts.append("Write a descriptive preview of the article without a raw link.")
    elif platform == Platform.x:
        if include_link:
            parts.append(f"Include the article link in the tweet ({link}); it counts toward the character limit.")
        parts.append("If the article is long, you may format the post as the opening tweet of a thread.")
    elif platform == Platform.youtube:
        parts.append(f"Write a video description that references the article, with the link in the description body: {link}.")
    if include_link and link_format == "shortened" and platform in (Platform.facebook, Platform.x, Platform.youtube):
        parts.append("Present the link as a shortened-style URL.")
    return " ".join(parts) if parts else "No special link handling required."


def generate_article_posts_copy(
    db: Session,
    client: Client,
    campaign: Campaign,
    cp: CampaignPlatform,
    elements: list[CampaignElement],
    context: str,
    article_meta: dict,
) -> list[dict]:
    """Editorial Agent (Article-to-Content mode, PRD §6) for one platform."""
    cfg = get_llm_config(db, LLMFunction.editorial_agent)
    pspec = spec(cp.platform)
    instructions = ARTICLE_EDITORIAL_INSTRUCTIONS.format(
        num_posts=len(elements),
        platform=pspec.label,
        element_lines=_element_lines(elements),
        angle=_ANGLE_LABELS.get(campaign.content_angle, "informational"),
        char_limit=pspec.char_limit,
        emojis=_emoji_rule(cp.emojis),
        hashtag_count=cp.hashtag_count,
        hashtag_mix=cp.hashtag_mix,
        tone=cp.tone or client.communication_tone or "match the brand voice",
        language=campaign.content_language,
        link_behavior=_link_behavior(
            cp.platform,
            campaign.include_article_link,
            campaign.link_format,
            article_meta.get("url", ""),
            campaign.mention_author,
            article_meta.get("author", ""),
        ),
    )
    temperature = creativity_to_temperature(campaign.creativity_level)
    raw = complete_text(cfg, cfg.system_prompt, f"{instructions}\n\nCONTEXT:\n{context}", temperature)
    return _parse_posts(raw, len(elements), pspec)


def generate_platform_copy(
    db: Session,
    client: Client,
    campaign: Campaign,
    cp: CampaignPlatform,
    elements: list[CampaignElement],
    context: str,
    article_meta: dict | None = None,
) -> list[dict]:
    """Editorial copy for one platform: one post per element, mode-aware."""
    if campaign.generation_mode == "article":
        return generate_article_posts_copy(db, client, campaign, cp, elements, context, article_meta or {})
    return generate_posts_copy(db, client, campaign, cp, elements, context)


# Quick "improve with AI" actions for a single copy field. Each maps to a short
# instruction; no free-text input (the UI exposes these as chips).
COPY_ACTIONS: dict[str, str] = {
    "improve": "Rewrite it to be clearer, more compelling and polished.",
    "shorten": "Make it noticeably shorter and punchier while keeping the core message.",
    "punchy": "Make it more punchy, energetic and attention-grabbing.",
    "grammar": "Fix grammar, spelling and punctuation. Keep the meaning and style intact.",
    "professional": "Rewrite it in a more professional, polished tone.",
    "casual": "Rewrite it in a more casual, friendly, conversational tone.",
    "hashtags": "Suggest an optimized set of relevant, high-value hashtags for this post and platform.",
}


def improve_copy(
    db: Session,
    client: Client,
    campaign: Campaign,
    platform: Platform,
    field: str,
    text: str,
    action: str,
) -> str:
    """Improve ONE copy field with the editorial LLM and return the suggestion
    (the caller decides whether to apply it — nothing is persisted here)."""
    cfg = get_llm_config(db, LLMFunction.editorial_agent)
    pspec = spec(platform)
    instruction = COPY_ACTIONS.get(action, COPY_ACTIONS["improve"])
    is_hashtags = field == "hashtags"

    system = (
        "You are an expert social media copy editor revising ONE field of a social post. "
        "Return ONLY the revised text for that field — no preamble, no surrounding quotes, "
        "no explanations, no markdown. "
        + (
            "Return hashtags as a single space-separated line, each starting with '#'."
            if is_hashtags
            else "Preserve the original language of the text."
        )
    )
    limit_note = (
        "" if is_hashtags else f"\nThe {platform.value} copy limit is {pspec.char_limit} characters — stay within it."
    )
    prompt = (
        f"BRAND CONTEXT:\n{_client_context(client)}\n\n"
        f"PLATFORM: {platform.value}{limit_note}\n\n"
        f"FIELD: {field}\n"
        f"INSTRUCTION: {instruction}\n\n"
        f"CURRENT {field.upper()}:\n{text}"
    )
    raw = complete_text(cfg, system, prompt, temperature=0.7)
    return raw.strip().strip('"').strip()


def _slots_for(el: CampaignElement) -> int:
    if el.element_type == ElementType.text:
        return 0
    if el.element_type == ElementType.carousel:
        return max(2, el.carousel_slides)
    return 1


def generate_element_prompts(
    db: Session, campaign: Campaign, elements: list[CampaignElement], context: str
) -> list[list[dict]]:
    """Visual Agent: per element, a list of {prompt, negative_prompt} slots.

    One call covers every visual element of the campaign; text elements get [].
    The same prompts are reused for every aspect-ratio rendition of the element.
    """
    visual = [el for el in elements if _slots_for(el) > 0]
    if not visual:
        return [[] for _ in elements]
    cfg = get_llm_config(db, LLMFunction.visual_agent)
    lines = "\n".join(
        f"ELEMENT {i + 1}: {_element_descriptor(el)} — produce {_slots_for(el)} prompt(s)"
        for i, el in enumerate(visual)
    )
    instructions = VISUAL_INSTRUCTIONS.format(element_lines=lines)
    temperature = creativity_to_temperature(campaign.creativity_level)
    raw = complete_text(cfg, cfg.system_prompt, f"{instructions}\n\nCONTEXT:\n{context}", temperature)
    results = parse_json_value(raw, opener="[", closer="]")
    if not isinstance(results, list):
        raise ExtractionError("The Visual Agent did not return element prompts")

    by_element: dict[str, list[dict]] = {}
    for idx, el in enumerate(visual):
        item = results[idx] if idx < len(results) else {}
        prompts = item.get("prompts", item.get("images", [])) if isinstance(item, dict) else []
        slots: list[dict] = []
        for slot in range(_slots_for(el)):
            p = prompts[slot] if slot < len(prompts) else {}
            slots.append({
                "prompt": str(p.get("prompt", "")).strip(),
                "negative_prompt": str(p.get("negative_prompt", "")).strip(),
            })
        by_element[el.id] = slots
    return [by_element.get(el.id, []) for el in elements]
