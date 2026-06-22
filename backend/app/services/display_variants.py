"""Generate WebP display variants (≤800px, ≤1600px) for fast browser loading.

The original PNG/JPEG bytes are kept untouched for social publishing; these
variants are display-only and stored under separate keys.
"""
import io

from PIL import Image

from app.services import storage

DISPLAY_MAX = 800
DISPLAY_2X_MAX = 1600
WEBP_QUALITY = 85


def generate_display_variants(data: bytes, key_prefix: str) -> None:
    """Generate 800px and 1600px WebP display variants and upload them.

    ``key_prefix`` is e.g. ``campaigns/{cid}/images/{id}/display_base``;
    the function appends ``.webp`` and ``@2x.webp``.
    """
    img = Image.open(io.BytesIO(data))
    has_alpha = img.mode in ("RGBA", "LA") or (img.mode == "P" and "transparency" in img.info)
    img = img.convert("RGBA" if has_alpha else "RGB")

    for max_size, suffix in [(DISPLAY_MAX, ""), (DISPLAY_2X_MAX, "@2x")]:
        v = img.copy()
        v.thumbnail((max_size, max_size))
        buf = io.BytesIO()
        v.save(buf, format="WEBP", quality=WEBP_QUALITY, method=4)
        key = f"{key_prefix}{suffix}.webp"
        storage.upload_object(key, buf.getvalue(), "image/webp")


def display_key(campaign_id: str, image_id: str, *, composite: bool, two_x: bool = False) -> str:
    """Convention-based S3 key for a display variant."""
    kind = "display_composite" if composite else "display_base"
    suffix = "@2x" if two_x else ""
    return f"campaigns/{campaign_id}/images/{image_id}/{kind}{suffix}.webp"
