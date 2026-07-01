"""Direct social publishing service.

Used when social_publishing_mode = 'direct'. Handles per-platform OAuth URL
generation, authorization code exchange, token refresh, and publishing.

App-level OAuth credentials (App ID / Consumer Key / Client ID + their secrets)
are stored encrypted in ProviderCredential rows:
  provider='oauth_facebook'  → Facebook Pages (Meta Graph API)
  provider='oauth_instagram' → Instagram (standalone Instagram API)
  provider='oauth_twitter'   → Twitter / X
  provider='oauth_linkedin'  → LinkedIn

Per-user tokens are stored encrypted on SocialAccount rows:
  access_token_encrypted, refresh_token_encrypted, platform_account_id, …
"""
from __future__ import annotations

import base64
import hashlib
import json
import logging
import secrets
import time
from datetime import datetime, timedelta, timezone
from urllib.parse import urlencode

import httpx
import jwt
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.crypto import decrypt_secret, encrypt_secret, mask_secret
from app.models.llm import ProviderCredential
from app.models.setting import Setting
from app.models.social import ChannelStatus, SocialAccount

logger = logging.getLogger(__name__)

FACEBOOK_GRAPH = "https://graph.facebook.com/v19.0"
INSTAGRAM_API = "https://api.instagram.com"
INSTAGRAM_GRAPH = "https://graph.instagram.com/v21.0"
TWITTER_AUTH = "https://x.com"         # OAuth 2.0 authorization page (x.com = active session domain)
TWITTER_API = "https://api.x.com"      # REST API v2 (rebranded domain)
LINKEDIN_API = "https://api.linkedin.com"

_PLATFORM_PROVIDER: dict[str, str] = {
    "facebook": "oauth_facebook",
    "instagram": "oauth_instagram",
    "twitter": "oauth_twitter",
    "x": "oauth_twitter",
    "linkedin": "oauth_linkedin",
}

_PLATFORM_LABELS: dict[str, str] = {
    "oauth_facebook": "Facebook",
    "oauth_instagram": "Instagram",
    "oauth_twitter": "Twitter / X",
    "oauth_linkedin": "LinkedIn",
}

# Platforms exposed in the UI for direct mode (not all CONNECTABLE)
DIRECT_PLATFORMS = ["facebook", "instagram", "twitter", "linkedin"]


class DirectSocialError(Exception):
    """Raised by the direct platform API clients (Facebook, Instagram, X, LinkedIn).

    `code` is a short taxonomy used by the publishing layer to decide whether
    to retry, mark the account expired, or fail immediately:
        - "rate_limited"  — 429 / Retry-After / Graph code 4/17/32/613
        - "auth_expired"  — Graph code 190/102/463/467, 401
        - "spam_blocked"  — Graph code 368, subcodes of temporary block
        - "transient"     — 5xx, timeouts, IG container processing errors
        - "permanent"     — 4xx other than the above (invalid content)
        - "duplicate"     — raised before sending when the content_hash already
                            exists for the target account in the last 24h
    The default is "permanent" — anything we don't recognise is treated as
    non-retryable to avoid wasting API quota.
    """

    DEFAULT_CODE = "permanent"

    def __init__(self, message: str, code: str = "permanent", retry_after: int | None = None):
        super().__init__(message)
        self.code = code
        # When the platform sends a Retry-After hint (seconds), record it so
        # the publishing layer can use it instead of the default backoff.
        self.retry_after = retry_after


# ---------------------------------------------------------------------------
# Settings helpers
# ---------------------------------------------------------------------------

def _get_setting(db: Session, key: str, default: str = "") -> str:
    s = db.get(Setting, key)
    return s.value if s else default


def get_app_public_url(db: Session) -> str:
    return _get_setting(db, "app_public_url", get_settings().public_base_url).rstrip("/")


def get_app_frontend_url(db: Session) -> str:
    fallback = get_settings().public_base_url.replace(":8000", ":5173")
    return _get_setting(db, "app_frontend_url", fallback).rstrip("/")


def get_publishing_mode(db: Session) -> str:
    return _get_setting(db, "social_publishing_mode", "zernio")


# Platforms that can be "connected" in mock mode (for dev / preview).
# X is included as an alias of twitter.
MOCK_PLATFORMS = {"facebook", "instagram", "twitter", "x", "linkedin"}


def is_mock_mode(db: Session) -> bool:
    """True when the active publishing mode is the simulator (`mock`)."""
    return get_publishing_mode(db) == "mock"


def mock_channel_payload(platform: str, client_id: str) -> dict:
    """Build a SocialAccount-shaped dict for a fake channel in mock mode.

    No real OAuth, no real tokens — `_dispatch_mock` never reads the token
    anyway. The display name includes the client id suffix so the UI can
    tell mocked channels apart from real ones.
    """
    platform = "twitter" if platform == "x" else platform
    label = f"Mock {platform.title()} (dev)"
    return {
        "platform": platform,
        "platform_account_id": f"mock_{platform}_{client_id[:8]}",
        "display_name": label,
        "username": f"mock_{platform}",
        "avatar_url": "",
        "access_token": "mock-token",
        "access_token_secret": "",
        "refresh_token": "",
        "token_expires_at": None,
    }


def get_facebook_oauth_scopes(db: Session) -> str:
    return _get_setting(db, "facebook_oauth_scopes", "pages_manage_posts,pages_read_engagement,pages_show_list")


def get_instagram_oauth_url(db: Session) -> str:
    return _get_setting(db, "instagram_oauth_url", "https://api.instagram.com/oauth/authorize")


def get_instagram_oauth_scopes(db: Session) -> str:
    return _get_setting(db, "instagram_oauth_scopes", "instagram_business_basic,instagram_business_content_publish")


# ---------------------------------------------------------------------------
# OAuth app credentials (platform-admin managed, encrypted)
# ---------------------------------------------------------------------------

def _get_cred(db: Session, platform: str) -> ProviderCredential | None:
    provider = _PLATFORM_PROVIDER.get(platform.lower())
    if not provider:
        return None
    return db.scalar(select(ProviderCredential).where(ProviderCredential.provider == provider))


def get_oauth_app(db: Session, platform: str) -> tuple[str, str]:
    """Return (app_id, app_secret). Raises DirectSocialError if not configured."""
    cred = _get_cred(db, platform)
    if not cred:
        raise DirectSocialError(
            f"OAuth app not configured for {platform}. Set credentials in System Settings → Integrations."
        )
    app_id = decrypt_secret(cred.api_key_encrypted or "")
    app_secret = decrypt_secret(cred.api_secret_encrypted or "")
    if not app_id or not app_secret:
        raise DirectSocialError(
            f"Incomplete OAuth credentials for {platform}. Set both App ID and App Secret."
        )
    return app_id, app_secret


def set_oauth_app(db: Session, platform: str, app_id: str, app_secret: str) -> None:
    provider = _PLATFORM_PROVIDER.get(platform.lower())
    if not provider:
        raise DirectSocialError(f"Unknown platform: {platform}")
    cred = db.scalar(select(ProviderCredential).where(ProviderCredential.provider == provider))
    if cred is None:
        cred = ProviderCredential(provider=provider, label=_PLATFORM_LABELS.get(provider, provider))
        db.add(cred)
    cred.api_key_encrypted = encrypt_secret(app_id or "")
    cred.api_secret_encrypted = encrypt_secret(app_secret or "")
    db.commit()


def list_oauth_apps(db: Session) -> list[dict]:
    """Return configured OAuth apps status list for the Integrations UI."""
    seen: set[str] = set()
    result = []
    for platform_key in ("oauth_facebook", "oauth_instagram", "oauth_twitter", "oauth_linkedin"):
        if platform_key in seen:
            continue
        seen.add(platform_key)
        cred = db.scalar(select(ProviderCredential).where(ProviderCredential.provider == platform_key))
        app_id = decrypt_secret(cred.api_key_encrypted) if cred else ""
        app_secret = decrypt_secret(cred.api_secret_encrypted) if cred else ""
        result.append({
            "provider": platform_key,
            "label": _PLATFORM_LABELS.get(platform_key, platform_key),
            "has_app_id": bool(app_id),
            "has_app_secret": bool(app_secret),
            "app_id_hint": mask_secret(app_id),
        })
    return result


# ---------------------------------------------------------------------------
# State JWT (carries client/user context through the OAuth round-trip)
# ---------------------------------------------------------------------------

_STATE_EXPIRE_MINUTES = 30


def generate_state(client_id: str, user_id: str, platform: str, extra: dict | None = None) -> str:
    payload: dict = {
        "client_id": client_id,
        "user_id": user_id,
        "platform": platform,
        "exp": datetime.now(timezone.utc) + timedelta(minutes=_STATE_EXPIRE_MINUTES),
    }
    if extra:
        payload.update(extra)
    return jwt.encode(payload, get_settings().jwt_secret, algorithm="HS256")


def verify_state(state: str) -> dict:
    try:
        return jwt.decode(state, get_settings().jwt_secret, algorithms=["HS256"])
    except jwt.ExpiredSignatureError:
        raise DirectSocialError("OAuth state expired. Please start the connection again.")
    except jwt.InvalidTokenError as exc:
        raise DirectSocialError(f"Invalid OAuth state: {exc}")


# ---------------------------------------------------------------------------
# OAuth URL generation
# ---------------------------------------------------------------------------

def _redirect_uri(db: Session, platform: str) -> str:
    # app_public_url already includes /api (e.g. https://host/api), so we just append /auth/...
    return f"{get_app_public_url(db)}/auth/{platform}/callback"


def get_connect_url(db: Session, platform: str, client_id: str, user_id: str) -> str:
    """Return the OAuth authorization URL for the given platform."""
    p = platform.lower()

    if p == "facebook":
        app_id, _ = get_oauth_app(db, "facebook")
        state = generate_state(client_id, user_id, p)
        params = {
            "client_id": app_id,
            "redirect_uri": _redirect_uri(db, "facebook"),
            "scope": get_facebook_oauth_scopes(db),
            "state": state,
            "response_type": "code",
        }
        return f"https://www.facebook.com/v19.0/dialog/oauth?{urlencode(params)}"

    if p == "instagram":
        app_id, _ = get_oauth_app(db, "instagram")
        state = generate_state(client_id, user_id, p)
        params = {
            "client_id": app_id,
            "redirect_uri": _redirect_uri(db, "instagram"),
            "scope": get_instagram_oauth_scopes(db),
            "state": state,
            "response_type": "code",
        }
        return f"{get_instagram_oauth_url(db)}?{urlencode(params)}"

    if p in ("twitter", "x"):
        app_id, _ = get_oauth_app(db, "twitter")
        verifier, challenge = _pkce()
        state = generate_state(client_id, user_id, p, {"pkce_verifier": verifier})
        params = {
            "response_type": "code",
            "client_id": app_id,
            "redirect_uri": _redirect_uri(db, "twitter"),
            "scope": "tweet.read tweet.write users.read offline.access",
            "state": state,
            "code_challenge": challenge,
            "code_challenge_method": "S256",
        }
        return f"{TWITTER_AUTH}/i/oauth2/authorize?{urlencode(params)}"

    if p == "linkedin":
        app_id, _ = get_oauth_app(db, "linkedin")
        state = generate_state(client_id, user_id, p)
        params = {
            "response_type": "code",
            "client_id": app_id,
            "redirect_uri": _redirect_uri(db, "linkedin"),
            "scope": "r_liteprofile w_member_social",
            "state": state,
        }
        return f"https://www.linkedin.com/oauth/v2/authorization?{urlencode(params)}"

    raise DirectSocialError(f"Platform not supported for direct publishing: {platform}")


def _pkce() -> tuple[str, str]:
    verifier = base64.urlsafe_b64encode(secrets.token_bytes(32)).rstrip(b"=").decode()
    challenge = base64.urlsafe_b64encode(
        hashlib.sha256(verifier.encode()).digest()
    ).rstrip(b"=").decode()
    return verifier, challenge


# ---------------------------------------------------------------------------
# Token exchange (called by the OAuth callback handler)
# ---------------------------------------------------------------------------

def exchange_code(db: Session, platform: str, code: str, state_payload: dict) -> list[dict]:
    """Exchange the OAuth authorization code for tokens. Returns a list of account
    dicts (one per connected account)."""
    p = platform.lower()
    if p == "facebook":
        return _exchange_facebook(db, code, p)
    if p == "instagram":
        return _exchange_instagram(db, code)
    if p in ("twitter", "x"):
        verifier = state_payload.get("pkce_verifier", "")
        return _exchange_twitter(db, code, verifier)
    if p == "linkedin":
        return _exchange_linkedin(db, code)
    raise DirectSocialError(f"Unsupported platform for token exchange: {platform}")


def _exchange_facebook(db: Session, code: str, platform: str = "facebook") -> list[dict]:
    """Exchange OAuth code for Facebook Page tokens."""
    app_id, app_secret = get_oauth_app(db, "facebook")
    redirect = _redirect_uri(db, platform)

    # 1. Short-lived token
    r = httpx.get(f"{FACEBOOK_GRAPH}/oauth/access_token", params={
        "client_id": app_id, "client_secret": app_secret,
        "redirect_uri": redirect, "code": code,
    }, timeout=30)
    _raise_for(r, "Meta token exchange")
    short_token = r.json()["access_token"]

    # 2. Long-lived token (60 days)
    r = httpx.get(f"{FACEBOOK_GRAPH}/oauth/access_token", params={
        "grant_type": "fb_exchange_token",
        "client_id": app_id, "client_secret": app_secret,
        "fb_exchange_token": short_token,
    }, timeout=30)
    _raise_for(r, "Meta long-lived token")
    data = r.json()
    long_token = data["access_token"]
    expires_at = datetime.now(timezone.utc) + timedelta(seconds=data.get("expires_in", 5_184_000))

    # 3. List managed pages
    r = httpx.get(f"{FACEBOOK_GRAPH}/me/accounts", params={
        "fields": "id,name,access_token,picture{url}",
        "access_token": long_token,
    }, timeout=30)
    _raise_for(r, "Meta pages list")
    pages = r.json().get("data", [])

    accounts: list[dict] = []
    for page in pages:
        page_token = page.get("access_token", long_token)
        avatar = ((page.get("picture") or {}).get("data") or {}).get("url", "")
        accounts.append({
            "platform": "facebook",
            "platform_account_id": page["id"],
            "display_name": page.get("name", ""),
            "username": "",
            "avatar_url": avatar,
            "access_token": page_token,
            "access_token_secret": "",
            "refresh_token": "",
            "token_expires_at": expires_at,
        })

    return accounts


def _exchange_instagram(db: Session, code: str) -> list[dict]:
    """Exchange OAuth code for Instagram tokens using the standalone Instagram API."""
    app_id, app_secret = get_oauth_app(db, "instagram")
    redirect = _redirect_uri(db, "instagram")

    # 1. Short-lived token via Instagram's own endpoint
    r = httpx.post(f"{INSTAGRAM_API}/oauth/access_token", data={
        "client_id": app_id,
        "client_secret": app_secret,
        "redirect_uri": redirect,
        "code": code,
        "grant_type": "authorization_code",
    }, timeout=30)
    _raise_for(r, "Instagram token exchange")
    short_data = r.json()
    short_token = short_data["access_token"]
    ig_user_id = str(short_data.get("user_id", ""))

    # 2. Long-lived token (60 days) via Instagram Graph
    r = httpx.get(f"{INSTAGRAM_GRAPH}/access_token", params={
        "grant_type": "ig_exchange_token",
        "client_secret": app_secret,
        "access_token": short_token,
    }, timeout=30)
    _raise_for(r, "Instagram long-lived token")
    long_data = r.json()
    long_token = long_data["access_token"]
    expires_at = datetime.now(timezone.utc) + timedelta(seconds=long_data.get("expires_in", 5_184_000))

    # 3. User profile
    r = httpx.get(f"{INSTAGRAM_GRAPH}/me", params={
        "fields": "id,username,name,profile_picture_url",
        "access_token": long_token,
    }, timeout=30)
    _raise_for(r, "Instagram user info")
    user = r.json()

    return [{
        "platform": "instagram",
        "platform_account_id": user.get("id") or ig_user_id,
        "display_name": user.get("name") or user.get("username", ""),
        "username": user.get("username", ""),
        "avatar_url": user.get("profile_picture_url", ""),
        "access_token": long_token,
        "access_token_secret": "",
        "refresh_token": "",
        "token_expires_at": expires_at,
    }]


def _exchange_twitter(db: Session, code: str, pkce_verifier: str) -> list[dict]:
    app_id, app_secret = get_oauth_app(db, "twitter")
    r = httpx.post(f"{TWITTER_API}/2/oauth2/token",
        auth=(app_id, app_secret),
        data={
            "code": code,
            "grant_type": "authorization_code",
            "redirect_uri": _redirect_uri(db, "twitter"),
            "code_verifier": pkce_verifier,
        }, timeout=30)
    _raise_for(r, "Twitter token exchange")
    data = r.json()
    access_token = data["access_token"]
    expires_at = datetime.now(timezone.utc) + timedelta(seconds=data.get("expires_in", 7200))

    r = httpx.get(f"{TWITTER_API}/2/users/me",
        headers={"Authorization": f"Bearer {access_token}"},
        params={"user.fields": "id,name,username,profile_image_url"},
        timeout=30)
    _raise_for(r, "Twitter user info")
    user = r.json().get("data", {})

    return [{
        "platform": "x",
        "platform_account_id": user.get("id", ""),
        "display_name": user.get("name", ""),
        "username": user.get("username", ""),
        "avatar_url": user.get("profile_image_url", ""),
        "access_token": access_token,
        "access_token_secret": "",
        "refresh_token": data.get("refresh_token", ""),
        "token_expires_at": expires_at,
    }]


def _exchange_linkedin(db: Session, code: str) -> list[dict]:
    app_id, app_secret = get_oauth_app(db, "linkedin")
    r = httpx.post("https://www.linkedin.com/oauth/v2/accessToken", data={
        "grant_type": "authorization_code",
        "code": code,
        "redirect_uri": _redirect_uri(db, "linkedin"),
        "client_id": app_id,
        "client_secret": app_secret,
    }, timeout=30)
    _raise_for(r, "LinkedIn token exchange")
    data = r.json()
    access_token = data["access_token"]
    expires_at = datetime.now(timezone.utc) + timedelta(seconds=data.get("expires_in", 5_184_000))

    r = httpx.get(f"{LINKEDIN_API}/v2/me",
        headers={"Authorization": f"Bearer {access_token}"},
        params={"projection": "(id,firstName,lastName,profilePicture(displayImage~:playableStreams))"},
        timeout=30)
    _raise_for(r, "LinkedIn profile")
    profile = r.json()

    first = list((profile.get("firstName") or {}).get("localized", {}).values())
    last = list((profile.get("lastName") or {}).get("localized", {}).values())
    name = f"{first[0] if first else ''} {last[0] if last else ''}".strip()

    return [{
        "platform": "linkedin",
        "platform_account_id": profile.get("id", ""),
        "display_name": name or "LinkedIn User",
        "username": "",
        "avatar_url": "",
        "access_token": access_token,
        "access_token_secret": "",
        "refresh_token": data.get("refresh_token", ""),
        "token_expires_at": expires_at,
    }]


# ---------------------------------------------------------------------------
# Upsert SocialAccount after callback
# ---------------------------------------------------------------------------

def upsert_channel(db: Session, client_id: str, actor_id: str, account: dict) -> SocialAccount:
    """Create or update a SocialAccount from an OAuth callback result dict."""
    existing = db.scalar(
        select(SocialAccount).where(
            SocialAccount.client_id == client_id,
            SocialAccount.platform == account["platform"],
            SocialAccount.platform_account_id == account["platform_account_id"],
        )
    )
    if existing is None:
        existing = SocialAccount(client_id=client_id, connected_by=actor_id)
        db.add(existing)

    existing.platform = account["platform"]
    existing.platform_account_id = account["platform_account_id"]
    existing.display_name = account["display_name"]
    existing.username = account["username"]
    existing.avatar_url = account["avatar_url"]
    existing.access_token_encrypted = encrypt_secret(account["access_token"])
    existing.access_token_secret_encrypted = encrypt_secret(account.get("access_token_secret", ""))
    existing.refresh_token_encrypted = encrypt_secret(account.get("refresh_token", ""))
    existing.token_expires_at = account.get("token_expires_at")
    existing.last_verified_at = datetime.now(timezone.utc)
    existing.status = ChannelStatus.connected
    existing.error = ""
    db.flush()
    return existing


# ---------------------------------------------------------------------------
# Token refresh (called before publishing when token is near expiry)
# ---------------------------------------------------------------------------

def maybe_refresh_token(db: Session, channel: SocialAccount) -> bool:
    """Refresh the token if it expires within 7 days. Returns True if refreshed."""
    if not channel.token_expires_at:
        return False
    now = datetime.now(timezone.utc)
    expires = channel.token_expires_at
    if expires.tzinfo is None:
        expires = expires.replace(tzinfo=timezone.utc)
    if expires - now > timedelta(days=7):
        return False

    try:
        p = channel.platform
        if p == "facebook":
            app_id, app_secret = get_oauth_app(db, "facebook")
            cur_token = decrypt_secret(channel.access_token_encrypted)
            r = httpx.get(f"{FACEBOOK_GRAPH}/oauth/access_token", params={
                "grant_type": "fb_exchange_token",
                "client_id": app_id, "client_secret": app_secret,
                "fb_exchange_token": cur_token,
            }, timeout=30)
            _raise_for(r, "Facebook token refresh")
            data = r.json()
            channel.access_token_encrypted = encrypt_secret(data["access_token"])
            channel.token_expires_at = now + timedelta(seconds=data.get("expires_in", 5_184_000))

        elif p == "instagram":
            cur_token = decrypt_secret(channel.access_token_encrypted)
            r = httpx.get(f"{INSTAGRAM_GRAPH}/refresh_access_token", params={
                "grant_type": "ig_refresh_token",
                "access_token": cur_token,
            }, timeout=30)
            _raise_for(r, "Instagram token refresh")
            data = r.json()
            channel.access_token_encrypted = encrypt_secret(data["access_token"])
            channel.token_expires_at = now + timedelta(seconds=data.get("expires_in", 5_184_000))

        elif p in ("twitter", "x"):
            app_id, app_secret = get_oauth_app(db, "twitter")
            refresh_tok = decrypt_secret(channel.refresh_token_encrypted)
            if not refresh_tok:
                return False
            r = httpx.post(f"{TWITTER_API}/2/oauth2/token",
                auth=(app_id, app_secret),
                data={"grant_type": "refresh_token", "refresh_token": refresh_tok},
                timeout=30)
            _raise_for(r, "Twitter token refresh")
            data = r.json()
            channel.access_token_encrypted = encrypt_secret(data["access_token"])
            channel.refresh_token_encrypted = encrypt_secret(data.get("refresh_token", ""))
            channel.token_expires_at = now + timedelta(seconds=data.get("expires_in", 7200))

        elif p == "linkedin":
            app_id, app_secret = get_oauth_app(db, "linkedin")
            refresh_tok = decrypt_secret(channel.refresh_token_encrypted)
            if not refresh_tok:
                return False
            r = httpx.post("https://www.linkedin.com/oauth/v2/accessToken", data={
                "grant_type": "refresh_token", "refresh_token": refresh_tok,
                "client_id": app_id, "client_secret": app_secret,
            }, timeout=30)
            _raise_for(r, "LinkedIn token refresh")
            data = r.json()
            channel.access_token_encrypted = encrypt_secret(data["access_token"])
            channel.refresh_token_encrypted = encrypt_secret(data.get("refresh_token", refresh_tok))
            channel.token_expires_at = now + timedelta(seconds=data.get("expires_in", 5_184_000))

        channel.last_verified_at = now
        db.commit()
        logger.info("Refreshed token for channel %s (%s)", channel.id, channel.platform)
        return True

    except Exception as exc:
        logger.warning("Token refresh failed for channel %s: %s", channel.id, exc)
        return False


# ---------------------------------------------------------------------------
# Health check (for verify / direct-mode sync)
# ---------------------------------------------------------------------------

def verify_channel_health(channel: SocialAccount) -> ChannelStatus:
    """Ping the platform with the stored token and return the resulting status."""
    token = decrypt_secret(channel.access_token_encrypted)
    if not token:
        return ChannelStatus.revoked
    try:
        p = channel.platform
        if p == "facebook":
            r = httpx.get(f"{FACEBOOK_GRAPH}/me", params={"access_token": token}, timeout=10)
        elif p == "instagram":
            r = httpx.get(f"{INSTAGRAM_GRAPH}/me", params={"fields": "id", "access_token": token}, timeout=10)
        elif p in ("twitter", "x"):
            r = httpx.get(f"{TWITTER_API}/2/users/me",
                headers={"Authorization": f"Bearer {token}"}, timeout=10)
        elif p == "linkedin":
            r = httpx.get(f"{LINKEDIN_API}/v2/me",
                headers={"Authorization": f"Bearer {token}"}, timeout=10)
        else:
            return ChannelStatus.error
        if r.status_code == 200:
            return ChannelStatus.connected
        if r.status_code in (401, 403):
            return ChannelStatus.expired
        return ChannelStatus.error
    except Exception:
        return ChannelStatus.error


# ---------------------------------------------------------------------------
# Publishing
# ---------------------------------------------------------------------------

def publish(
    db: Session, channel: SocialAccount, text: str,
    image_urls: list[str] | None = None, video_url: str = "",
) -> tuple[str, str]:
    """Publish content directly to the platform. Returns (native_post_id, published_url).

    `image_urls` is a list — one item for a single image, multiple for a carousel.
    """
    image_urls = image_urls or []
    maybe_refresh_token(db, channel)
    access_token = decrypt_secret(channel.access_token_encrypted)
    if not access_token:
        raise DirectSocialError(f"No access token for channel {channel.id}")

    p = channel.platform
    account_id = channel.platform_account_id

    if p == "facebook":
        return _publish_facebook(account_id, access_token, text, image_urls, video_url)
    if p == "instagram":
        return _publish_instagram(account_id, access_token, text, image_urls, video_url)
    if p in ("twitter", "x"):
        return _publish_twitter(access_token, text)
    if p == "linkedin":
        return _publish_linkedin(account_id, access_token, text)

    raise DirectSocialError(f"Platform not supported for direct publishing: {p}")


def _publish_facebook(page_id: str, page_token: str, text: str, image_urls: list[str], video_url: str = "") -> tuple[str, str]:
    if video_url:
        return _publish_facebook_reel(page_id, page_token, text, video_url)
    elif len(image_urls) > 1:
        return _publish_facebook_carousel(page_id, page_token, text, image_urls)
    elif image_urls:
        logger.info(f"Publishing image to Facebook page {page_id}")
        r = httpx.post(f"{FACEBOOK_GRAPH}/{page_id}/photos",
            data={"caption": text, "url": image_urls[0], "access_token": page_token}, timeout=60)
        logger.info(f"Facebook photo response: {r.status_code} - {r.text[:500]}")
        _raise_for(r, "Facebook photo post")
        post_id = r.json().get("post_id") or r.json().get("id", "")
    else:
        r = httpx.post(f"{FACEBOOK_GRAPH}/{page_id}/feed",
            data={"message": text, "access_token": page_token}, timeout=60)
        _raise_for(r, "Facebook feed post")
        post_id = r.json().get("id", "")

    published_url = ""
    if post_id:
        try:
            r = httpx.get(f"{FACEBOOK_GRAPH}/{post_id}",
                params={"fields": "permalink_url", "access_token": page_token}, timeout=15)
            permalink = r.json().get("permalink_url", "")
            if permalink:
                published_url = permalink
                logger.info(f"Facebook post published: {published_url}")
        except Exception as exc:
            logger.warning(f"Could not fetch Facebook permalink for {post_id}: {exc}")

    return post_id, published_url


def _publish_facebook_reel(page_id: str, page_token: str, text: str, video_url: str) -> tuple[str, str]:
    """Publish a Facebook Reel using the 3-phase resumable upload flow.

    1. start  → POST /{page_id}/video_reels?upload_phase=start → video_id + upload_url
    2. upload → POST {upload_url} with a `file_url` header (Facebook fetches the file)
    3. finish → POST /{page_id}/video_reels?upload_phase=finish → publishes the reel
    """
    logger.info(f"Publishing Reel to Facebook page {page_id}: starting upload session")

    # Phase 1: start — get the video_id and the rupload URL
    r = httpx.post(f"{FACEBOOK_GRAPH}/{page_id}/video_reels",
        data={"upload_phase": "start", "access_token": page_token}, timeout=60)
    logger.info(f"Facebook Reel start: {r.status_code} - {r.text[:500]}")
    _raise_for(r, "Facebook Reel start")
    start = r.json()
    video_id = start.get("video_id", "")
    upload_url = start.get("upload_url", "")
    if not video_id or not upload_url:
        raise DirectSocialError(f"Facebook Reel start did not return video_id/upload_url: {start}")

    # Phase 2: upload — tell Facebook to fetch the file from our signed media URL
    r = httpx.post(upload_url,
        headers={"Authorization": f"OAuth {page_token}", "file_url": video_url},
        timeout=300)
    logger.info(f"Facebook Reel upload: {r.status_code} - {r.text[:500]}")
    _raise_for(r, "Facebook Reel upload")

    # Phase 3: finish — publish the reel
    r = httpx.post(f"{FACEBOOK_GRAPH}/{page_id}/video_reels",
        data={
            "upload_phase": "finish",
            "video_id": video_id,
            "video_state": "PUBLISHED",
            "description": text,
            "access_token": page_token,
        }, timeout=60)
    logger.info(f"Facebook Reel finish: {r.status_code} - {r.text[:500]}")
    _raise_for(r, "Facebook Reel finish")

    # Poll until the reel is processed and published
    for attempt in range(20):
        time.sleep(3)
        r = httpx.get(f"{FACEBOOK_GRAPH}/{video_id}",
            params={"fields": "status", "access_token": page_token}, timeout=30)
        status = (r.json().get("status") or {})
        video_status = status.get("video_status", "")
        logger.info(f"Facebook Reel {video_id} status: {video_status} (attempt {attempt + 1})")
        if video_status in ("ready", "published"):
            break
        if video_status == "error":
            raise DirectSocialError(
                f"Facebook Reel processing failed: {status}",
                code="transient",
            )

    published_url = f"https://www.facebook.com/reel/{video_id}" if video_id else ""
    logger.info(f"Facebook Reel published: {published_url}")
    return video_id, published_url


def _publish_facebook_carousel(page_id: str, page_token: str, text: str, image_urls: list[str]) -> tuple[str, str]:
    logger.info(f"Publishing {len(image_urls)}-slide carousel to Facebook page {page_id}")

    # Upload each image as an unpublished photo to get its ID
    photo_ids: list[str] = []
    for i, url in enumerate(image_urls):
        r = httpx.post(f"{FACEBOOK_GRAPH}/{page_id}/photos",
            data={"url": url, "published": "false", "access_token": page_token}, timeout=60)
        logger.info(f"Facebook carousel photo {i + 1}: {r.status_code} - {r.text[:300]}")
        _raise_for(r, f"Facebook carousel photo {i + 1}")
        photo_ids.append(r.json().get("id", ""))

    # Publish a single feed post with all photos attached
    r = httpx.post(f"{FACEBOOK_GRAPH}/{page_id}/feed",
        data={
            "message": text,
            "attached_media": json.dumps([{"media_fbid": pid} for pid in photo_ids]),
            "access_token": page_token,
        }, timeout=60)
    logger.info(f"Facebook carousel feed: {r.status_code} - {r.text[:300]}")
    _raise_for(r, "Facebook carousel post")
    post_id = r.json().get("id", "")

    published_url = ""
    if post_id:
        try:
            r = httpx.get(f"{FACEBOOK_GRAPH}/{post_id}",
                params={"fields": "permalink_url", "access_token": page_token}, timeout=15)
            published_url = r.json().get("permalink_url", "")
            if published_url:
                logger.info(f"Facebook carousel published: {published_url}")
        except Exception as exc:
            logger.warning(f"Could not fetch Facebook carousel permalink for {post_id}: {exc}")

    return post_id, published_url


def _publish_instagram(ig_account_id: str, page_token: str, text: str, image_urls: list[str], video_url: str = "") -> tuple[str, str]:
    if not image_urls and not video_url:
        raise DirectSocialError("Instagram requires an image or video to publish.")

    if len(image_urls) > 1:
        return _publish_instagram_carousel(ig_account_id, page_token, text, image_urls)

    image_url = image_urls[0] if image_urls else ""

    if video_url:
        logger.info(f"Publishing video to Instagram account {ig_account_id}")
        container_data = {
            "caption": text,
            "video_url": video_url,
            "media_type": "REELS",
            "access_token": page_token,
        }
    else:
        logger.info(f"Publishing image to Instagram account {ig_account_id}")
        container_data = {
            "caption": text,
            "image_url": image_url,
            "media_type": "IMAGE",
            "access_token": page_token,
        }

    # Step 1: create media container
    r = httpx.post(f"{INSTAGRAM_GRAPH}/{ig_account_id}/media",
        data=container_data, timeout=60)
    logger.info(f"Instagram media container response: {r.status_code} - {r.text[:500]}")
    _raise_for(r, "Instagram media container")
    container_id = r.json()["id"]

    # Step 2: wait for container to finish processing (Instagram processes async)
    poll_attempts = 30 if video_url else 15
    for attempt in range(poll_attempts):
        time.sleep(3)
        r = httpx.get(f"{INSTAGRAM_GRAPH}/{container_id}",
            params={"fields": "status_code,status", "access_token": page_token}, timeout=30)
        _raise_for(r, "Instagram container status")
        status = r.json().get("status_code", "")
        logger.info(f"Instagram container {container_id} status: {status} (attempt {attempt + 1})")
        if status == "FINISHED":
            break
        if status == "ERROR":
            raise DirectSocialError(
                f"Instagram media container failed to process: {r.json().get('status', 'unknown error')}",
                code="transient",
            )
    else:
        media_type = "video" if video_url else "image"
        raise DirectSocialError(
            f"Instagram media container timed out — {media_type} took too long to process.",
            code="transient",
        )

    # Step 3: publish
    r = httpx.post(f"{INSTAGRAM_GRAPH}/{ig_account_id}/media_publish",
        data={"creation_id": container_id, "access_token": page_token}, timeout=60)
    _raise_for(r, "Instagram media publish")
    media_id = r.json().get("id", "")

    # Step 4: fetch shortcode to build the public permalink
    published_url = ""
    try:
        r = httpx.get(f"{INSTAGRAM_GRAPH}/{media_id}",
            params={"fields": "shortcode,media_type", "access_token": page_token}, timeout=15)
        data = r.json()
        shortcode = data.get("shortcode", "")
        media_type = data.get("media_type", "")
        if shortcode:
            if media_type in ("VIDEO", "REELS"):
                published_url = f"https://www.instagram.com/reel/{shortcode}/"
            else:
                published_url = f"https://www.instagram.com/p/{shortcode}/"
            logger.info(f"Instagram post published: {published_url}")
    except Exception as exc:
        logger.warning(f"Could not fetch Instagram shortcode for {media_id}: {exc}")

    return media_id, published_url


def _publish_instagram_carousel(ig_account_id: str, page_token: str, text: str, image_urls: list[str]) -> tuple[str, str]:
    logger.info(f"Publishing {len(image_urls)}-slide carousel to Instagram account {ig_account_id}")

    # Step 1: create one container per slide (each must finish processing before moving on)
    container_ids: list[str] = []
    for i, image_url in enumerate(image_urls):
        r = httpx.post(f"{INSTAGRAM_GRAPH}/{ig_account_id}/media",
            data={
                "image_url": image_url,
                "media_type": "IMAGE",
                "is_carousel_item": "true",
                "access_token": page_token,
            }, timeout=60)
        logger.info(f"Instagram carousel item {i + 1}: {r.status_code} - {r.text[:300]}")
        _raise_for(r, f"Instagram carousel item {i + 1} container")
        container_id = r.json()["id"]

        for attempt in range(15):
            time.sleep(3)
            r = httpx.get(f"{INSTAGRAM_GRAPH}/{container_id}",
                params={"fields": "status_code", "access_token": page_token}, timeout=30)
            _raise_for(r, f"Instagram carousel item {i + 1} status")
            status = r.json().get("status_code", "")
            logger.info(f"Instagram carousel item {i + 1} container {container_id}: {status} (attempt {attempt + 1})")
            if status == "FINISHED":
                break
            if status == "ERROR":
                raise DirectSocialError(
                    f"Instagram carousel item {i + 1} failed: {r.json()}",
                    code="transient",
                )
        else:
            raise DirectSocialError(
                f"Instagram carousel item {i + 1} timed out.",
                code="transient",
            )

        container_ids.append(container_id)

    # Step 2: create the carousel container
    r = httpx.post(f"{INSTAGRAM_GRAPH}/{ig_account_id}/media",
        data={
            "caption": text,
            "media_type": "CAROUSEL",
            "children": ",".join(container_ids),
            "access_token": page_token,
        }, timeout=60)
    logger.info(f"Instagram carousel container: {r.status_code} - {r.text[:300]}")
    _raise_for(r, "Instagram carousel container")
    carousel_id = r.json()["id"]

    # Step 3: publish
    r = httpx.post(f"{INSTAGRAM_GRAPH}/{ig_account_id}/media_publish",
        data={"creation_id": carousel_id, "access_token": page_token}, timeout=60)
    _raise_for(r, "Instagram carousel publish")
    media_id = r.json().get("id", "")

    # Step 4: permalink (carousels always show as /p/)
    published_url = ""
    try:
        r = httpx.get(f"{INSTAGRAM_GRAPH}/{media_id}",
            params={"fields": "shortcode", "access_token": page_token}, timeout=15)
        shortcode = r.json().get("shortcode", "")
        if shortcode:
            published_url = f"https://www.instagram.com/p/{shortcode}/"
            logger.info(f"Instagram carousel published: {published_url}")
    except Exception as exc:
        logger.warning(f"Could not fetch Instagram carousel shortcode for {media_id}: {exc}")

    return media_id, published_url


def _publish_twitter(access_token: str, text: str) -> tuple[str, str]:
    r = httpx.post(f"{TWITTER_API}/2/tweets",
        headers={"Authorization": f"Bearer {access_token}", "Content-Type": "application/json"},
        json={"text": text}, timeout=60)
    _raise_for(r, "Twitter tweet")
    return r.json().get("data", {}).get("id", ""), ""


def _publish_linkedin(author_id: str, access_token: str, text: str) -> tuple[str, str]:
    payload = {
        "author": f"urn:li:person:{author_id}",
        "lifecycleState": "PUBLISHED",
        "specificContent": {
            "com.linkedin.ugc.ShareContent": {
                "shareCommentary": {"text": text},
                "shareMediaCategory": "NONE",
            }
        },
        "visibility": {"com.linkedin.ugc.MemberNetworkVisibility": "PUBLIC"},
    }
    r = httpx.post(f"{LINKEDIN_API}/v2/ugcPosts",
        headers={
            "Authorization": f"Bearer {access_token}",
            "Content-Type": "application/json",
            "X-Restli-Protocol-Version": "2.0.0",
        },
        json=payload, timeout=60)
    _raise_for(r, "LinkedIn post")
    return r.headers.get("x-restli-id", "") or r.json().get("id", ""), ""


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

# --- Error taxonomy --------------------------------------------------------
#
# Mapping rules for HTTP status + Meta Graph error codes → DirectSocialError
# taxonomy. Centralised so the publishing layer can decide retries uniformly.

# Meta Graph `code` values that mean rate-limited / temporarily throttled.
_GRAPH_RATE_LIMIT_CODES = {"4", "17", "32", "613"}
# Meta Graph `code` values that mean the access token is bad / expired.
_GRAPH_AUTH_EXPIRED_CODES = {"190", "102", "463", "467"}
# Meta Graph `code` values that mean a temporary spam / policy block.
_GRAPH_SPAM_BLOCKED_CODES = {"368"}


def _parse_graph_error(r: httpx.Response) -> tuple[str | None, int | None, str | None, str | None]:
    """Pull the Graph `error.code`, `error_subcode`, `message`, and `Retry-After`
    hint from a Meta/IG response. Returns (code, subcode, message, retry_after_text).
    Tolerant of non-JSON / empty bodies.
    """
    code: str | None = None
    subcode: int | None = None
    message: str | None = None
    try:
        body = r.json()
    except Exception:
        body = None
    if isinstance(body, dict):
        err = body.get("error") if isinstance(body.get("error"), dict) else None
        if err:
            raw_code = err.get("code")
            try:
                code = str(int(raw_code)) if raw_code is not None else None
            except (TypeError, ValueError):
                code = str(raw_code) if raw_code is not None else None
            sub = err.get("error_subcode")
            try:
                subcode = int(sub) if sub is not None else None
            except (TypeError, ValueError):
                subcode = None
            message = err.get("message")
    retry_after = r.headers.get("Retry-After")
    return code, subcode, message, retry_after


def _retry_after_seconds(retry_after: str | None) -> int | None:
    """Convert a Retry-After header (seconds OR HTTP-date) to seconds."""
    if not retry_after:
        return None
    try:
        return max(int(retry_after), 0)
    except ValueError:
        # HTTP-date format — best-effort fallback: return 60s.
        return 60


def _raise_for(r: httpx.Response, context: str) -> None:
    """Raise DirectSocialError for a failed platform response, classified.

    Twitter's 402 (Free tier) is a special case surfaced verbatim. Everything
    else routes through the Graph error taxonomy where applicable.
    """
    if r.status_code < 400:
        return

    if r.status_code == 402:
        raise DirectSocialError(
            f"{context}: your Twitter/X Developer app is on the Free tier, which does not allow posting tweets. "
            "Upgrade to Basic ($100/month) at developer.x.com to enable publishing.",
            code="permanent",
        )

    code, subcode, message, retry_after_hdr = _parse_graph_error(r)
    retry_after = _retry_after_seconds(retry_after_hdr)
    detail = message or r.text[:300]

    # 429 — explicit HTTP rate limit (Meta, X, LinkedIn).
    if r.status_code == 429:
        raise DirectSocialError(
            f"{context}: rate limited (429). {detail}",
            code="rate_limited",
            retry_after=retry_after,
        )

    # 401/403 — token rejected. Log the full response once so we can tell an
    # actually-revoked token apart from an insufficient-scope/permission
    # rejection (X and other platforms return 403 for both, with different
    # response headers/bodies that aren't surfaced in the short `detail`).
    if r.status_code in (401, 403):
        logger.warning(
            "%s: %s %s — headers=%s body=%s",
            context, r.status_code, r.reason_phrase if hasattr(r, "reason_phrase") else "",
            dict(r.headers), r.text[:1000],
        )
        raise DirectSocialError(
            f"{context}: authentication failed ({r.status_code}). {detail}",
            code="auth_expired",
        )

    # Meta / IG Graph code mapping.
    if code in _GRAPH_AUTH_EXPIRED_CODES:
        raise DirectSocialError(
            f"{context}: Meta token expired or revoked (code {code}). {detail}",
            code="auth_expired",
        )
    if code in _GRAPH_RATE_LIMIT_CODES or (subcode is not None and subcode in (2445001, 2445003, 2445005)):
        raise DirectSocialError(
            f"{context}: rate limited by Meta (code {code}/{subcode}). {detail}",
            code="rate_limited",
            retry_after=retry_after,
        )
    if code in _GRAPH_SPAM_BLOCKED_CODES or (subcode is not None and subcode in (200302, 200303)):
        raise DirectSocialError(
            f"{context}: temporarily blocked by Meta (code {code}/{subcode}). {detail}",
            code="spam_blocked",
        )

    # 5xx — transient.
    if r.status_code >= 500:
        raise DirectSocialError(
            f"{context}: platform error ({r.status_code}). {detail}",
            code="transient",
        )

    # Everything else is a permanent failure (4xx other than 401/403/429/402).
    raise DirectSocialError(
        f"{context} failed ({r.status_code}). {detail}",
        code="permanent",
    )
