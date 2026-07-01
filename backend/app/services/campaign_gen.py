"""Campaign generation agents (PRD §5.4).

Agent 1 (Editorial) produces copy, hashtags, CTA, posting time, and rationale for
every post on a platform. Agent 2 (Visual Creative) produces the image prompt and
negative prompt for every image slot. Both agents are grounded in the client
profile, competitive context, and the client's Brand Memory (§5.3.3).
"""
import logging
import random
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


# Remix: when creativity is high (7-10) the agent may blend two style families.
# Code rolls the dice before the prompt is built; the LLM then decides freely
# whether to take the remix invitation or stay with a single family.
REMIX_CREATIVITY_THRESHOLD = 7


def remix_probability(creativity_level: int | None) -> float:
    """Gradual remix odds: 0 below 7, ramping 0.15 → 0.65 across 7-10."""
    level = max(1, min(10, creativity_level or 5))
    if level < REMIX_CREATIVITY_THRESHOLD:
        return 0.0
    return round(0.15 + (level - 7) / 3 * 0.5, 2)


def remix_family_id(family_a: str, family_b: str) -> str:
    """Canonical remix id: alphabetically sorted, joined with '+'.

    Stable regardless of which family the agent listed first, so
    style_history never creates two separate buckets for the same pair.
    """
    a, b = sorted([family_a, family_b])
    return f"{a}+{b}"


def _is_trackable_family(fam: str, allowed: tuple) -> bool:
    """Accept either a single closed-list family or a remix pair 'a+b'."""
    if fam in allowed:
        return True
    if "+" in fam:
        parts = fam.split("+", 1)
        return len(parts) == 2 and all(p in allowed for p in parts)
    return False


_REMIX_GUIDANCE_ON = """\
## Creative freedom ({creativity_level}/10)

Creativity is set high for this campaign. You MAY deviate from picking a \
single style_family if a genuine blend serves the brief better:
- Blend exactly TWO families from the closed list (e.g. "glassmorphism_layered \
+ dark_mode_luxury" for a premium translucent-on-black look). Pick families \
whose visual_cues are NOT contradictory — do not blend neo_brutalist_web with \
claymorphism_soft_3d (hard-edge vs. soft-edge cancel each other out).
- Set "is_remix": true and "base_families": [family_a, family_b] (exactly two \
values, both from the closed list, alphabetical order).
- The image_prompt must draw concretely from BOTH families' visual_cues — name \
specific elements from each. A remix must be at least as specific as a single \
family pick, not vaguer.
- You are NOT required to remix. If a single family from the closed list \
genuinely fits best, pick that instead and set "is_remix": false, \
"base_families": [].
- Do not remix more than two families. Do not invent vocabulary outside the \
closed list's visual_cues.
"""

_REMIX_GUIDANCE_OFF = """\
## Creative freedom ({creativity_level}/10)

Pick exactly ONE style_family from the closed list above for this campaign's \
creativity level. Creative remixing is not in play for this generation.
"""


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

# Visual Creative Director — schema enforced by Stage 1.3 (revised by the
# example-image feedback). The agent picks ONE style_family per element
# from the closed list, returns a structured direction with rationale,
# and a SINGLE image prompt that includes BOTH the visual AND the
# copy (text rendered inside the image is the target look). The
# layout engine (Phase 2) is no longer the source of truth for copy;
# it becomes a re-render safety net for when the AI gets text wrong.
_ALLOWED_STYLE_FAMILIES = (
    # Original 6
    "bold_typographic",
    "lifestyle_ugc",
    "editorial_collage",
    "3d_product_hero",
    "imperfect_hand_drawn",
    "surreal_seasonal_scene",
    # 2025-2026 trend additions
    "glassmorphism_layered",
    "neo_brutalist_web",
    "y2k_retro_futurism",
    "dark_mode_luxury",
    "claymorphism_soft_3d",
    "maximalist_eclectic_collage",
    "swiss_international_minimal",
    "gradient_mesh_abstract",
    "organic_blob_botanical",
    "kinetic_motion_typography",
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
For each campaign element below, return a structured style direction AND
a single image prompt that the image model will render as the final
asset. The image is the deliverable — it includes background, subject,
AND the marketing copy (headline, subtitle, body, CTA, brand mark).

Image elements need 1 direction, carousels need one per slide
(visually coherent as a sequence), and video elements need 1 motion/video
direction.

## Allowed style_families (pick from this list only)

The visual library is intentionally curated. Do not invent a family name
not on this list. Read the style_cards in the system for the full
visual_cues + negative_constraints of each:

- bold_typographic              — SaaS product launches, punchy offers, hero ads.
                                  Oversized typographic headline, ONE emphasis word
                                  in a contrasting brand colour, soft gradient
                                  background, glowing orbs, product mockup,
                                  logo top-left, feature chips footer.
- lifestyle_ugc                 — trust-building, local services, community.
                                  Real-world setting, candid human moment,
                                  phone-camera grain, NOT studio polish.
- editorial_collage             — campaigns, fashion, events. Cut-outs,
                                  layered paper, torn edges, mixed type scale,
                                  asymmetric grid, warm neutrals + one accent.
- 3d_product_hero               — products, SaaS feature launch, tech. Single
                                  hero object, studio lighting, rim light,
                                  soft shadow, reflective surface, bokeh background.
- imperfect_hand_drawn          — friendly brands, education, small business.
                                  Scribbles, marker textures, uneven shapes,
                                  playful grid, paper-like background.
- surreal_seasonal_scene        — awareness, festivals, playful offers.
                                  Unexpected scale, dreamlike backdrop,
                                  cinematic colour grade, golden-hour lighting.
- glassmorphism_layered         — SaaS dashboards, fintech, premium digital products.
                                  Frosted-glass translucent panels over a vivid
                                  blurred gradient; thin light-catching borders;
                                  soft inner glow; UI mockup floating inside glass.
- neo_brutalist_web             — streetwear, indie tech, Gen-Z, anti-corporate.
                                  Thick black border, hard-edge offset drop shadow,
                                  flat clashing colour blocks, raw/grid-breaking
                                  layout, condensed monospace headline.
- y2k_retro_futurism            — Gen-Z, music, nostalgia, beauty, fashion.
                                  Chrome/metallic gradient text, holographic foil,
                                  bubble-shaped frames, starburst/lens-flare accents,
                                  saturated candy palette, thin chrome type outline.
- dark_mode_luxury              — luxury goods, finance/wealth, VIP offers.
                                  Near-black background, single metallic accent
                                  (gold/copper), generous negative space, thin-weight
                                  serif or geometric sans, soft directional studio light.
- claymorphism_soft_3d          — consumer apps, wellness, friendly fintech.
                                  Matte clay-like 3D shapes, heavily rounded edges,
                                  dual soft shadow (inset + outset), pastel palette,
                                  even diffused lighting, flat-matte background.
- maximalist_eclectic_collage   — fashion, festivals, Gen-Z, limited drops.
                                  3+ competing focal elements, clashing pattern-on-
                                  pattern, dense layering, 4+ saturated colour blocks,
                                  mixed-media feel, rotated/overlapping elements.
- swiss_international_minimal   — design-forward B2B, editorial, conferences.
                                  Strict modular grid, geometric grotesque sans
                                  (weight 400-700), 1-2 flat colours, large confident
                                  numerals, structured whitespace, thin rule dividers.
- gradient_mesh_abstract        — SaaS/AI products, devtools, modern B2B.
                                  Multi-point mesh gradient (4+ colour nodes), fine
                                  grain/noise overlay to prevent banding, crisp
                                  foreground card floating above, asymmetric gradient
                                  brightest point.
- organic_blob_botanical        — wellness, clean beauty, eco, food & beverage.
                                  Soft organic blob shapes, botanical motifs (leaves/
                                  florals), bright-but-earthy palette (terracotta/
                                  sage/coral), paper/linen texture, natural shadow.
- kinetic_motion_typography     — flash sales, sports, urgency campaigns, app drops.
                                  Directional motion blur on headline/hero, diagonal
                                  compositional energy (15-30° off horizontal), speed-
                                  line accents, bold condensed italic headline weight
                                  800-900, one 'hot' accent colour (orange-red/yellow).

{remix_guidance}

## Hard rules (apply in this order)

1. Obey explicit user style instructions first (e.g. "make it look like
   a 90s polaroid" — pick the family that fits, or invent within reason).
2. Obey brand kit: brand colours, tone, fonts. Use the brand's primary
   colour for the emphasis word in bold_typographic headlines, and
   the brand's secondary colour for decorative elements.
3. Pick a style_family from the closed list above, OR — only when the
   creativity guidance above explicitly enables remixing — blend exactly
   two families (set is_remix=true, base_families=[a, b]). Never invent
   a family name outside the closed list; a remix uses two existing names,
   never a new word. Different elements in the same campaign SHOULD NOT
   all pick the same family. Carousels may pick one and stay consistent;
   other elements should differ.
4. AVOID the style_families the user has already seen recently
   (see "Recent style_families" block in CONTEXT below). Only repeat
   one if the user explicitly asked for a series with the same look.
5. The image IS the final asset — render headline, subtitle, body
   copy, CTA and brand logo as part of the image. Feature chips are
   OPTIONAL and only belong in styles whose visual_cues call for a
   chip/pill row (e.g. bold_typographic) — do NOT default to a
   rounded-pill footer row for every style; it is the single most
   common way every poster ends up looking the same. Placement of
   the logo and any chips must follow the chosen style_family's own
   visual language (e.g. dark_mode_luxury wants a discreet corner
   mark, not a footer bar; swiss_international_minimal places the
   logo inside the grid, not floating over it). Be specific about
   typography: name the font family (geometric sans-serif, modern
   serif, hand-drawn display), the weight (weight 800 for headlines,
   weight 400 for body), and the exact placement (e.g. 'headline
   top-left, 60% of canvas height'). The brand's headline copy is in
   the user's CONTEXT block below under 'must_use_copy' — use the
   exact wording in the image, with ONE word highlighted in a
   contrasting brand colour.
6. NEVER use these banned phrases (or close variants):
   {banned_phrases}.
   These are the symptoms of "every poster looks the same". If you
   catch yourself reaching for them, pick a different style_family
   instead.
7. Be specific. Name the medium (watercolour, risograph, 35mm film,
   marker on kraft paper, 3D render in Cinema 4D, photograph, vector
   flat illustration, etc.), the composition (split layout with
   text-left-product-right, centred, layered z-depth, etc.), the
   lighting (golden hour, rim light, soft window light, hard flash,
   neon spill, studio three-point, etc.), the texture (paper grain,
   fabric weave, soft bokeh, hard shadow, screen-print halftone,
   etc.), the colour mood (named, not hex — "warm amber + muted
   teal", "dusty rose + ink black", "acid green + bone"). Generic
   adjectives are a banned phrase in disguise.

## Output schema (strict)

Return ONLY a JSON array, one object per element, in the same order as
given. Each element gets exactly the number of directions stated:

[
  {{
    "style_family": "one of the 16 allowed values above (empty string if is_remix=true — use base_families instead)",
    "is_remix": false,
    "base_families": [],
    "style_name": "short evocative name e.g. 'Sun-Washed Product Hero' or 'Frosted Dark Launch' for a remix",
    "novelty_reason": "why this differs from the user's recent style_families",
    "visual_keywords": ["specific", "medium", "terms", "not", "generic"],
    "composition": "specific placement, framing, focal point",
    "colour_mood": "named palette, not hex (e.g. 'warm amber + aqua')",
    "font_mood": "1-line description of the typography (e.g. 'geometric sans-serif weight 800 headline with weight 700 brand-colour emphasis word, weight 400 italic quote, weight 400 body')",
    "image_prompt": "Detailed prompt for the image model. INCLUDES the marketing copy as part of the image. Specify: medium, composition, lighting, textures, colour mood, brand mood, and the typography. Be specific and DERIVE the layout from THIS element's chosen style_family's visual_cues — do not reuse the same generic layout every time (e.g. 'render the headline \"<exact text>\" in geometric sans-serif weight 800 at top-left, 60% of canvas height; render the word \"<word>\" in <brand colour> weight 700' is one possible layout for bold_typographic, not a template for every style). Name where the brand logo sits using language that matches the style (discreet corner mark for dark_mode_luxury, inside the grid for swiss_international_minimal, etc.) and only add a feature-chip row if the style calls for one. The same prompt will be re-rendered at multiple aspect ratios, so keep the main subject centred and composition flexible. Avoid every banned phrase.",
    "negative_prompt": "what to avoid (e.g. 'blurry, low resolution, generic gradient, no fake text, no centered template look')",
    "headline_text": "the headline copy as it should appear in the image (use must_use_copy from CONTEXT, or invent if not provided)",
    "subtext": "the quote or subtitle, if any",
    "cta": "the call-to-action, if any",
    "feature_chips": ["0-4 short labels for a footer feature row, ONLY if the chosen style_family's visual_cues call for one — leave empty for styles like dark_mode_luxury, swiss_international_minimal, y2k_retro_futurism where a pill-row footer would look generic"],
    "avoid": ["anti-patterns specific to this style choice, e.g. 'no centered template look', 'no repeated icon grid'"]
  }}
]

The image generator receives `image_prompt` + `negative_prompt` as-is.
`headline_text`, `subtext`, `cta`, and `feature_chips` are the exact
copy the user-facing editor will show next to the image so they can
copy-paste it for captions. Everything else is for the QA critic and
the user-facing 'why this looks like this' explanation.

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
    _creativity = campaign.creativity_level or 5
    remix_enabled = random.random() < remix_probability(_creativity)
    remix_guidance = (
        _REMIX_GUIDANCE_ON if remix_enabled else _REMIX_GUIDANCE_OFF
    ).format(creativity_level=_creativity)
    user_prompt = (
        f"{VISUAL_INSTRUCTIONS.format(element_lines=lines, banned_phrases=', '.join(VISUAL_BANNED_PHRASES), remix_guidance=remix_guidance)}{penalty_section}\n\nCONTEXT:\n{context}"
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

    Reads the new schema: one object per element with `image_prompt`
    and `negative_prompt` (used by the image generator — copy is now
    IN the prompt by design, see VISUAL_INSTRUCTIONS). Also pulls the
    `style_family`, `headline_text`, `subtext`, `cta`, and `feature_chips`
    that the agent decided to render. Falls back to the old
    `image_prompt_without_text` / `prompts: [...]` shapes for an admin
    who hasn't updated their visual_agent system_prompt yet.
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
        if "image_prompt" in item or "image_prompt_without_text" in item:
            directions = [item]
        else:
            directions = item.get("prompts", item.get("images", [])) or []
        slots: list[dict] = []
        for slot in range(n_slots):
            d = directions[slot] if slot < len(directions) else {}
            if not isinstance(d, dict):
                d = {}
            # Image prompt: prefer the new `image_prompt`, fall back to
            # the Stage-1.3 `image_prompt_without_text` (admin hasn't
            # updated system_prompt), then to the old `prompt` shape.
            img_prompt = (
                d.get("image_prompt")
                or d.get("image_prompt_without_text")
                or d.get("prompt")
                or ""
            )
            # text_overlay_plan is deprecated by the new direct-in-prompt
            # approach but kept for backwards-compat.
            overlay = d.get("text_overlay_plan") or {}
            # Resolve style_family: single pick or remix pair.
            raw_family = str(d.get("style_family", "")).strip()
            is_remix = bool(d.get("is_remix", False))
            base_families_raw = d.get("base_families") or []
            base_families = [str(f).strip() for f in base_families_raw if str(f).strip()]
            if is_remix and len(base_families) == 2 and all(f in _ALLOWED_STYLE_FAMILIES for f in base_families):
                resolved_family = remix_family_id(base_families[0], base_families[1])
            elif raw_family in _ALLOWED_STYLE_FAMILIES:
                resolved_family = raw_family
                is_remix = False
                base_families = []
            else:
                resolved_family = None  # keyword inference fallback handled downstream
                is_remix = False
                base_families = []
            slots.append({
                "prompt": str(img_prompt).strip(),
                "negative_prompt": str(d.get("negative_prompt", "")).strip(),
                "style_family": resolved_family,
                "is_remix": is_remix and resolved_family is not None and "+" in (resolved_family or ""),
                "base_families": base_families,
                "style_name": str(d.get("style_name", "")).strip(),
                "novelty_reason": str(d.get("novelty_reason", "")).strip(),
                "visual_keywords": [str(k).strip() for k in (d.get("visual_keywords") or []) if str(k).strip()],
                "colour_mood": str(d.get("colour_mood", "")).strip(),
                "font_mood": str(d.get("font_mood", "")).strip() or str(d.get("font_mood_for_overlay", "")).strip(),
                "headline_text": str(d.get("headline_text", "") or overlay.get("headline", "")).strip(),
                "subtext": str(d.get("subtext", "") or overlay.get("subtext", "")).strip(),
                "cta": str(d.get("cta", "") or overlay.get("cta", "")).strip(),
                "feature_chips": [str(c).strip() for c in (d.get("feature_chips") or []) if str(c).strip()],
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
                            if not _is_trackable_family(fam, _ALLOWED_STYLE_FAMILIES):
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
