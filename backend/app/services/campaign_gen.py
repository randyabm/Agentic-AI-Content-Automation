"""Campaign generation agents (PRD §5.4).

Agent 1 (Editorial) produces copy, hashtags, CTA, posting time, and rationale for
every post on a platform. Agent 2 (Visual Creative) produces the image prompt and
negative prompt for every image slot. Both agents are grounded in the client
profile, competitive context, and the client's Brand Memory (§5.3.3).
"""
import logging
from concurrent.futures import ThreadPoolExecutor
from types import SimpleNamespace

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
Write all content in {language}. Ground everything in the provided context.
"""

# Visual Creative Director — schema enforced by Stage 1.3. The agent picks
# ONE style_family per element from the closed list, returns a structured
# direction with rationale, and a background-only image prompt (no text
# inside the image — the layout engine adds copy deterministically in
# Stage 2).
_ALLOWED_STYLE_FAMILIES = (
    "bold_typographic",
    "lifestyle_ugc",
    "editorial_collage",
    "3d_product_hero",
    "imperfect_hand_drawn",
    "surreal_seasonal_scene",
)

# Banned phrases — these are the symptoms of "every image looks the same"
# that the research blueprint called out. Listing them explicitly in the
# prompt is the cheapest fix for static visual vocabulary.
VISUAL_BANNED_PHRASES = (
    "modern clean design",
    "beautiful poster",
    "eye-catching",
    "high quality",
    "professional",
    "vibrant",
    "stunning",
    "bold typography",
    "clean lines",
    "eye catching",
    "sleek",
    "polished",
    "premium feel",
    "modern minimal",
    "contemporary",
    "stylish",
    "elegant",
)

VISUAL_INSTRUCTIONS = """\
You are the Visual Creative Director for a social-media marketing platform.
For each campaign element below, return a structured style direction + a
background-only image prompt. Image elements need 1 direction, carousels
need one per slide (visually coherent as a sequence), and video elements
need 1 motion/video direction.

## Allowed style_families (pick ONE per element, no others)

The visual library is intentionally closed. Do not invent a new family.
The six families and when to use them:

- bold_typographic        — offers, launches, punchy ads. Oversized headline
                            blocks, strong hierarchy, high contrast. The
                            LAYOUT ENGINE renders the type; the image
                            only carries background and subject.
- lifestyle_ugc            — trust-building, local services, community.
                            Real-world setting, candid human moment,
                            phone-camera feel. NOT polished.
- editorial_collage        — campaigns, fashion, events, creative services.
                            Cut-outs, layered paper, mixed type scale,
                            asymmetric grid.
- 3d_product_hero          — products, SaaS feature launch, tech. Single
                            hero object, studio lighting, depth, reflective
                            surfaces. NOT multi-subject.
- imperfect_hand_drawn     — friendly brands, education, small business.
                            Scribbles, marker textures, uneven shapes.
                            NOT for luxury / finance / legal.
- surreal_seasonal_scene   — awareness, festivals, playful offers.
                            Unexpected scale, dreamlike backdrop,
                            cinematic colour. NOT for regulated topics.

## Hard rules (apply in this order)

1. Obey explicit user style instructions first (e.g. "make it look like a
   90s polaroid" — pick the family that fits, or invent within reason).
2. Obey brand kit: brand colours, tone, fonts.
3. Pick a style_family from the closed list above. Different elements in
   the same campaign SHOULD NOT all pick the same family. Carousels may
   pick one and stay consistent; other elements should differ.
4. AVOID the style_families the user has already seen recently
   (see "Recent style_families" block in CONTEXT below). Only repeat one
   if the user explicitly asks for a series with the same look.
5. NEVER ask the image model to render marketing text inside the image.
   No letters, no words, no numbers, no logos, no watermarks, no fake
   captions, no UI mockups. The layout engine adds copy afterwards.
6. NEVER use these banned phrases (or close variants):
   {banned_phrases}.
   These are the symptoms of "every poster looks the same". If you catch
   yourself reaching for them, pick a different style_family instead.
7. Be specific. Name the medium (watercolour, risograph, 35mm film,
   marker on kraft paper, 3D render in Cinema 4D, etc.), the composition
   (subject placement, focal point, negative space), the lighting
   (golden hour, rim light, soft window light, hard flash, neon
   spill), the texture (paper grain, fabric weave, soft bokeh, hard
   shadow), the colour mood (named, not hex — "warm amber + muted
   teal", "dusty rose + ink black", "acid green + bone"). Generic
   adjectives are a banned phrase in disguise.

## Output schema (strict)

Return ONLY a JSON array, one object per element, in the same order as
given. Each element gets exactly the number of directions stated:

[
  {{
    "style_family": "one of the 6 allowed values above",
    "style_name": "short evocative name e.g. 'Sun-Washed Product Hero'",
    "novelty_reason": "why this differs from the user's recent style_families",
    "visual_keywords": ["specific", "medium", "terms", "not", "generic"],
    "composition": "specific placement, framing, focal point",
    "colour_mood": "named palette, not hex (e.g. 'warm amber + aqua')",
    "font_mood_for_overlay": "1-line description of the type style the layout engine should use for headlines (only relevant for bold_typographic / editorial_collage)",
    "image_prompt_without_text": "Detailed prompt for the image model. NO TEXT, NO LETTERS, NO LOGOS, NO WATERMARKS, NO UI in the image. Background and subject only. The same prompt will be re-rendered at multiple aspect ratios, so keep the main subject centred and composition flexible. Include: medium, composition, lighting, textures, colour mood, brand mood. Be specific and avoid every banned phrase.",
    "negative_prompt": "what to avoid (e.g. 'blurry, low resolution, generic gradient')",
    "text_overlay_plan": {{
      "headline": "the headline copy if the post already has one (empty if not yet decided)",
      "subtext": "...",
      "cta": "...",
      "layout_notes": "where the layout engine should place the text (e.g. 'top-left, leave 25% of canvas empty', 'bottom-right above safe zone')"
    }},
    "avoid": ["anti-patterns specific to this style choice, e.g. 'no fake text', 'no centred template look'"]
  }}
]

The image generator will receive only `image_prompt_without_text` and
`negative_prompt`. Everything else is for the layout engine, the QA
critic, and the user-facing 'why this looks like this' explanation.

ELEMENTS:
{element_lines}

Answer ONLY with the JSON array. No prose, no code fences, no
explanations. If a field doesn't apply, set it to an empty string or
empty array.
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


def _normal_instructions(
    client: Client, campaign: Campaign, cp: CampaignPlatform, elements: list[CampaignElement]
) -> str:
    """Format the standard (non-article) editorial instructions for one platform."""
    pspec = spec(cp.platform)
    cta_rule = (
        f"include a call to action ({cp.cta_text})" if cp.include_cta and cp.cta_text
        else "include a call to action" if cp.include_cta
        else "do not include a call to action"
    )
    return EDITORIAL_INSTRUCTIONS.format(
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


ARTICLE_EDITORIAL_INSTRUCTIONS = """\
You are the Editorial Agent in Article-to-Content mode. Generate {num_posts} {platform}
post(s) that reference or promote the SOURCE ARTICLE provided in the context, with a {angle} angle.

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


def _article_instructions(
    client: Client,
    campaign: Campaign,
    cp: CampaignPlatform,
    elements: list[CampaignElement],
    article_meta: dict,
) -> str:
    """Format the Article-to-Content editorial instructions for one platform (PRD §6)."""
    pspec = spec(cp.platform)
    return ARTICLE_EDITORIAL_INSTRUCTIONS.format(
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


def _editorial_instructions(
    client: Client,
    campaign: Campaign,
    cp: CampaignPlatform,
    elements: list[CampaignElement],
    article_meta: dict | None = None,
) -> str:
    """Per-platform editorial instructions, mode-aware. Pure string work (no db/LLM)."""
    if campaign.generation_mode == "article":
        return _article_instructions(client, campaign, cp, elements, article_meta or {})
    return _normal_instructions(client, campaign, cp, elements)


def _snapshot_cfg(src) -> SimpleNamespace:
    """Detach the LLM config into a plain object safe to read from worker threads.

    Worker threads must never touch the SQLAlchemy session (not thread-safe; a commit
    on the session thread expires ORM attributes, forcing a lazy reload off-thread).
    """
    return SimpleNamespace(
        provider=src.provider,
        model_name=src.model_name,
        max_tokens=src.max_tokens,
        temperature=src.temperature,
        resolved_api_key=getattr(src, "resolved_api_key", ""),
        api_key_encrypted=src.api_key_encrypted,
        system_prompt=src.system_prompt,
    )


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
    cfg = get_llm_config(db, LLMFunction.editorial_agent)
    pspec = spec(cp.platform)
    instructions = _editorial_instructions(client, campaign, cp, elements, article_meta)
    temperature = creativity_to_temperature(campaign.creativity_level)
    raw = complete_text(cfg, cfg.system_prompt, instructions, temperature, cache_prefix=f"CONTEXT:\n{context}")
    return _parse_posts(raw, len(elements), pspec)


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


def _prepare_visual(db: Session, campaign: Campaign, elements: list[CampaignElement], context: str):
    """Main-thread prep for the Visual Agent (db + ORM access happens here).

    Returns ``(cfg, user_prompt, temperature, plan, order)`` or ``None`` when there is
    nothing visual to generate. ``plan`` is ``[(element_id, slot_count), ...]`` for the
    visual elements; ``order`` is every element id, so the parsed result aligns with
    ``elements`` (text elements get ``[]``).
    """
    visual = [el for el in elements if _slots_for(el) > 0]
    if not visual:
        return None
    cfg = _snapshot_cfg(get_llm_config(db, LLMFunction.visual_agent))
    lines = "\n".join(
        f"ELEMENT {i + 1}: {_element_descriptor(el)} — produce {_slots_for(el)} prompt(s)"
        for i, el in enumerate(visual)
    )
    # Repetition-penalty hint: the last 5 style_families used for this
    # client (or the org, as a fallback). Empty when there's no history yet.
    # The current VISUAL_INSTRUCTIONS prompt does not yet use this block,
    # but Stage 1.3 will — the block is here so the data starts
    # accumulating from the first generation.
    # Campaign only has client_id; org_id lives on the Client. Resolve it
    # here once so the penalty block and the post-gen record_usage hook
    # (which is the one that actually needs the org) share the same value.
    from app.services.style_repetition import penalty_block

    org_id = ""
    if campaign.client_id:
        client_row = db.get(Client, campaign.client_id)
        if client_row is not None:
            org_id = str(client_row.org_id) if client_row.org_id else ""
    penalty = penalty_block(
        db,
        org_id=org_id,
        client_id=str(campaign.client_id) if campaign.client_id else None,
    )
    penalty_section = f"\n\n{penalty}" if penalty else ""
    user_prompt = (
        f"{VISUAL_INSTRUCTIONS.format(element_lines=lines, banned_phrases=', '.join(VISUAL_BANNED_PHRASES))}{penalty_section}\n\nCONTEXT:\n{context}"
    )
    temperature = creativity_to_temperature(campaign.creativity_level)
    plan = [(el.id, _slots_for(el)) for el in visual]
    order = [el.id for el in elements]
    return cfg, user_prompt, temperature, plan, order


def _infer_style_family(prompt: str) -> str:
    """Best-effort keyword inference of which style_family the visual agent
    picked for a given prompt. Used only until Stage 1.3 wires the
    explicit style_family field from the agent's structured output — at
    that point this becomes a no-op fallback. Cheap and good enough to
    start populating style_history from the first generation.
    """
    p = prompt.lower()
    if any(w in p for w in ["headline", "typographic", "typography", "poster", "headline block"]):
        return "bold_typographic"
    if any(w in p for w in ["lifestyle", "candid", "ugc", "real-world", "real world", "phone camera"]):
        return "lifestyle_ugc"
    if any(w in p for w in ["collage", "cut-out", "cut out", "torn edge", "sticker", "cut paper"]):
        return "editorial_collage"
    if any(w in p for w in ["3d", "product hero", "studio lighting", "rim light", "bokeh"]):
        return "3d_product_hero"
    if any(w in p for w in ["hand-drawn", "hand drawn", "marker", "scribble", "playful"]):
        return "imperfect_hand_drawn"
    if any(w in p for w in ["surreal", "seasonal", "dreamlike", "dream", "festival"]):
        return "surreal_seasonal_scene"
    return "unknown"


def _parse_visual(raw: str, plan: list[tuple[str, int]], order: list[str]) -> list[list[dict]]:
    """Pure parse of the Visual Agent's structured output (Stage 1.3+).

    Reads the new schema: one object per element with `image_prompt_without_text`
    and `negative_prompt` (used by the image generator), plus the full
    `text_overlay_plan` and `style_family` (consumed later by the layout
    engine and the QA critic). Falls back to the old `{prompts: [...]}`
    shape if the agent emits it, so an admin who hasn't updated their
    `LLMConfig.system_prompt` for the visual_agent yet still works.
    """
    results = parse_json_value(raw, opener="[", closer="]")
    if not isinstance(results, list):
        raise ExtractionError("The Visual Agent did not return element prompts")
    by_element: dict[str, list[dict]] = {}
    for idx, (el_id, n_slots) in enumerate(plan):
        item = results[idx] if idx < len(results) else {}
        if not isinstance(item, dict):
            item = {}
        # New schema: each item IS a single style direction (not wrapped
        # in `prompts`). If the agent emitted the old shape, unwrap it.
        if "image_prompt_without_text" in item:
            directions = [item]
        else:
            directions = item.get("prompts", item.get("images", [])) or []
        slots: list[dict] = []
        for slot in range(n_slots):
            d = directions[slot] if slot < len(directions) else {}
            if not isinstance(d, dict):
                d = {}
            # Image prompt is `image_prompt_without_text` (new) or `prompt`
            # (old fallback).
            img_prompt = (
                d.get("image_prompt_without_text")
                or d.get("prompt")
                or ""
            )
            overlay = d.get("text_overlay_plan") or {}
            slots.append({
                "prompt": str(img_prompt).strip(),
                "negative_prompt": str(d.get("negative_prompt", "")).strip(),
                "style_family": str(d.get("style_family", "")).strip() or None,
                "style_name": str(d.get("style_name", "")).strip(),
                "novelty_reason": str(d.get("novelty_reason", "")).strip(),
                "visual_keywords": [str(k).strip() for k in (d.get("visual_keywords") or []) if str(k).strip()],
                "colour_mood": str(d.get("colour_mood", "")).strip(),
                "font_mood_for_overlay": str(d.get("font_mood_for_overlay", "")).strip(),
                "text_overlay_plan": {
                    "headline": str(overlay.get("headline", "")).strip(),
                    "subtext": str(overlay.get("subtext", "")).strip(),
                    "cta": str(overlay.get("cta", "")).strip(),
                    "layout_notes": str(overlay.get("layout_notes", "")).strip(),
                },
                "avoid": [str(a).strip() for a in (d.get("avoid") or []) if str(a).strip()],
            })
        by_element[el_id] = slots
    return [by_element.get(eid, []) for eid in order]


def generate_visuals_and_copy(
    db: Session,
    client: Client,
    campaign: Campaign,
    elements: list[CampaignElement],
    platform_elements: list[tuple[CampaignPlatform, list[CampaignElement]]],
    context: str,
    article_meta: dict | None = None,
    generate_images: bool = True,
    max_workers: int = 4,
) -> tuple[list[list[dict]], dict[Platform, list[dict]]]:
    """Run the Visual Agent and every per-platform Editorial Agent concurrently.

    These are all independent LLM calls over the same campaign ``context``, so fanning
    them out as one batch hides the Visual Agent's round-trip under the editorial waves.
    The shared editorial context is cached (see :func:`complete_text`) so the fan-out
    stays within the rate limit. All db/ORM access happens up front on this thread; the
    worker threads only do network I/O + pure parsing.

    Returns ``(element_prompts, posts_by_platform)`` where ``element_prompts`` aligns
    with ``elements`` (text elements get ``[]``).
    """
    # --- Main-thread prep (db + ORM) ---
    visual_prep = _prepare_visual(db, campaign, elements, context) if generate_images else None
    ed_cfg = _snapshot_cfg(get_llm_config(db, LLMFunction.editorial_agent)) if platform_elements else None
    ed_temp = creativity_to_temperature(campaign.creativity_level)
    ed_cache = f"CONTEXT:\n{context}"
    ed_jobs = [
        (cp.platform, _editorial_instructions(client, campaign, cp, els, article_meta), spec(cp.platform), len(els))
        for cp, els in platform_elements
    ]

    # --- Build the concurrent task list: (key, zero-arg callable) ---
    jobs: list[tuple] = []
    if visual_prep is not None:
        v_cfg, v_user, v_temp, _, _ = visual_prep
        jobs.append(("visual", lambda c=v_cfg, u=v_user, t=v_temp: complete_text(c, c.system_prompt, u, t)))
    for platform, instructions, pspec, num in ed_jobs:
        jobs.append((
            ("editorial", platform, pspec, num),
            lambda i=instructions: complete_text(ed_cfg, ed_cfg.system_prompt, i, ed_temp, cache_prefix=ed_cache),
        ))

    element_prompts: list[list[dict]] = [[] for _ in elements]
    posts_by_platform: dict[Platform, list[dict]] = {}
    if not jobs:
        return element_prompts, posts_by_platform

    # --- Run every LLM call concurrently, then parse on this thread ---
    workers = max(1, min(max_workers, len(jobs)))
    with ThreadPoolExecutor(max_workers=workers) as ex:
        raws = list(ex.map(lambda job: (job[0], job[1]()), jobs))

    for key, raw in raws:
        if key == "visual":
            _, _, _, plan, order = visual_prep
            element_prompts = _parse_visual(raw, plan, order)
            # Record the style_families the agent picked for this brand so
            # the next generation's penalty block has data. Stage 1.3
            # schema carries `style_family` explicitly per slot; fall back
            # to keyword inference for any old-shape slots the agent
            # emitted (or for an admin who hasn't updated their
            # visual_agent system prompt yet).
            try:
                from app.services.style_repetition import StyleHistorySource, record_usage

                # Resolve org_id via the Client (Campaign only has client_id).
                # _prepare_visual already resolved this; reuse via Client lookup
                # here is cheap and keeps the hook self-contained.
                org_id = ""
                if campaign.client_id:
                    client_row = db.get(Client, campaign.client_id)
                    if client_row is not None and client_row.org_id:
                        org_id = str(client_row.org_id)
                client_id = str(campaign.client_id) if campaign.client_id else None
                if org_id:
                    seen: set[str] = set()
                    for slots in element_prompts:
                        for slot in slots:
                            fam = slot.get("style_family") or _infer_style_family(slot.get("prompt", ""))
                            if not fam or fam == "unknown" or fam in seen:
                                continue
                            # Sanity-check the family is one we know about.
                            if fam not in _ALLOWED_STYLE_FAMILIES:
                                continue
                            seen.add(fam)
                            record_usage(
                                db,
                                org_id=org_id,
                                client_id=client_id,
                                style_family=fam,
                                image_prompt=slot.get("prompt", ""),
                                source=StyleHistorySource.generation,
                            )
            except Exception:
                logger.exception("Failed to record style_history for campaign %s", campaign.id)
        else:
            _, platform, pspec, num = key
            posts_by_platform[platform] = _parse_posts(raw, num, pspec)
    return element_prompts, posts_by_platform
