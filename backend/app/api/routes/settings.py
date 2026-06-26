from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import get_current_user, require_platform_admin
from app.db.session import get_db
from app.models.setting import Setting
from app.models.user import User
from app.schemas.setting import SettingOut, SettingsUpdate
from app.services import audit
from app.services.publishing_limits import effective_limits, save_overrides

router = APIRouter(prefix="/settings", tags=["settings"])


@router.get("", response_model=list[SettingOut])
def list_settings(db: Session = Depends(get_db), _: User = Depends(get_current_user)):
    # Readable by any authenticated user — these are non-secret UI/behavior flags
    # the frontend needs (e.g. show_article_library). Writes are platform-admin only.
    return db.scalars(select(Setting).order_by(Setting.key)).all()


@router.put("", response_model=list[SettingOut])
def update_settings(body: SettingsUpdate, db: Session = Depends(get_db), actor: User = Depends(require_platform_admin)):
    for key, value in body.values.items():
        setting = db.get(Setting, key)
        if setting is None:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, f"Unknown setting: {key}")
        setting.value = value
    db.commit()
    audit.record(db, actor, "settings.update", "settings", detail={"keys": list(body.values.keys())})
    return db.scalars(select(Setting).order_by(Setting.key)).all()


class PublishingLimitsResponse(BaseModel):
    limits: dict[str, dict[str, int]]


class PublishingLimitsUpdate(BaseModel):
    limits: dict[str, dict[str, int]]


@router.get("/publishing-limits", response_model=PublishingLimitsResponse)
def get_publishing_limits(db: Session = Depends(get_db), _: User = Depends(get_current_user)):
    """Effective per-platform limits (defaults + admin overrides)."""
    return PublishingLimitsResponse(limits=effective_limits(db))


@router.put("/publishing-limits", response_model=PublishingLimitsResponse)
def put_publishing_limits(
    body: PublishingLimitsUpdate,
    db: Session = Depends(get_db),
    actor: User = Depends(require_platform_admin),
):
    """Update the admin overrides for the per-platform publish limits.

    Only the overrides are persisted (the worker's `effective_limits` merges
    them with the built-in defaults so any platform the admin didn't touch
    still uses the safe default). Sending an empty object clears all
    overrides and reverts every platform to the default.
    """
    try:
        save_overrides(db, body.limits)
    except ValueError as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(exc))
    db.commit()
    audit.record(db, actor, "settings.publishing_limits_updated", "settings",
                 detail={"keys": sorted(body.limits.keys())})
    return PublishingLimitsResponse(limits=effective_limits(db))
