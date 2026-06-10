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

from PIL import Image
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

    out = io.BytesIO()
    base.convert("RGB").save(out, format="PNG")
    return out.getvalue()


def _campaign_id(db: Session, image: PostImage) -> str:
    from app.models.campaign import Post

    post = db.get(Post, image.post_id)
    return post.campaign_id if post else ""
