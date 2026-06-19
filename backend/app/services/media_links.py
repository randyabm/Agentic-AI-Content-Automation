"""Signed, expiring public URLs for stored media (SOCIAL_PUBLISHING_PLAN.md Phase 2).

Zernio (and the social platforms) fetch post media by URL, so we expose private
MinIO objects through a backend proxy guarded by a short-lived signed token —
never exposing MinIO directly and never requiring auth on the fetch.
"""
from datetime import datetime, timedelta, timezone

import jwt

from app.core.config import get_settings

_PURPOSE = "media"


def sign_media_token(object_key: str, expires_in: int = 3600) -> str:
    settings = get_settings()
    payload = {
        "k": object_key,
        "purpose": _PURPOSE,
        "exp": datetime.now(timezone.utc) + timedelta(seconds=expires_in),
    }
    return jwt.encode(payload, settings.jwt_secret, algorithm=settings.jwt_algorithm)


def verify_media_token(token: str) -> str:
    """Return the object key encoded in a valid media token, or raise jwt errors."""
    settings = get_settings()
    payload = jwt.decode(token, settings.jwt_secret, algorithms=[settings.jwt_algorithm])
    if payload.get("purpose") != _PURPOSE:
        raise jwt.InvalidTokenError("Not a media token")
    return payload["k"]


def public_media_url(object_key: str, expires_in: int = 3600) -> str:
    token = sign_media_token(object_key, expires_in)
    base = get_settings().public_base_url.rstrip("/")
    return f"{base}/media/public/{token}"
