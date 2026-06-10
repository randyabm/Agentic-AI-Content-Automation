"""AI image generation via OpenRouter (Gemini image models) — PRD §5.5.4.

The admin curates a list of ImageModel rows; the user picks one at generation time.
OpenRouter's Gemini image models return generated images inline on the chat
completions endpoint when the "image" output modality is requested.
"""
import base64
import logging

import httpx
from sqlalchemy.orm import Session

from app.core.crypto import decrypt_secret
from app.models.llm import ImageModel
from app.services.extraction import ExtractionError

logger = logging.getLogger(__name__)


def get_image_model(db: Session, image_model_id: str | None) -> ImageModel:
    model: ImageModel | None = None
    if image_model_id:
        model = db.get(ImageModel, image_model_id)
    if model is None:
        from sqlalchemy import select

        model = db.scalar(select(ImageModel).where(ImageModel.is_default.is_(True), ImageModel.is_active.is_(True)))
    if model is None:
        from sqlalchemy import select

        model = db.scalar(select(ImageModel).where(ImageModel.is_active.is_(True)))
    if model is None:
        raise ExtractionError("No image generation model is configured. An Admin must add one.")
    return model


def _data_url_to_bytes(data_url: str) -> tuple[bytes, str]:
    # data:image/png;base64,XXXX
    header, _, payload = data_url.partition(",")
    content_type = "image/png"
    if header.startswith("data:") and ";" in header:
        content_type = header[5:].split(";", 1)[0] or content_type
    return base64.b64decode(payload), content_type


def generate_image(
    db: Session, model: ImageModel, prompt: str, negative_prompt: str = "", aspect_ratio: str = "1:1"
) -> tuple[bytes, str]:
    """Generate one image and return (bytes, content_type)."""
    if not prompt.strip():
        raise ExtractionError("The image prompt is empty.")
    api_key = decrypt_secret(model.api_key_encrypted)
    if not api_key:
        raise ExtractionError(f"Image model '{model.display_name}' has no API key configured.")

    full_prompt = prompt.strip()
    if negative_prompt.strip():
        full_prompt += f"\n\nAvoid the following: {negative_prompt.strip()}"
    full_prompt += f"\n\nUse a {aspect_ratio} aspect ratio."

    if model.provider != "openrouter":
        raise ExtractionError(f"Unsupported image provider: {model.provider}")

    response = httpx.post(
        "https://openrouter.ai/api/v1/chat/completions",
        headers={"Authorization": f"Bearer {api_key}"},
        json={
            "model": model.model_name,
            "modalities": ["image", "text"],
            "messages": [{"role": "user", "content": full_prompt}],
        },
        timeout=180,
    )
    if response.status_code >= 400:
        raise ExtractionError(f"Image generation failed ({response.status_code}): {response.text[:300]}")
    data = response.json()
    try:
        message = data["choices"][0]["message"]
        images = message.get("images") or []
        if not images:
            raise ExtractionError("The image model returned no image. Try a different prompt or model.")
        url = images[0]["image_url"]["url"]
    except (KeyError, IndexError, TypeError) as exc:
        raise ExtractionError(f"Unexpected image model response: {exc}") from exc
    return _data_url_to_bytes(url)
