"""Decide where a client's logo should sit on a generated image.

A vision model looks at the image and returns the best spot (a clean, readable
corner that avoids faces/subjects/existing text), the logo size, and whether a
contrast scrim is needed behind it. The logo itself is then composited crisply by
compositing.py — never redrawn by an image model — so the brand mark stays exact.
"""
from __future__ import annotations

import base64
import io
import json
import logging

import anthropic
from PIL import Image
from sqlalchemy.orm import Session

from app.services import providers

logger = logging.getLogger(__name__)

# Vision-capable, cheap Claude model. Any failure falls back to DEFAULT_GEOM.
VISION_MODEL = "claude-haiku-4-5-20251001"

# Bottom-right corner with margin — the safe default when vision is unavailable.
DEFAULT_GEOM = {
    "x": 0.70,
    "y": 0.82,
    "scale": 0.18,
    "opacity": 1.0,
    "rotation": 0,
    "visible": True,
    "auto": True,
    "scrim": False,
    "scrim_color": "dark",
}

_PROMPT = (
    "You are a brand designer placing a company logo onto this social media image. "
    "Return ONLY a JSON object choosing the best placement:\n"
    '{"x": <0-1>, "y": <0-1>, "scale": <0.08-0.30>, "scrim": <true|false>, "scrim_color": "dark"|"light"}\n'
    "where x,y are the logo's TOP-LEFT position as a fraction of the image width/height, and scale is "
    "the logo width as a fraction of the image width. Pick a clean, uncluttered corner with good "
    "contrast; never cover faces, the main subject, or existing text; keep a small margin from the "
    "edges. If the chosen area is busy or low-contrast for a logo, set scrim true and pick scrim_color "
    "(dark for light logos on bright areas, light for dark logos). Respond with JSON only."
)


def _clamp(v: float, lo: float, hi: float) -> float:
    try:
        return max(lo, min(hi, float(v)))
    except (TypeError, ValueError):
        return lo


def compute_logo_geom(db: Session, base_bytes: bytes) -> dict:
    """Ask the vision model for the best logo placement; fall back to a corner."""
    api_key = providers.resolve_api_key(db, "anthropic")
    if not api_key:
        return dict(DEFAULT_GEOM)
    try:
        img = Image.open(io.BytesIO(base_bytes)).convert("RGB")
        img.thumbnail((640, 640))
        buf = io.BytesIO()
        img.save(buf, format="JPEG", quality=80)
        b64 = base64.b64encode(buf.getvalue()).decode()

        client = anthropic.Anthropic(api_key=api_key, max_retries=2)
        message = client.messages.create(
            model=VISION_MODEL,
            max_tokens=300,
            temperature=0,
            messages=[
                {
                    "role": "user",
                    "content": [
                        {"type": "image", "source": {"type": "base64", "media_type": "image/jpeg", "data": b64}},
                        {"type": "text", "text": _PROMPT},
                    ],
                }
            ],
        )
        text = "".join(b.text for b in message.content if b.type == "text")
        data = json.loads(text[text.find("{") : text.rfind("}") + 1])
        return {
            "x": _clamp(data.get("x", 0.7), 0.0, 0.95),
            "y": _clamp(data.get("y", 0.82), 0.0, 0.95),
            "scale": _clamp(data.get("scale", 0.18), 0.08, 0.32),
            "opacity": 1.0,
            "rotation": 0,
            "visible": True,
            "auto": True,
            "scrim": bool(data.get("scrim", False)),
            "scrim_color": "light" if str(data.get("scrim_color", "dark")) == "light" else "dark",
        }
    except Exception as exc:  # noqa: BLE001 — placement must never break generation
        logger.warning("Logo vision placement failed (%s); using default corner", exc)
        return dict(DEFAULT_GEOM)
