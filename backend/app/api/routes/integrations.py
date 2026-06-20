"""Platform-admin integration settings.

Manages two publishing connectors that can be toggled in System Settings:
  - Zernio (middleman): app-wide API key stored in ProviderCredential.
  - Direct (platform APIs): per-platform OAuth app credentials (App ID + Secret)
    stored in ProviderCredential rows with providers oauth_facebook / oauth_twitter
    / oauth_linkedin.

The active connector is controlled by the `social_publishing_mode` setting
('zernio' | 'direct').
"""
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.api.deps import require_platform_admin
from app.core.crypto import mask_secret
from app.db.session import get_db
from app.models.user import User
from app.schemas.social import ZernioKeyOut, ZernioKeyUpdate
from app.services import audit, zernio
from app.services.direct_social import (
    DirectSocialError,
    list_oauth_apps,
    set_oauth_app,
)

router = APIRouter(prefix="/integrations", tags=["integrations"])


# ---------------------------------------------------------------------------
# Zernio
# ---------------------------------------------------------------------------


def _key_out(db: Session) -> ZernioKeyOut:
    key = zernio.get_api_key(db)
    return ZernioKeyOut(has_key=bool(key), api_key_hint=mask_secret(key))


@router.get("/zernio", response_model=ZernioKeyOut)
def get_zernio_key(db: Session = Depends(get_db), _: User = Depends(require_platform_admin)):
    return _key_out(db)


@router.put("/zernio", response_model=ZernioKeyOut)
def set_zernio_key(
    body: ZernioKeyUpdate,
    db: Session = Depends(get_db),
    actor: User = Depends(require_platform_admin),
):
    zernio.set_api_key(db, body.api_key)
    audit.record(db, actor, "integration.zernio_key_set", "integration", "zernio")
    return _key_out(db)


@router.post("/zernio/test")
def test_zernio(db: Session = Depends(get_db), _: User = Depends(require_platform_admin)):
    try:
        profiles = zernio.list_profiles(db)
    except zernio.ZernioError as exc:
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, str(exc))
    return {"ok": True, "profiles": len(profiles)}


# ---------------------------------------------------------------------------
# Direct social — OAuth app credentials
# ---------------------------------------------------------------------------


class SocialAppStatus(BaseModel):
    provider: str
    label: str
    has_app_id: bool
    has_app_secret: bool
    app_id_hint: str


class SocialAppUpdate(BaseModel):
    app_id: str = ""
    app_secret: str = ""


@router.get("/social-apps", response_model=list[SocialAppStatus])
def get_social_apps(db: Session = Depends(get_db), _: User = Depends(require_platform_admin)):
    """List the configured OAuth app credentials for all direct platforms."""
    return list_oauth_apps(db)


@router.put("/social-apps/{platform}", response_model=list[SocialAppStatus])
def update_social_app(
    platform: str,
    body: SocialAppUpdate,
    db: Session = Depends(get_db),
    actor: User = Depends(require_platform_admin),
):
    """Set (or update) the OAuth app credentials for a platform.
    `platform` must be one of: facebook, instagram, twitter, linkedin."""
    try:
        set_oauth_app(db, platform, body.app_id, body.app_secret)
    except DirectSocialError as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(exc))
    audit.record(
        db, actor,
        "integration.social_app_updated",
        "integration", platform,
        {"platform": platform},
    )
    return list_oauth_apps(db)
