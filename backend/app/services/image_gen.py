"""AI image generation via OpenRouter (Gemini image models) — PRD §5.5.4.

The admin curates a list of ImageModel rows; the user picks one at generation time.
OpenRouter's Gemini image models return generated images inline on the chat
completions endpoint when the "image" output modality is requested.
"""
import base64
import logging
import time

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

    if model.provider == "openrouter":
        return _generate_openrouter(model, api_key, f"{full_prompt}\n\nUse a {aspect_ratio} aspect ratio.")
    if model.provider == "openai":
        return _generate_openai(model, api_key, full_prompt, aspect_ratio)
    raise ExtractionError(f"Unsupported image provider: {model.provider}")


def _generate_openrouter(model: ImageModel, api_key: str, full_prompt: str) -> tuple[bytes, str]:
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


# OpenAI image models only accept fixed sizes; map each aspect ratio to the
# closest supported size (gpt-image-1 / dall-e-3 differ on the wide/tall sizes).
_OPENAI_SIZES = {
    "gpt-image": {"square": "1024x1024", "wide": "1536x1024", "tall": "1024x1536"},
    "dall-e": {"square": "1024x1024", "wide": "1792x1024", "tall": "1024x1792"},
}


def _openai_size(model_name: str, aspect_ratio: str) -> str:
    family = "dall-e" if model_name.startswith("dall-e") else "gpt-image"
    try:
        w, h = (float(p) for p in aspect_ratio.split(":"))
    except ValueError:
        w = h = 1
    shape = "square" if w == h else "wide" if w > h else "tall"
    return _OPENAI_SIZES[family][shape]


def _generate_openai(model: ImageModel, api_key: str, prompt: str, aspect_ratio: str) -> tuple[bytes, str]:
    # OpenAI's edge occasionally returns transient 5xx (Cloudflare 520s observed);
    # retry those a couple of times before surfacing an error.
    for attempt in range(3):
        response = httpx.post(
            "https://api.openai.com/v1/images/generations",
            headers={"Authorization": f"Bearer {api_key}"},
            json={
                "model": model.model_name,
                "prompt": prompt,
                "size": _openai_size(model.model_name, aspect_ratio),
                "n": 1,
            },
            timeout=300,
        )
        if response.status_code < 500:
            break
        logger.warning("OpenAI image generation returned %s (attempt %s)", response.status_code, attempt + 1)
        time.sleep(2 * (attempt + 1))
    if response.status_code >= 400:
        raise ExtractionError(f"OpenAI image generation failed ({response.status_code}): {response.text[:300]}")
    try:
        item = response.json()["data"][0]
    except (KeyError, IndexError) as exc:
        raise ExtractionError(f"Unexpected OpenAI image response: {exc}") from exc
    if item.get("b64_json"):
        return base64.b64decode(item["b64_json"]), "image/png"
    if item.get("url"):  # dall-e-3 returns a temporary URL by default
        download = httpx.get(item["url"], timeout=120, follow_redirects=True)
        if download.status_code >= 400:
            raise ExtractionError(f"Could not download the OpenAI image ({download.status_code})")
        return download.content, download.headers.get("content-type", "image/png")
    raise ExtractionError("OpenAI returned no image data.")
