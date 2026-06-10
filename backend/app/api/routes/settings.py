from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import require_admin
from app.db.session import get_db
from app.models.setting import Setting
from app.models.user import User
from app.schemas.setting import SettingOut, SettingsUpdate
from app.services import audit

router = APIRouter(prefix="/settings", tags=["settings"])


@router.get("", response_model=list[SettingOut])
def list_settings(db: Session = Depends(get_db), _: User = Depends(require_admin)):
    return db.scalars(select(Setting).order_by(Setting.key)).all()


@router.put("", response_model=list[SettingOut])
def update_settings(body: SettingsUpdate, db: Session = Depends(get_db), actor: User = Depends(require_admin)):
    for key, value in body.values.items():
        setting = db.get(Setting, key)
        if setting is None:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, f"Unknown setting: {key}")
        setting.value = value
    db.commit()
    audit.record(db, actor, "settings.update", "settings", detail={"keys": list(body.values.keys())})
    return db.scalars(select(Setting).order_by(Setting.key)).all()
