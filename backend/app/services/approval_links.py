"""Signed, expiring tokens for external (no-account) campaign approval links
(Phase 2). A link lets a client preview a campaign and Approve or Request
Changes — nothing else. Same JWT secret as the rest of the app."""
from datetime import datetime, timedelta, timezone

import jwt

from app.core.config import get_settings

_TOKEN_TYPE = "campaign_approval"


def sign_approval_token(campaign_id: str, expires_in_days: int = 14) -> str:
    settings = get_settings()
    now = datetime.now(timezone.utc)
    payload = {
        "sub": campaign_id,
        "type": _TOKEN_TYPE,
        "iat": now,
        "exp": now + timedelta(days=expires_in_days),
    }
    return jwt.encode(payload, settings.jwt_secret, algorithm=settings.jwt_algorithm)


def verify_approval_token(token: str) -> str:
    """Return the campaign_id or raise jwt.PyJWTError (expired/invalid/wrong type)."""
    settings = get_settings()
    payload = jwt.decode(token, settings.jwt_secret, algorithms=[settings.jwt_algorithm])
    if payload.get("type") != _TOKEN_TYPE:
        raise jwt.InvalidTokenError("Not a campaign approval token")
    return payload["sub"]
