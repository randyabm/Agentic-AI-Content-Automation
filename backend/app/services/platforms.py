"""Platform specifications (PRD §5.2): copy character limits, supported visual
formats, and recommended image aspect ratios per platform.
"""
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

    @property
    def default_ratio(self) -> str:
        return self.aspect_ratios[0]


PLATFORM_SPECS: dict[Platform, PlatformSpec] = {
    Platform.facebook: PlatformSpec(
        "Facebook", 63206, ["1:1", "4:5", "16:9"], [VisualFormat.static_image, VisualFormat.carousel]
    ),
    Platform.instagram: PlatformSpec(
        "Instagram", 2200, ["1:1", "4:5", "9:16"], [VisualFormat.static_image, VisualFormat.carousel]
    ),
    Platform.linkedin: PlatformSpec(
        "LinkedIn", 3000, ["1:1", "1.91:1"], [VisualFormat.static_image, VisualFormat.carousel]
    ),
    Platform.tiktok: PlatformSpec(
        "TikTok", 2200, ["9:16"], [VisualFormat.static_image, VisualFormat.carousel]
    ),
    Platform.x: PlatformSpec("X (Twitter)", 280, ["16:9", "1:1"], [VisualFormat.static_image]),
    Platform.youtube: PlatformSpec("YouTube", 5000, ["16:9"], [VisualFormat.static_image]),
}


def spec(platform: Platform) -> PlatformSpec:
    return PLATFORM_SPECS[platform]


def dimensions_for(aspect_ratio: str) -> tuple[int, int]:
    return ASPECT_DIMENSIONS.get(aspect_ratio, (1080, 1080))
