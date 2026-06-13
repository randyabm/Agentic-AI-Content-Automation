"""AI video generation with the provider abstracted behind VideoModel rows.

OpenRouter offers no video models, so each admin-curated VideoModel targets a
dedicated provider:

- google_veo  — Google Veo via the Gemini API (predictLongRunning + operation polling)
- fal         — fal.ai queue API (one key, many models: Kling, Veo, Hunyuan, Wan…)
- replicate   — Replicate predictions API
- openai_sora — OpenAI Sora via the /v1/videos API (create + poll + download content)

All providers are long-running: generate_video() blocks while polling and is meant
to be called from a Celery task, never from a request handler.
"""
import logging
import time

import httpx
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.crypto import decrypt_secret
from app.models.llm import VideoModel
from app.services.extraction import ExtractionError

logger = logging.getLogger(__name__)

POLL_INTERVAL_S = 10
MAX_WAIT_S = 60 * 12  # generous cap; Celery's task time limit is the hard stop


def get_video_model(db: Session, video_model_id: str | None) -> VideoModel:
    model: VideoModel | None = None
    if video_model_id:
        model = db.get(VideoModel, video_model_id)
    if model is None:
        model = db.scalar(select(VideoModel).where(VideoModel.is_default.is_(True), VideoModel.is_active.is_(True)))
    if model is None:
        model = db.scalar(select(VideoModel).where(VideoModel.is_active.is_(True)))
    if model is None:
        raise ExtractionError(
            "No video generation model is configured. An Admin must add one in System Settings."
        )
    return model


def generate_video(
    model: VideoModel,
    prompt: str,
    negative_prompt: str = "",
    aspect_ratio: str = "16:9",
    duration_seconds: int = 8,
) -> tuple[bytes, str]:
    """Generate one video and return (bytes, content_type). Blocking — Celery only."""
    if not prompt.strip():
        raise ExtractionError("The video prompt is empty.")
    api_key = decrypt_secret(model.api_key_encrypted)
    if not api_key:
        raise ExtractionError(
            f"Video model '{model.display_name}' has no API key configured. "
            "An Admin must set it in System Settings."
        )
    duration = min(duration_seconds, model.max_duration_seconds or duration_seconds)

    if model.provider == "google_veo":
        return _generate_google_veo(model, api_key, prompt, negative_prompt, aspect_ratio, duration)
    if model.provider == "fal":
        return _generate_fal(model, api_key, prompt, negative_prompt, aspect_ratio, duration)
    if model.provider == "replicate":
        return _generate_replicate(model, api_key, prompt, negative_prompt, aspect_ratio, duration)
    if model.provider == "openai_sora":
        return _generate_openai_sora(model, api_key, prompt, negative_prompt, aspect_ratio, duration)
    raise ExtractionError(f"Unsupported video provider: {model.provider}")


# --- Google Veo (Gemini API) ---

_GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta"


def _generate_google_veo(
    model: VideoModel, api_key: str, prompt: str, negative: str, aspect: str, duration: int
) -> tuple[bytes, str]:
    headers = {"x-goog-api-key": api_key}
    parameters: dict = {"aspectRatio": aspect if aspect in ("16:9", "9:16") else "16:9"}
    if negative.strip():
        parameters["negativePrompt"] = negative.strip()

    with httpx.Client(timeout=60) as client:
        start = client.post(
            f"{_GEMINI_BASE}/models/{model.model_name}:predictLongRunning",
            headers=headers,
            json={"instances": [{"prompt": prompt}], "parameters": parameters},
        )
        if start.status_code >= 400:
            raise ExtractionError(f"Veo request failed ({start.status_code}): {start.text[:300]}")
        operation = start.json().get("name", "")
        if not operation:
            raise ExtractionError("Veo did not return an operation name.")

        deadline = time.monotonic() + MAX_WAIT_S
        while time.monotonic() < deadline:
            time.sleep(POLL_INTERVAL_S)
            poll = client.get(f"{_GEMINI_BASE}/{operation}", headers=headers)
            if poll.status_code >= 400:
                raise ExtractionError(f"Veo polling failed ({poll.status_code}): {poll.text[:300]}")
            data = poll.json()
            if data.get("error"):
                raise ExtractionError(f"Veo generation failed: {data['error'].get('message', data['error'])}")
            if data.get("done"):
                try:
                    samples = data["response"]["generateVideoResponse"]["generatedSamples"]
                    uri = samples[0]["video"]["uri"]
                except (KeyError, IndexError, TypeError) as exc:
                    raise ExtractionError(f"Unexpected Veo response shape: {exc}") from exc
                video = client.get(uri, headers=headers, follow_redirects=True, timeout=300)
                if video.status_code >= 400:
                    raise ExtractionError(f"Could not download the Veo video ({video.status_code})")
                return video.content, video.headers.get("content-type", "video/mp4")
    raise ExtractionError("Veo generation timed out.")


# --- fal.ai (queue API) ---


def _generate_fal(
    model: VideoModel, api_key: str, prompt: str, negative: str, aspect: str, duration: int
) -> tuple[bytes, str]:
    headers = {"Authorization": f"Key {api_key}"}
    payload: dict = {"prompt": prompt, "aspect_ratio": aspect, "duration": duration}
    if negative.strip():
        payload["negative_prompt"] = negative.strip()

    with httpx.Client(timeout=60) as client:
        start = client.post(f"https://queue.fal.run/{model.model_name}", headers=headers, json=payload)
        if start.status_code >= 400:
            raise ExtractionError(f"fal.ai request failed ({start.status_code}): {start.text[:300]}")
        job = start.json()
        status_url = job.get("status_url")
        response_url = job.get("response_url")
        if not status_url or not response_url:
            raise ExtractionError("fal.ai did not return queue URLs.")

        deadline = time.monotonic() + MAX_WAIT_S
        while time.monotonic() < deadline:
            time.sleep(POLL_INTERVAL_S)
            poll = client.get(status_url, headers=headers)
            if poll.status_code >= 400:
                raise ExtractionError(f"fal.ai polling failed ({poll.status_code}): {poll.text[:300]}")
            state = poll.json().get("status", "")
            if state == "COMPLETED":
                result = client.get(response_url, headers=headers).json()
                url = (result.get("video") or {}).get("url") or result.get("video_url", "")
                if not url:
                    raise ExtractionError(f"fal.ai returned no video URL: {str(result)[:300]}")
                video = client.get(url, follow_redirects=True, timeout=300)
                return video.content, video.headers.get("content-type", "video/mp4")
            if state in ("FAILED", "CANCELLED"):
                raise ExtractionError(f"fal.ai generation {state.lower()}.")
    raise ExtractionError("fal.ai generation timed out.")


# --- OpenAI Sora (/v1/videos API) ---

# Sora accepts fixed sizes (720x1280, 1280x720, 1024x1792, 1792x1024 — no square)
# and durations of 4/8/12 seconds.
def _sora_size(aspect: str) -> str:
    try:
        w, h = (float(p) for p in aspect.split(":"))
    except ValueError:
        w, h = 16, 9
    ratio = w / h if h else 1
    if ratio >= 1.6:   # 16:9 and wider
        return "1280x720"
    if ratio > 1:      # mildly landscape (e.g. 4:3, 1.91:1 handled above)
        return "1792x1024"
    if ratio == 1:     # square not supported; favor landscape
        return "1280x720"
    if ratio > 0.625:  # mildly portrait (e.g. 4:5, 3:4)
        return "1024x1792"
    return "720x1280"  # 9:16 and taller


def _generate_openai_sora(
    model: VideoModel, api_key: str, prompt: str, negative: str, aspect: str, duration: int
) -> tuple[bytes, str]:
    headers = {"Authorization": f"Bearer {api_key}"}
    full_prompt = prompt
    if negative.strip():
        full_prompt += f"\n\nAvoid the following: {negative.strip()}"
    seconds = min((s for s in (4, 8, 12) if s >= duration), default=12)

    with httpx.Client(timeout=60) as client:
        start = client.post(
            "https://api.openai.com/v1/videos",
            headers=headers,
            json={
                "model": model.model_name,
                "prompt": full_prompt,
                "size": _sora_size(aspect),
                "seconds": str(seconds),
            },
        )
        if start.status_code >= 400:
            raise ExtractionError(f"Sora request failed ({start.status_code}): {start.text[:300]}")
        video_id = start.json().get("id", "")
        if not video_id:
            raise ExtractionError("Sora did not return a video id.")

        deadline = time.monotonic() + MAX_WAIT_S
        while time.monotonic() < deadline:
            time.sleep(POLL_INTERVAL_S)
            poll = client.get(f"https://api.openai.com/v1/videos/{video_id}", headers=headers)
            if poll.status_code >= 400:
                raise ExtractionError(f"Sora polling failed ({poll.status_code}): {poll.text[:300]}")
            data = poll.json()
            state = data.get("status", "")
            if state == "completed":
                content = client.get(
                    f"https://api.openai.com/v1/videos/{video_id}/content",
                    headers=headers,
                    follow_redirects=True,
                    timeout=300,
                )
                if content.status_code >= 400:
                    raise ExtractionError(f"Could not download the Sora video ({content.status_code})")
                return content.content, content.headers.get("content-type", "video/mp4")
            if state == "failed":
                err = (data.get("error") or {}).get("message", "unknown error")
                raise ExtractionError(f"Sora generation failed: {err}")
    raise ExtractionError("Sora generation timed out.")


# --- Replicate (predictions API) ---


def _generate_replicate(
    model: VideoModel, api_key: str, prompt: str, negative: str, aspect: str, duration: int
) -> tuple[bytes, str]:
    headers = {"Authorization": f"Bearer {api_key}"}
    input_data: dict = {"prompt": prompt, "aspect_ratio": aspect, "duration": duration}
    if negative.strip():
        input_data["negative_prompt"] = negative.strip()

    with httpx.Client(timeout=60) as client:
        start = client.post(
            f"https://api.replicate.com/v1/models/{model.model_name}/predictions",
            headers=headers,
            json={"input": input_data},
        )
        if start.status_code >= 400:
            raise ExtractionError(f"Replicate request failed ({start.status_code}): {start.text[:300]}")
        prediction = start.json()
        poll_url = (prediction.get("urls") or {}).get("get", "")
        if not poll_url:
            raise ExtractionError("Replicate did not return a polling URL.")

        deadline = time.monotonic() + MAX_WAIT_S
        while time.monotonic() < deadline:
            time.sleep(POLL_INTERVAL_S)
            poll = client.get(poll_url, headers=headers)
            if poll.status_code >= 400:
                raise ExtractionError(f"Replicate polling failed ({poll.status_code}): {poll.text[:300]}")
            data = poll.json()
            state = data.get("status", "")
            if state == "succeeded":
                output = data.get("output")
                url = output[0] if isinstance(output, list) and output else output if isinstance(output, str) else ""
                if not url:
                    raise ExtractionError(f"Replicate returned no video URL: {str(output)[:300]}")
                video = client.get(url, follow_redirects=True, timeout=300)
                return video.content, video.headers.get("content-type", "video/mp4")
            if state in ("failed", "canceled"):
                raise ExtractionError(f"Replicate generation failed: {data.get('error', state)}")
    raise ExtractionError("Replicate generation timed out.")
