"""AI image generation via OpenRouter (Gemini image models) — PRD §5.5.4.

The admin curates a list of ImageModel rows; the user picks one at generation time.
OpenRouter's Gemini image models return generated images inline on the chat
completions endpoint when the "image" output modality is requested.
"""
import base64
import io
import logging
import time

import httpx
from PIL import Image, ImageFilter, ImageOps
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


# Appended to every prompt so the model keeps the main subject and
# critical text in the safe zone across aspect ratios. As of the
# example-image revision the prompt IS the final asset (text rendered
# inside the image), so we allow headlines and CTAs to sit near the
# edges — but the main subject and any feature chips need to survive
# the square/4:5/9:16 re-crop.
_SAFE_MARGINS = (
    "Keep the main subject and any feature chips / footer row inside the "
    "frame with at least 6% margin. Headlines and CTAs may sit near the "
    "edges but their baselines must stay at least 4% inside the frame so "
    "they survive re-cropping to 1:1, 4:5, and 9:16. Avoid clipping "
    "the product mockup or any text."
)


# --- Magnific (Mystic endpoint) ---------------------------------------------

_MAGNIFIC_RATIO_MAP: dict[str, str] = {
    "1:1": "square_1_1",
    "4:3": "classic_4_3",
    "3:4": "traditional_3_4",
    "16:9": "widescreen_16_9",
    "9:16": "social_story_9_16",
    "20:9": "smartphone_horizontal_20_9",
    "9:20": "smartphone_vertical_9_20",
    "3:2": "standard_3_2",
    "2:3": "portrait_2_3",
    "2:1": "horizontal_2_1",
    "1:2": "vertical_1_2",
    "5:4": "social_5_4",
    "4:5": "social_post_4_5",
}

_MAGNIFIC_MODELS = {"realism", "fluid", "zen", "flexible", "super_real", "editorial_portraits"}


def _magnific_ratio(aspect_ratio: str) -> str:
    return _MAGNIFIC_RATIO_MAP.get(aspect_ratio, "square_1_1")


def _magnific_poll(task_id: str, api_key: str, timeout: int = 300) -> str:
    """Poll the Magnific task until COMPLETED. Returns the first generated image URL."""
    poll_url = f"https://api.magnific.com/v1/ai/mystic/{task_id}"
    deadline = time.time() + timeout
    while time.time() < deadline:
        r = httpx.get(poll_url, headers={"x-magnific-api-key": api_key}, timeout=30)
        if r.status_code >= 400:
            raise ExtractionError(f"Magnific poll failed ({r.status_code}): {r.text[:300]}")
        data = r.json().get("data", {})
        status = data.get("status", "")
        if status == "COMPLETED":
            urls = data.get("generated") or []
            if not urls:
                raise ExtractionError("Magnific task completed but returned no images.")
            return urls[0]
        if status == "FAILED":
            raise ExtractionError(f"Magnific generation failed: {data}")
        time.sleep(3)
    raise ExtractionError(f"Magnific task {task_id} timed out after {timeout}s.")


def _generate_magnific(
    model: ImageModel,
    api_key: str,
    prompt: str,
    aspect_ratio: str,
    structure_bytes: bytes | None = None,
    style_bytes: bytes | None = None,
) -> tuple[bytes, str]:
    magnific_model = model.model_name if model.model_name in _MAGNIFIC_MODELS else "realism"
    body: dict = {
        "prompt": prompt,
        "aspect_ratio": _magnific_ratio(aspect_ratio),
        "model": magnific_model,
    }
    if structure_bytes:
        body["structure_reference"] = base64.b64encode(structure_bytes).decode()
        body["structure_strength"] = 50
    if style_bytes:
        body["style_reference"] = base64.b64encode(style_bytes).decode()

    r = httpx.post(
        "https://api.magnific.com/v1/ai/mystic",
        headers={"x-magnific-api-key": api_key},
        json=body,
        timeout=60,
    )
    if r.status_code >= 400:
        raise ExtractionError(f"Magnific generation failed ({r.status_code}): {r.text[:300]}")
    data = r.json().get("data", {})
    task_id = data.get("task_id")
    if not task_id:
        raise ExtractionError(f"Magnific returned no task_id: {r.text[:200]}")

    # The task may already be done in the POST response.
    urls = data.get("generated") or []
    image_url = urls[0] if data.get("status") == "COMPLETED" and urls else _magnific_poll(task_id, api_key)

    dl = httpx.get(image_url, timeout=120, follow_redirects=True)
    if dl.status_code >= 400:
        raise ExtractionError(f"Could not download Magnific image ({dl.status_code})")
    return dl.content, dl.headers.get("content-type", "image/jpeg")


def generate_image(
    db: Session,
    model: ImageModel,
    prompt: str,
    negative_prompt: str = "",
    aspect_ratio: str = "1:1",
    reference_bytes: list[bytes] | None = None,
    logo_bytes: bytes | None = None,
) -> tuple[bytes, str]:
    """Generate one image and return (bytes, content_type).

    reference_bytes (e.g. product photos) steer the subject; logo_bytes makes the
    model render the brand logo directly into the image. When either is present the
    provider's image-to-image path is used; otherwise plain text-to-image.
    """
    if not prompt.strip():
        raise ExtractionError("The image prompt is empty.")
    from app.services import providers

    api_key = providers.resolve_api_key(db, model.provider, model.api_key_encrypted)
    if not api_key:
        raise ExtractionError(
            f"No API key configured for provider '{model.provider}'. "
            "An Admin must set it under Providers & Keys in System Settings."
        )

    full_prompt = prompt.strip()
    if negative_prompt.strip():
        full_prompt += f"\n\nAvoid the following: {negative_prompt.strip()}"
    full_prompt += f"\n\n{_SAFE_MARGINS}"

    refs = [b for b in (reference_bytes or []) if b]
    # Input images: product references first, the logo last so the instruction can
    # refer to "the last attached image" as the logo.
    inputs = list(refs)
    if logo_bytes:
        inputs.append(logo_bytes)

    if inputs:
        parts = [full_prompt]
        if refs:
            parts.append(
                "Use the attached product reference image(s) to match the real subject's appearance, "
                "branding and colours."
            )
        if logo_bytes:
            parts.append(
                "The LAST attached image is the company's brand logo. Render that exact logo into the "
                "image — small, crisp and clearly legible — in a tasteful, uncluttered corner, preserving "
                "its real shape and colours without distorting, recolouring or restyling it."
            )
        parts.append(f"Create a NEW campaign image with a {aspect_ratio} aspect ratio.")
        ref_prompt = "\n\n".join(parts)
        if model.provider == "openrouter":
            return _generate_openrouter(model, api_key, ref_prompt, inputs)
        if model.provider == "openai":
            return _generate_openai_with_refs(model, api_key, ref_prompt, aspect_ratio, inputs)
        if model.provider == "magnific":
            # structure_reference = first product ref; style_reference = logo if no product ref
            structure = refs[0] if refs else None
            style = logo_bytes if not refs and logo_bytes else None
            return _generate_magnific(model, api_key, ref_prompt, aspect_ratio, structure, style)
        raise ExtractionError(f"Unsupported image provider: {model.provider}")

    if model.provider == "openrouter":
        return _generate_openrouter(model, api_key, f"{full_prompt}\n\nUse a {aspect_ratio} aspect ratio.")
    if model.provider == "openai":
        return _generate_openai(model, api_key, full_prompt, aspect_ratio)
    if model.provider == "magnific":
        return _generate_magnific(model, api_key, full_prompt, aspect_ratio)
    raise ExtractionError(f"Unsupported image provider: {model.provider}")


# --- Reframe an existing image to another aspect ratio (image-to-image) --------
#
# Used to derive a campaign element's other ratios from one generated base image
# so every platform shares the same visual. AI outpainting keeps the subject and
# extends the background; reframe_local is the offline fallback (centre crop).


def _ratio_value(aspect_ratio: str) -> float:
    try:
        w, h = (float(p) for p in aspect_ratio.split(":"))
        return w / h if h else 1.0
    except ValueError:
        return 1.0


def reframe_local(source_bytes: bytes, aspect_ratio: str) -> tuple[bytes, str]:
    """Re-fit the source to the target ratio WITHOUT cropping: the whole original is

    kept centred at full size, and the extra space is filled with a blurred,
    zoomed copy of the same image (so the extension blends in instead of leaving
    hard bars). No AI, never fails — used as the fallback for AI outpainting.
    """
    img = Image.open(io.BytesIO(source_bytes)).convert("RGB")
    w, h = img.size
    target = _ratio_value(aspect_ratio)
    if w / h > target:  # need a taller canvas → extend top/bottom
        cw, ch = w, max(h + 1, int(round(w / target)))
    else:  # need a wider canvas → extend the sides
        cw, ch = max(w + 1, int(round(h * target))), h
    # Blurred cover-fit background so the added area looks like a continuation.
    background = ImageOps.fit(img, (cw, ch), method=Image.LANCZOS).filter(ImageFilter.GaussianBlur(28))
    canvas = background.copy()
    canvas.paste(img, ((cw - w) // 2, (ch - h) // 2))
    out = io.BytesIO()
    canvas.save(out, format="PNG")
    return out.getvalue(), "image/png"


def generate_image_from(
    db: Session,
    model: ImageModel,
    source_bytes: bytes,
    prompt: str,
    negative_prompt: str,
    aspect_ratio: str,
) -> tuple[bytes, str]:
    """Reframe an existing image to a new aspect ratio via the provider's
    image-to-image capability. Raises on failure so the caller can fall back to
    reframe_local()."""
    from app.services import providers

    api_key = providers.resolve_api_key(db, model.provider, model.api_key_encrypted)
    if not api_key:
        raise ExtractionError(f"No API key configured for provider '{model.provider}'.")
    extra = prompt.strip() or "Keep the same subject, style and composition."
    if negative_prompt.strip():
        extra += f"\n\nAvoid: {negative_prompt.strip()}"
    instruction = (
        f"Take this exact image and change ONLY its aspect ratio to {aspect_ratio}. Do not crop, "
        f"cut, zoom or remove any part of the original — keep every existing element fully visible. "
        f"Only add new canvas by extending the background and scenery naturally (outpainting) to fill "
        f"the new shape. Keep the same subject, characters, text, colours and art style identical. {extra}"
    )
    if model.provider == "openrouter":
        return _reframe_openrouter(model, api_key, source_bytes, instruction)
    if model.provider == "openai":
        return _reframe_openai(model, api_key, source_bytes, instruction, aspect_ratio)
    if model.provider == "magnific":
        return _generate_magnific(model, api_key, instruction, aspect_ratio, structure_bytes=source_bytes)
    raise ExtractionError(f"Provider '{model.provider}' does not support image reframing.")


def _reframe_openrouter(model: ImageModel, api_key: str, source_bytes: bytes, instruction: str) -> tuple[bytes, str]:
    data_url = "data:image/png;base64," + base64.b64encode(source_bytes).decode()
    response = httpx.post(
        "https://openrouter.ai/api/v1/chat/completions",
        headers={"Authorization": f"Bearer {api_key}"},
        json={
            "model": model.model_name,
            "modalities": ["image", "text"],
            "messages": [
                {
                    "role": "user",
                    "content": [
                        {"type": "text", "text": instruction},
                        {"type": "image_url", "image_url": {"url": data_url}},
                    ],
                }
            ],
        },
        timeout=180,
    )
    if response.status_code >= 400:
        raise ExtractionError(f"Image reframing failed ({response.status_code}): {response.text[:300]}")
    try:
        images = response.json()["choices"][0]["message"].get("images") or []
        if not images:
            raise ExtractionError("The image model returned no reframed image.")
        return _data_url_to_bytes(images[0]["image_url"]["url"])
    except (KeyError, IndexError, TypeError) as exc:
        raise ExtractionError(f"Unexpected reframe response: {exc}") from exc


def _reframe_openai(model: ImageModel, api_key: str, source_bytes: bytes, instruction: str, aspect_ratio: str) -> tuple[bytes, str]:
    response = _openai_image_post(
        "https://api.openai.com/v1/images/edits",
        api_key,
        data={"model": model.model_name, "prompt": instruction, "size": _openai_size(model.model_name, aspect_ratio), "n": "1"},
        files={"image": ("source.png", source_bytes, "image/png")},
    )
    if response.status_code >= 400:
        raise ExtractionError(f"OpenAI image reframing failed ({response.status_code}): {response.text[:300]}")
    try:
        item = response.json()["data"][0]
    except (KeyError, IndexError) as exc:
        raise ExtractionError(f"Unexpected OpenAI reframe response: {exc}") from exc
    if item.get("b64_json"):
        return base64.b64decode(item["b64_json"]), "image/png"
    raise ExtractionError("OpenAI returned no reframed image data.")


def _generate_openrouter(
    model: ImageModel, api_key: str, full_prompt: str, refs: list[bytes] | None = None
) -> tuple[bytes, str]:
    if refs:
        content: list = [{"type": "text", "text": full_prompt}]
        for rb in refs:
            url = "data:image/png;base64," + base64.b64encode(rb).decode()
            content.append({"type": "image_url", "image_url": {"url": url}})
    else:
        content = full_prompt
    response = httpx.post(
        "https://openrouter.ai/api/v1/chat/completions",
        headers={"Authorization": f"Bearer {api_key}"},
        json={
            "model": model.model_name,
            "modalities": ["image", "text"],
            "messages": [{"role": "user", "content": content}],
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


def _openai_image_post(url: str, api_key: str, *, json: dict | None = None, data: dict | None = None, files=None, attempts: int = 6):
    """POST to an OpenAI image endpoint, retrying transient 5xx (the /images/edits

    endpoint returns Cloudflare 520s intermittently). Retries with backoff and
    returns the final response for the caller to inspect.
    """
    response = None
    for attempt in range(attempts):
        response = httpx.post(
            url, headers={"Authorization": f"Bearer {api_key}"}, json=json, data=data, files=files, timeout=300
        )
        if response.status_code < 500:
            return response
        logger.warning("OpenAI image endpoint returned %s (attempt %d/%d)", response.status_code, attempt + 1, attempts)
        time.sleep(min(2 * (attempt + 1), 12))
    return response


def _generate_openai(model: ImageModel, api_key: str, prompt: str, aspect_ratio: str) -> tuple[bytes, str]:
    response = _openai_image_post(
        "https://api.openai.com/v1/images/generations",
        api_key,
        json={
            "model": model.model_name,
            "prompt": prompt,
            "size": _openai_size(model.model_name, aspect_ratio),
            "n": 1,
        },
    )
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


def _generate_openai_with_refs(
    model: ImageModel, api_key: str, prompt: str, aspect_ratio: str, refs: list[bytes]
) -> tuple[bytes, str]:
    # gpt-image-1's edits endpoint accepts multiple input images as reference.
    files = [("image[]", (f"ref{i}.png", rb, "image/png")) for i, rb in enumerate(refs)]
    response = _openai_image_post(
        "https://api.openai.com/v1/images/edits",
        api_key,
        data={"model": model.model_name, "prompt": prompt, "size": _openai_size(model.model_name, aspect_ratio), "n": "1"},
        files=files,
    )
    if response.status_code >= 400:
        raise ExtractionError(f"OpenAI reference generation failed ({response.status_code}): {response.text[:300]}")
    try:
        item = response.json()["data"][0]
    except (KeyError, IndexError) as exc:
        raise ExtractionError(f"Unexpected OpenAI image response: {exc}") from exc
    if item.get("b64_json"):
        return base64.b64decode(item["b64_json"]), "image/png"
    raise ExtractionError("OpenAI returned no image data.")
