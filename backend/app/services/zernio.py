"""Zernio social-publishing client (SOCIAL_PUBLISHING_PLAN.md Phase 1).

Zernio is the OAuth/token middleman + publisher. One app-wide API key (managed by
the platform admin) lets every org connect its clients' social accounts and
publish through Zernio. The key is stored encrypted in a ProviderCredential row
(provider='zernio'). Validated endpoints — see the zernio-api-reference memo:
  GET  /profiles            POST /profiles
  GET  /accounts            GET  /connect/{platform}?profileId=...
  POST /posts               GET  /posts/{id}
"""
from __future__ import annotations

import logging
from datetime import datetime

import httpx
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.crypto import decrypt_secret, encrypt_secret
from app.models.llm import ProviderCredential

logger = logging.getLogger(__name__)

PROVIDER = "zernio"


class ZernioError(Exception):
    """Raised on any Zernio configuration or API failure (surfaced to the caller)."""


# --- key storage (encrypted, platform-admin managed) -------------------------


def get_api_key(db: Session) -> str:
    cred = db.scalar(select(ProviderCredential).where(ProviderCredential.provider == PROVIDER))
    return decrypt_secret(cred.api_key_encrypted) if cred else ""


def set_api_key(db: Session, key: str) -> None:
    cred = db.scalar(select(ProviderCredential).where(ProviderCredential.provider == PROVIDER))
    if cred is None:
        cred = ProviderCredential(provider=PROVIDER, label="Zernio")
        db.add(cred)
    cred.api_key_encrypted = encrypt_secret(key or "")
    db.commit()


def is_configured(db: Session) -> bool:
    return bool(get_api_key(db))


# --- low-level request -------------------------------------------------------


def _request(db: Session, method: str, path: str, **kwargs) -> dict:
    key = get_api_key(db)
    if not key:
        raise ZernioError("Zernio is not configured. Add the API key under System Settings.")
    url = f"{get_settings().zernio_api_url.rstrip('/')}{path}"
    headers = {"Authorization": f"Bearer {key}", "Content-Type": "application/json"}
    try:
        r = httpx.request(method, url, headers=headers, timeout=30, **kwargs)
    except httpx.HTTPError as exc:
        raise ZernioError(f"Could not reach Zernio: {exc}") from exc
    if r.status_code >= 400:
        raise ZernioError(f"Zernio API error {r.status_code}: {r.text[:300]}")
    return r.json() if r.content else {}


# --- profiles (≈ our clients) ------------------------------------------------


def list_profiles(db: Session) -> list[dict]:
    return _request(db, "GET", "/profiles").get("profiles", [])


def ensure_profile(db: Session, client) -> str:
    """Return the client's Zernio profile id, creating the profile on first use."""
    if client.zernio_profile_id:
        return client.zernio_profile_id
    data = _request(db, "POST", "/profiles", json={"name": client.company_name or "Client"})
    profile = data.get("profile") or data
    pid = profile.get("_id") or profile.get("id")
    if not pid:
        raise ZernioError("Zernio did not return a profile id")
    client.zernio_profile_id = pid
    db.commit()
    return pid


# --- accounts (≈ connected channels) -----------------------------------------


def _profile_id_of(account: dict) -> str:
    pid = account.get("profileId")
    if isinstance(pid, dict):
        return pid.get("_id", "")
    return pid or ""


def list_accounts(db: Session, profile_id: str | None = None) -> list[dict]:
    accounts = _request(db, "GET", "/accounts").get("accounts", [])
    if profile_id:
        accounts = [a for a in accounts if _profile_id_of(a) == profile_id]
    return accounts


def connect_url(db: Session, profile_id: str, platform: str) -> str:
    data = _request(db, "GET", f"/connect/{platform}", params={"profileId": profile_id})
    url = data.get("url") or data.get("authUrl") or data.get("connectUrl") or data.get("link")
    if not url:
        raise ZernioError(f"Zernio did not return a connect URL for {platform}")
    return url


def summarize_account(account: dict) -> dict:
    """Normalize a Zernio account into the fields we mirror on SocialAccount."""
    meta = account.get("metadata") or {}
    username = (
        meta.get("selectedPageUsername")
        or (meta.get("userProfile") or {}).get("username")
        or account.get("username")
        or ""
    )
    healthy = (
        account.get("isActive", True)
        and account.get("enabled", True)
        and account.get("platformStatus", "active") == "active"
    )
    return {
        "zernio_account_id": account.get("_id", ""),
        "platform": account.get("platform", ""),
        "display_name": account.get("displayName", "") or "",
        "username": username,
        "avatar_url": account.get("profilePicture", "") or "",
        "status": "connected" if healthy else "error",
        "token_expires_at": _parse_dt(account.get("tokenExpiresAt")),
    }


def _parse_dt(value) -> datetime | None:
    if not value:
        return None
    try:
        return datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except ValueError:
        return None


# --- posts -------------------------------------------------------------------


def create_post(db: Session, payload: dict) -> dict:
    """Create (and optionally publish/schedule) a post. Returns the `post` object."""
    data = _request(db, "POST", "/posts", json=payload)
    return data.get("post") or data


def get_post(db: Session, post_id: str) -> dict:
    data = _request(db, "GET", f"/posts/{post_id}")
    return data.get("post") or data
