"""Flatten the Image Editor canvas (base image + logo + asset layers) into a single
high-resolution PNG for export (PRD §5.5, §5.7).

Canvas state stores layer geometry in coordinates relative to the base image so the
same composition renders correctly at full resolution:
  logo:   {x, y, scale, opacity, locked, visible}
  assets: [{asset_id, x, y, scale, rotation, opacity, z, visible}, ...]
where x/y are the layer's top-left position as a fraction (0..1) of the base size,
scale is the layer width as a fraction of the base width, and opacity is 0..1.
"""
import io
import logging

from PIL import Image, ImageDraw, ImageFont
from sqlalchemy.orm import Session

from app.models.campaign import PostAsset, PostImage
from app.models.client import Client
from app.services import storage

logger = logging.getLogger(__name__)

# Pillow cannot rasterize SVG; such layers are skipped in the server composite
# (the browser editor still renders them for preview).
RASTER_OK = ("image/png", "image/jpeg", "image/jpg", "image/webp")


def _load_image(object_key: str) -> Image.Image | None:
    try:
        data, _ = storage.get_object(object_key)
        return Image.open(io.BytesIO(data)).convert("RGBA")
    except Exception as exc:  # noqa: BLE001 — a missing/broken layer must not abort export
        logger.warning("Could not load layer %s: %s", object_key, exc)
        return None


def _place(base: Image.Image, layer: Image.Image, geom: dict) -> None:
    if geom.get("visible") is False:
        return
    bw, bh = base.size
    scale = float(geom.get("scale", 0.2)) or 0.2
    target_w = max(1, int(bw * scale))
    ratio = layer.height / layer.width if layer.width else 1
    target_h = max(1, int(target_w * ratio))
    resized = layer.resize((target_w, target_h), Image.LANCZOS)

    rotation = float(geom.get("rotation", 0) or 0)
    if rotation:
        resized = resized.rotate(-rotation, expand=True, resample=Image.BICUBIC)

    opacity = float(geom.get("opacity", 1.0))
    if opacity < 1.0:
        alpha = resized.split()[3].point(lambda a: int(a * max(0.0, min(1.0, opacity))))
        resized.putalpha(alpha)

    x = int(float(geom.get("x", 0.5)) * bw)
    y = int(float(geom.get("y", 0.5)) * bh)
    base.alpha_composite(resized, (x, y))


# Font families offered by the editor, mapped to DejaVu TTFs (installed in the image).
# Keyed by (family, bold, italic).
_FONT_FILES = {
    ("sans", False, False): "DejaVuSans.ttf",
    ("sans", True, False): "DejaVuSans-Bold.ttf",
    ("sans", False, True): "DejaVuSans-Oblique.ttf",
    ("sans", True, True): "DejaVuSans-BoldOblique.ttf",
    ("serif", False, False): "DejaVuSerif.ttf",
    ("serif", True, False): "DejaVuSerif-Bold.ttf",
    ("serif", False, True): "DejaVuSerif-Italic.ttf",
    ("serif", True, True): "DejaVuSerif-BoldItalic.ttf",
    ("mono", False, False): "DejaVuSansMono.ttf",
    ("mono", True, False): "DejaVuSansMono-Bold.ttf",
    ("mono", False, True): "DejaVuSansMono-Oblique.ttf",
    ("mono", True, True): "DejaVuSansMono-BoldOblique.ttf",
}


def _load_font(family: str, bold: bool, italic: bool, px: int) -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
    name = _FONT_FILES.get((family, bold, italic)) or _FONT_FILES[("sans", bold, italic)]
    try:
        return ImageFont.truetype(name, px)
    except OSError:
        logger.warning("Font %s not available; falling back to default", name)
        return ImageFont.load_default(px)


def _hex_to_rgb(color: str) -> tuple[int, int, int]:
    color = (color or "#ffffff").lstrip("#")
    if len(color) == 3:
        color = "".join(c * 2 for c in color)
    try:
        return tuple(int(color[i : i + 2], 16) for i in (0, 2, 4))  # type: ignore[return-value]
    except ValueError:
        return (255, 255, 255)


def _place_text(base: Image.Image, geom: dict) -> None:
    """Render one text layer. Geometry mirrors the editor: x/y are the top-left as a
    fraction of the base size, size is the font height as a fraction of the base width."""
    if geom.get("visible") is False:
        return
    text = str(geom.get("text") or "").strip("\n")
    if not text.strip():
        return
    bw, bh = base.size
    px = max(8, int(bw * float(geom.get("size", 0.06))))
    font = _load_font(str(geom.get("font", "sans")), bool(geom.get("bold")), bool(geom.get("italic")), px)
    opacity = max(0.0, min(1.0, float(geom.get("opacity", 1.0))))
    fill = (*_hex_to_rgb(str(geom.get("color", "#ffffff"))), int(255 * opacity))

    # Draw onto a transparent tile so rotation and alpha compositing work like images.
    tile = Image.new("RGBA", (bw * 2, bh * 2), (0, 0, 0, 0))
    draw = ImageDraw.Draw(tile)
    # Match the browser's line-height: 1.2 used by the editor preview.
    draw.multiline_text((0, 0), text, font=font, fill=fill, spacing=int(px * 0.2))
    tile = tile.crop(tile.getbbox() or (0, 0, 1, 1))

    rotation = float(geom.get("rotation", 0) or 0)
    if rotation:
        tile = tile.rotate(-rotation, expand=True, resample=Image.BICUBIC)

    x = int(float(geom.get("x", 0.1)) * bw)
    y = int(float(geom.get("y", 0.1)) * bh)
    base.alpha_composite(tile, (x, y))


def composite_post_image(db: Session, image: PostImage, client: Client) -> bytes:
    """Composite the base image with the logo and asset layers; return PNG bytes."""
    base_data, _ = storage.get_object(image.base_object_key)
    base = Image.open(io.BytesIO(base_data)).convert("RGBA")

    state = image.canvas_state or {}

    # Asset layers, ordered back-to-front by z.
    assets = {a.id: a for a in db.query(PostAsset).filter(PostAsset.campaign_id == _campaign_id(db, image)).all()}
    asset_layers = sorted(state.get("assets", []), key=lambda a: a.get("z", 0))
    for geom in asset_layers:
        asset = assets.get(geom.get("asset_id"))
        if asset is None or asset.content_type not in RASTER_OK:
            continue
        layer = _load_image(asset.object_key)
        if layer is not None:
            _place(base, layer, geom)

    # Logo layer on top (if placed and the client has a raster logo).
    logo_geom = state.get("logo")
    if logo_geom and client.logo_object_key:
        layer = _load_image(client.logo_object_key)
        if layer is not None:
            _place(base, layer, logo_geom)

    # Text layers above everything but the logo's sibling overlays, ordered by z.
    for geom in sorted(state.get("texts", []), key=lambda t: t.get("z", 0)):
        try:
            _place_text(base, geom)
        except Exception as exc:  # noqa: BLE001 — a bad text layer must not abort export
            logger.warning("Could not render text layer: %s", exc)

    out = io.BytesIO()
    base.convert("RGB").save(out, format="PNG")
    return out.getvalue()


def _campaign_id(db: Session, image: PostImage) -> str:
    from app.models.campaign import CampaignElement

    element = db.get(CampaignElement, image.element_id)
    return element.campaign_id if element else ""
