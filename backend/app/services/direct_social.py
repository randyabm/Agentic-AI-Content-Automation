"""Direct social publishing service.

Used when social_publishing_mode = 'direct'. Handles per-platform OAuth URL
generation, authorization code exchange, token refresh, and publishing.

App-level OAuth credentials (App ID / Consumer Key / Client ID + their secrets)
are stored encrypted in ProviderCredential rows:
  provider='oauth_facebook'  → Facebook & Instagram (same Meta app)
  provider='oauth_twitter'   → Twitter / X
  provider='oauth_linkedin'  → LinkedIn

Per-user tokens are stored encrypted on SocialAccount rows:
  access_token_encrypted, refresh_token_encrypted, platform_account_id, …
"""
from __future__ import annotations

import base64
import hashlib
import logging
import secrets
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
TWITTER_AUTH = "https://x.com"         # OAuth 2.0 authorization page (x.com = active session domain)
TWITTER_API = "https://api.x.com"      # REST API v2 (rebranded domain)
LINKEDIN_API = "https://api.linkedin.com"

_PLATFORM_PROVIDER: dict[str, str] = {
    "facebook": "oauth_facebook",
    "instagram": "oauth_facebook",  # Instagram uses the same Meta app
    "twitter": "oauth_twitter",
    "x": "oauth_twitter",
    "linkedin": "oauth_linkedin",
}

_PLATFORM_LABELS: dict[str, str] = {
    "oauth_facebook": "Facebook / Instagram (Meta)",
    "oauth_twitter": "Twitter / X",
    "oauth_linkedin": "LinkedIn",
}

# Platforms exposed in the UI for direct mode (not all CONNECTABLE)
DIRECT_PLATFORMS = ["facebook", "instagram", "twitter", "linkedin"]


class DirectSocialError(Exception):
    pass


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
    for platform_key in ("oauth_facebook", "oauth_twitter", "oauth_linkedin"):
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
    # Instagram shares the Facebook callback path.
    # app_public_url already includes /api (e.g. https://host/api), so we just append /auth/...
    path_platform = "facebook" if platform == "instagram" else platform
    return f"{get_app_public_url(db)}/auth/{path_platform}/callback"


def get_connect_url(db: Session, platform: str, client_id: str, user_id: str) -> str:
    """Return the OAuth authorization URL for the given platform."""
    p = platform.lower()

    if p in ("facebook", "instagram"):
        app_id, _ = get_oauth_app(db, "facebook")
        state = generate_state(client_id, user_id, p)
        params = {
            "client_id": app_id,
            "redirect_uri": _redirect_uri(db, "facebook"),
            "scope": (
                "pages_manage_posts,pages_read_engagement,pages_show_list,"
                "instagram_basic,instagram_content_publish"
            ),
            "state": state,
            "response_type": "code",
        }
        return f"https://www.facebook.com/v19.0/dialog/oauth?{urlencode(params)}"

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
    dicts (one per connected account — Facebook may return several pages)."""
    p = platform.lower()
    if p in ("facebook", "instagram"):
        return _exchange_facebook(db, code, p)
    if p in ("twitter", "x"):
        verifier = state_payload.get("pkce_verifier", "")
        return _exchange_twitter(db, code, verifier)
    if p == "linkedin":
        return _exchange_linkedin(db, code)
    raise DirectSocialError(f"Unsupported platform for token exchange: {platform}")


def _exchange_facebook(db: Session, code: str, platform: str) -> list[dict]:
    app_id, app_secret = get_oauth_app(db, "facebook")
    redirect = _redirect_uri(db, "facebook")

    # 1. Short-lived token
    r = httpx.get(f"{FACEBOOK_GRAPH}/oauth/access_token", params={
        "client_id": app_id, "client_secret": app_secret,
        "redirect_uri": redirect, "code": code,
    }, timeout=30)
    _raise_for(r, "Facebook token exchange")
    short_token = r.json()["access_token"]

    # 2. Long-lived token (60 days)
    r = httpx.get(f"{FACEBOOK_GRAPH}/oauth/access_token", params={
        "grant_type": "fb_exchange_token",
        "client_id": app_id, "client_secret": app_secret,
        "fb_exchange_token": short_token,
    }, timeout=30)
    _raise_for(r, "Facebook long-lived token")
    data = r.json()
    long_token = data["access_token"]
    expires_at = datetime.now(timezone.utc) + timedelta(seconds=data.get("expires_in", 5_184_000))

    # 3. List managed pages (including their own page tokens + linked IG accounts)
    r = httpx.get(f"{FACEBOOK_GRAPH}/me/accounts", params={
        "fields": (
            "id,name,access_token,picture{url},"
            "instagram_business_account{id,username,name,profile_picture_url}"
        ),
        "access_token": long_token,
    }, timeout=30)
    _raise_for(r, "Facebook pages list")
    pages = r.json().get("data", [])

    accounts: list[dict] = []
    for page in pages:
        page_token = page.get("access_token", long_token)
        avatar = ((page.get("picture") or {}).get("data") or {}).get("url", "")

        if platform == "facebook":
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

        elif platform == "instagram":
            ig = page.get("instagram_business_account")
            if ig:
                accounts.append({
                    "platform": "instagram",
                    "platform_account_id": ig["id"],
                    "display_name": ig.get("name") or page.get("name", ""),
                    "username": ig.get("username", ""),
                    "avatar_url": ig.get("profile_picture_url", ""),
                    "access_token": page_token,
                    "access_token_secret": "",
                    "refresh_token": "",
                    "token_expires_at": expires_at,
                })

    return accounts


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
        if p in ("facebook", "instagram"):
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
        if p in ("facebook", "instagram"):
            r = httpx.get(f"{FACEBOOK_GRAPH}/me", params={"access_token": token}, timeout=10)
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

def publish(db: Session, channel: SocialAccount, text: str, image_url: str = "") -> str:
    """Publish content directly to the platform. Returns the native post ID/URL."""
    maybe_refresh_token(db, channel)
    access_token = decrypt_secret(channel.access_token_encrypted)
    if not access_token:
        raise DirectSocialError(f"No access token for channel {channel.id}")

    p = channel.platform
    account_id = channel.platform_account_id

    if p == "facebook":
        return _publish_facebook(account_id, access_token, text, image_url)
    if p == "instagram":
        return _publish_instagram(account_id, access_token, text, image_url)
    if p in ("twitter", "x"):
        return _publish_twitter(access_token, text)
    if p == "linkedin":
        return _publish_linkedin(account_id, access_token, text)

    raise DirectSocialError(f"Platform not supported for direct publishing: {p}")


def _publish_facebook(page_id: str, page_token: str, text: str, image_url: str) -> str:
    if image_url:
        r = httpx.post(f"{FACEBOOK_GRAPH}/{page_id}/photos",
            data={"caption": text, "url": image_url, "access_token": page_token}, timeout=60)
        _raise_for(r, "Facebook photo post")
    else:
        r = httpx.post(f"{FACEBOOK_GRAPH}/{page_id}/feed",
            data={"message": text, "access_token": page_token}, timeout=60)
        _raise_for(r, "Facebook feed post")
    return r.json().get("id", "")


def _publish_instagram(ig_account_id: str, page_token: str, text: str, image_url: str) -> str:
    if not image_url:
        raise DirectSocialError("Instagram requires an image to publish.")
    r = httpx.post(f"{FACEBOOK_GRAPH}/{ig_account_id}/media",
        data={"caption": text, "image_url": image_url, "media_type": "IMAGE",
              "access_token": page_token}, timeout=60)
    _raise_for(r, "Instagram media container")
    container_id = r.json()["id"]
    r = httpx.post(f"{FACEBOOK_GRAPH}/{ig_account_id}/media_publish",
        data={"creation_id": container_id, "access_token": page_token}, timeout=60)
    _raise_for(r, "Instagram media publish")
    return r.json().get("id", "")


def _publish_twitter(access_token: str, text: str) -> str:
    r = httpx.post(f"{TWITTER_API}/2/tweets",
        headers={"Authorization": f"Bearer {access_token}", "Content-Type": "application/json"},
        json={"text": text}, timeout=60)
    _raise_for(r, "Twitter tweet")
    return r.json().get("data", {}).get("id", "")


def _publish_linkedin(author_id: str, access_token: str, text: str) -> str:
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
    return r.headers.get("x-restli-id", "") or r.json().get("id", "")


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _raise_for(r: httpx.Response, context: str) -> None:
    if r.status_code >= 400:
        raise DirectSocialError(f"{context} failed ({r.status_code}): {r.text[:300]}")
