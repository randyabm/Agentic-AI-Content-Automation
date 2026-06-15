"""Central provider registry: one API key per provider, shared everywhere.

Both LLM functions and image/video models reference a provider by name; this
module maps those per-domain provider strings to a single canonical credential
provider, resolves the stored key, and fetches the list of available models from
each provider's API so the UI can offer a dropdown instead of a free-text model ID.
"""
from __future__ import annotations

import logging
import time
from dataclasses import dataclass

import httpx
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.crypto import decrypt_secret
from app.models.llm import ProviderCredential

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class ProviderInfo:
    key: str          # canonical credential provider
    label: str        # human label for the UI
    kinds: tuple[str, ...]  # which model kinds this provider serves: text | image | video


# The canonical providers an admin can hold a key for.
CANONICAL_PROVIDERS: tuple[ProviderInfo, ...] = (
    ProviderInfo("anthropic", "Anthropic (Claude)", ("text",)),
    ProviderInfo("openai", "OpenAI", ("text", "image", "video")),
    ProviderInfo("openrouter", "OpenRouter", ("text", "image")),
    ProviderInfo("google", "Google (Gemini / Veo)", ("text", "video")),
    ProviderInfo("magnific", "Magnific", ("image", "video")),
    ProviderInfo("fal", "fal.ai", ("video",)),
    ProviderInfo("replicate", "Replicate", ("video",)),
)
_PROVIDER_BY_KEY = {p.key: p for p in CANONICAL_PROVIDERS}

# Per-domain provider string -> canonical credential provider. The same OpenAI
# key powers chat (openai), images (openai gpt-image-1) and Sora video (openai_sora).
_ENTITY_TO_CREDENTIAL = {
    "anthropic": "anthropic",
    "openai": "openai",
    "openai_sora": "openai",
    "openrouter": "openrouter",
    "google": "google",
    "google_veo": "google",
    "magnific": "magnific",
    "fal": "fal",
    "replicate": "replicate",
}


def credential_provider(entity_provider: str) -> str:
    """Normalize a config/model provider string to its canonical credential key."""
    return _ENTITY_TO_CREDENTIAL.get(entity_provider, entity_provider)


def get_credential(db: Session, entity_provider: str) -> ProviderCredential | None:
    return db.scalar(
        select(ProviderCredential).where(
            ProviderCredential.provider == credential_provider(entity_provider)
        )
    )


def resolve_api_key(db: Session, entity_provider: str, own_encrypted: str = "") -> str:
    """Resolve the API key for a provider: the central credential wins; if it has

    no key, fall back to the entity's own encrypted key (back-compat for rows that
    predate central credentials).
    """
    cred = get_credential(db, entity_provider)
    if cred and cred.is_active:
        key = decrypt_secret(cred.api_key_encrypted)
        if key:
            return key
    return decrypt_secret(own_encrypted or "")


# --- Model listing -----------------------------------------------------------

_CACHE: dict[tuple[str, str], tuple[float, list[dict]]] = {}
_CACHE_TTL_S = 600


class ProviderModelsError(Exception):
    pass


def list_models(provider: str, kind: str, api_key: str) -> list[dict]:
    """Return [{id, name}] of models for a canonical provider + kind.

    Best-effort: providers without a usable list endpoint (fal, replicate) return
    an empty list, and the UI falls back to manual model-ID entry. Results are
    cached briefly to stay well under provider rate limits.
    """
    cred_provider = credential_provider(provider)
    cache_key = (cred_provider, kind)
    cached = _CACHE.get(cache_key)
    if cached and time.time() - cached[0] < _CACHE_TTL_S:
        return cached[1]

    fetcher = _FETCHERS.get(cred_provider)
    models = fetcher(kind, api_key) if fetcher else []
    models.sort(key=lambda m: m["id"])
    _CACHE[cache_key] = (time.time(), models)
    return models


def _fetch_anthropic(kind: str, api_key: str) -> list[dict]:
    if kind != "text":
        return []
    r = httpx.get(
        "https://api.anthropic.com/v1/models?limit=100",
        headers={"x-api-key": api_key, "anthropic-version": "2023-06-01"},
        timeout=30,
    )
    _raise_for_status(r, "Anthropic")
    return [{"id": m["id"], "name": m.get("display_name") or m["id"]} for m in r.json().get("data", [])]


def _fetch_openai(kind: str, api_key: str) -> list[dict]:
    r = httpx.get(
        "https://api.openai.com/v1/models",
        headers={"Authorization": f"Bearer {api_key}"},
        timeout=30,
    )
    _raise_for_status(r, "OpenAI")
    ids = [m["id"] for m in r.json().get("data", [])]
    out = []
    for mid in ids:
        low = mid.lower()
        if kind == "image" and ("image" in low or low.startswith("dall-e")):
            out.append(mid)
        elif kind == "video" and "sora" in low:
            out.append(mid)
        elif kind == "text" and (low.startswith(("gpt-", "o1", "o3", "o4", "chatgpt"))) and not any(
            x in low for x in ("image", "audio", "tts", "whisper", "embedding", "moderation", "realtime", "transcribe", "search")
        ):
            out.append(mid)
    return [{"id": m, "name": m} for m in out]


def _fetch_openrouter(kind: str, api_key: str) -> list[dict]:
    r = httpx.get("https://openrouter.ai/api/v1/models", timeout=30)
    _raise_for_status(r, "OpenRouter")
    out = []
    for m in r.json().get("data", []):
        arch = m.get("architecture") or {}
        outputs = arch.get("output_modalities") or []
        if kind == "image" and "image" in outputs:
            out.append({"id": m["id"], "name": m.get("name") or m["id"]})
        elif kind == "text" and ("text" in outputs or not outputs):
            out.append({"id": m["id"], "name": m.get("name") or m["id"]})
    return out


def _fetch_google(kind: str, api_key: str) -> list[dict]:
    r = httpx.get(
        f"https://generativelanguage.googleapis.com/v1beta/models?key={api_key}&pageSize=200",
        timeout=30,
    )
    _raise_for_status(r, "Google")
    out = []
    for m in r.json().get("models", []):
        name = m.get("name", "").removeprefix("models/")
        methods = m.get("supportedGenerationMethods", [])
        low = name.lower()
        if kind == "video" and ("veo" in low or "predictLongRunning" in methods):
            out.append({"id": name, "name": m.get("displayName") or name})
        elif kind == "text" and "generateContent" in methods and "veo" not in low and "image" not in low:
            out.append({"id": name, "name": m.get("displayName") or name})
    return out


def _fetch_magnific(kind: str, api_key: str) -> list[dict]:
    # No "list models" endpoint — return curated static lists.
    if kind == "image":
        # Magnific routes image generation through /v1/ai/mystic; the `model`
        # param selects the style variant.
        return [
            {"id": "realism", "name": "Mystic — Realism"},
            {"id": "fluid", "name": "Mystic — Fluid"},
            {"id": "zen", "name": "Mystic — Zen"},
            {"id": "flexible", "name": "Mystic — Flexible"},
            {"id": "super_real", "name": "Mystic — Super Real"},
            {"id": "editorial_portraits", "name": "Mystic — Editorial Portraits"},
        ]
    if kind == "video":
        # model_name stores the endpoint path fragment used in POST/GET URLs:
        #   POST https://api.magnific.com/v1/ai/{model_name}
        #   GET  https://api.magnific.com/v1/ai/{model_name}/{task_id}
        return [
            {"id": "text-to-video/wan-2-5-t2v-1080p", "name": "WAN 2.5 — 1080p"},
            {"id": "text-to-video/wan-2-5-t2v-720p",  "name": "WAN 2.5 — 720p"},
            {"id": "text-to-video/wan-2-5-t2v-480p",  "name": "WAN 2.5 — 480p"},
            {"id": "video/kling-v3-pro",               "name": "Kling 3 Pro"},
            {"id": "video/kling-v3-std",               "name": "Kling 3 Standard"},
            {"id": "video/kling-v2-6-pro",             "name": "Kling 2.6 Pro"},
            {"id": "video/kling-v2-5-pro",             "name": "Kling 2.5 Pro"},
            {"id": "video/minimax-hailuo-02-1080p",    "name": "MiniMax Hailuo 02 — 1080p"},
            {"id": "video/minimax-hailuo-2-3",         "name": "MiniMax Hailuo 2.3"},
        ]
    return []


# fal.ai and Replicate have no clean "list models I can run" endpoint, so the UI
# falls back to manual model-ID entry for these.
_FETCHERS = {
    "anthropic": _fetch_anthropic,
    "openai": _fetch_openai,
    "openrouter": _fetch_openrouter,
    "google": _fetch_google,
    "magnific": _fetch_magnific,
}


def _raise_for_status(r: httpx.Response, provider: str) -> None:
    if r.status_code >= 400:
        raise ProviderModelsError(f"{provider} model list failed ({r.status_code}): {r.text[:200]}")
