"""Platform specifications (PRD §5.2): copy character limits, supported visual
formats, and recommended image aspect ratios per platform.
"""
import re
from dataclasses import dataclass, field

from app.models.campaign import Platform, VisualFormat

# Aspect ratio -> generation/canvas pixel dimensions.
ASPECT_DIMENSIONS: dict[str, tuple[int, int]] = {
    "1:1": (1080, 1080),
    "4:5": (1080, 1350),
    "16:9": (1280, 720),
    "9:16": (1080, 1920),
    "1.91:1": (1200, 628),
}


@dataclass(frozen=True)
class PlatformSpec:
    label: str
    char_limit: int
    aspect_ratios: list[str]
    formats: list[VisualFormat] = field(default_factory=lambda: [VisualFormat.static_image])
    # Platform rejects posts without an image/video (e.g. Instagram's media
    # container API), so text-only elements must not target it.
    requires_media: bool = False

    @property
    def default_ratio(self) -> str:
        return self.aspect_ratios[0]


PLATFORM_SPECS: dict[Platform, PlatformSpec] = {
    Platform.facebook: PlatformSpec(
        "Facebook", 63206, ["1:1", "4:5", "16:9"], [VisualFormat.static_image, VisualFormat.carousel]
    ),
    Platform.instagram: PlatformSpec(
        "Instagram", 2200, ["1:1", "4:5", "9:16"], [VisualFormat.static_image, VisualFormat.carousel],
        requires_media=True,
    ),
    Platform.linkedin: PlatformSpec(
        "LinkedIn", 3000, ["1:1", "1.91:1"], [VisualFormat.static_image, VisualFormat.carousel]
    ),
    Platform.tiktok: PlatformSpec(
        "TikTok", 2200, ["9:16"], [VisualFormat.static_image, VisualFormat.carousel],
        requires_media=True,
    ),
    Platform.x: PlatformSpec("X (Twitter)", 280, ["16:9", "1:1"], [VisualFormat.static_image]),
    Platform.youtube: PlatformSpec(
        "YouTube", 5000, ["16:9"], [VisualFormat.static_image], requires_media=True
    ),
}


def spec(platform: Platform) -> PlatformSpec:
    return PLATFORM_SPECS[platform]


# ---------------------------------------------------------------------------
# Character-limit enforcement (shared by generation AND publishing so a post
# that passes one always passes the other).
# ---------------------------------------------------------------------------

def _char_weight(ch: str, platform: Platform) -> int:
    # X's weighted length (simplified twitter-text rule): emoji/CJK and
    # anything from U+1100 up count as 2 characters — X rejects >280 weighted
    # chars with an opaque 403. Other platforms count plain characters.
    return 2 if platform == Platform.x and ord(ch) >= 0x1100 else 1


# X auto-links URLs AND bare domains (e.g. "i4tglobal.com") and wraps each in a
# t.co link that always counts as 23 characters — regardless of actual length.
# Verified live 2026-07-02: a 272-weighted-char tweet with a 13-char bare domain
# was rejected 403 (272 - 13 + 23 = 282 > 280).
_X_URL_RE = re.compile(r"(?i)\bhttps?://\S+|\bwww\.\S+|\b(?:[a-z0-9][a-z0-9-]*\.)+[a-z]{2,6}(?:/[^\s]*)?")
_TCO_LEN = 23


def _char_weights(text: str, platform: Platform) -> list[int]:
    """Per-character weights; on X each URL span costs a flat 23 (t.co)."""
    weights = [_char_weight(ch, platform) for ch in text]
    if platform == Platform.x:
        for m in _X_URL_RE.finditer(text):
            for i in range(m.start(), m.end()):
                weights[i] = 0
            weights[m.start()] = _TCO_LEN
    return weights


def weighted_len(text: str, platform: Platform) -> int:
    return sum(_char_weights(text, platform))


def truncate_to_limit(text: str, limit: int, platform: Platform) -> str:
    """Truncate so weighted_len(result) <= limit, on a word boundary, with an ellipsis."""
    weights = _char_weights(text, platform)
    if sum(weights) <= limit:
        return text
    budget = limit - _char_weight("…", platform)
    if budget <= 0:
        return ""
    used = 0
    end = 0
    for i, w in enumerate(weights):
        if used + w > budget:
            break
        used += w
        end = i + 1
    cut = text[:end].rstrip()
    space = cut.rfind(" ")
    if space > len(cut) // 2:  # prefer a word boundary unless it costs too much
        cut = cut[:space].rstrip()
    return cut + "…"


def compose_post_text(headline: str, copy: str, cta: str, hashtags: list[str]) -> str:
    """Join post fields exactly the way publishing composes the outgoing text
    (publishing.compose_text): non-empty parts separated by blank lines, the
    hashtag line last."""
    parts = [v.strip() for v in (headline, copy, cta) if v and v.strip()]
    tag_line = " ".join(
        str(t).strip() if str(t).strip().startswith("#") else f"#{str(t).strip()}"
        for t in (hashtags or []) if str(t).strip()
    )
    return "\n\n".join(parts + ([tag_line] if tag_line else []))


def fit_post_fields(
    platform: Platform, headline: str, copy: str, cta: str, hashtags: list[str]
) -> tuple[str, str, str, list[str]]:
    """Deterministically fit a post's fields so the composed outgoing text never
    exceeds the platform's char limit: drop hashtags from the end first, then
    shrink copy, CTA, and headline (in that order)."""
    limit = spec(platform).char_limit
    tags = [str(h).strip() for h in (hashtags or []) if str(h).strip()]
    fields = {"headline": (headline or "").strip(), "copy": (copy or "").strip(), "cta": (cta or "").strip()}

    def total() -> int:
        return weighted_len(
            compose_post_text(fields["headline"], fields["copy"], fields["cta"], tags), platform
        )

    while tags and total() > limit:
        tags.pop()
    for name in ("copy", "cta", "headline"):
        over = total() - limit
        if over <= 0:
            break
        budget = weighted_len(fields[name], platform) - over
        fields[name] = truncate_to_limit(fields[name], budget, platform) if budget > 0 else ""
    return fields["headline"], fields["copy"], fields["cta"], tags


def dimensions_for(aspect_ratio: str) -> tuple[int, int]:
    return ASPECT_DIMENSIONS.get(aspect_ratio, (1080, 1080))


# Tie-break order when several ratios cover the same number of platforms.
RATIO_PRIORITY = ["1:1", "4:5", "9:16", "16:9", "1.91:1"]


def resolve_platform_ratios(
    platforms: list[Platform], overrides: dict[str, str] | None = None
) -> dict[str, str]:
    """Assign one aspect ratio per platform, minimizing the number of distinct
    ratios (and therefore the number of renditions to generate).

    Greedy set cover over each platform's supported ratios; an override pins a
    platform to a specific ratio when that platform supports it. Returns
    {platform_value: ratio}.
    """
    overrides = overrides or {}
    resolved: dict[str, str] = {}
    remaining: list[Platform] = []
    for p in platforms:
        override = overrides.get(p.value)
        if override and override in spec(p).aspect_ratios:
            resolved[p.value] = override
        else:
            remaining.append(p)

    while remaining:
        # Ratios pinned by overrides cover compatible platforms for free.
        best, covered = None, []
        candidates = list(dict.fromkeys(list(resolved.values()) + RATIO_PRIORITY))
        for ratio in candidates:
            takes = [p for p in remaining if ratio in spec(p).aspect_ratios]
            if len(takes) > len(covered):
                best, covered = ratio, takes
        if best is None:  # unreachable: every platform supports at least one ratio
            best, covered = spec(remaining[0]).default_ratio, [remaining[0]]
        for p in covered:
            resolved[p.value] = best
        remaining = [p for p in remaining if p not in covered]
    return resolved
