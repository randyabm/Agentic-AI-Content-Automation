from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import get_current_user, require_platform_admin
from app.core.security import hash_password
from app.db.session import get_db
from app.models.audit import AuditLog
from app.models.user import User
from app.schemas.user import UserCreate, UserOut, UserUpdate
from app.services import audit

router = APIRouter(prefix="/users", tags=["users"])

# Mounted at the API root (no prefix): the current user's own org members.
# Any authenticated org member can read it (e.g. an analyst picking an approver),
# unlike /orgs/{id}/members which is org-admin only.
team_router = APIRouter(tags=["team"])


@team_router.get("/team", response_model=list[UserOut])
def list_team(db: Session = Depends(get_db), actor: User = Depends(get_current_user)):
    if not actor.org_id:
        return []
    return db.scalars(
        select(User).where(User.org_id == actor.org_id).order_by(User.created_at)
    ).all()


@router.get("", response_model=list[UserOut])
def list_users(db: Session = Depends(get_db), _: User = Depends(require_platform_admin)):
    return db.scalars(select(User).order_by(User.created_at)).all()


@router.post("", response_model=UserOut, status_code=status.HTTP_201_CREATED)
def create_user(body: UserCreate, db: Session = Depends(get_db), actor: User = Depends(require_platform_admin)):
    email = body.email.lower()
    if db.scalar(select(User).where(User.email == email)):
        raise HTTPException(status.HTTP_409_CONFLICT, "A user with this email already exists")
    user = User(
        email=email,
        full_name=body.full_name,
        hashed_password=hash_password(body.password),
        role=body.role,
    )
    db.add(user)
    db.commit()
    audit.record(db, actor, "user.create", "user", user.id, {"email": email, "role": body.role.value})
    return user


@router.patch("/{user_id}", response_model=UserOut)
def update_user(user_id: str, body: UserUpdate, db: Session = Depends(get_db), actor: User = Depends(require_platform_admin)):
    user = db.get(User, user_id)
    if user is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "User not found")
    changes = body.model_dump(exclude_unset=True)
    if "password" in changes:
        user.hashed_password = hash_password(changes.pop("password"))
    for field, value in changes.items():
        setattr(user, field, value)
    db.commit()
    audit.record(db, actor, "user.update", "user", user.id, {k: str(v) for k, v in changes.items()})
    return user


@router.get("/audit-log")
def audit_log(limit: int = 100, db: Session = Depends(get_db), _: User = Depends(require_platform_admin)):
    rows = db.scalars(select(AuditLog).order_by(AuditLog.created_at.desc()).limit(min(limit, 500))).all()
    return [
        {
            "id": r.id,
            "user_email": r.user_email,
            "action": r.action,
            "entity_type": r.entity_type,
            "entity_id": r.entity_id,
            "detail": r.detail,
            "created_at": r.created_at,
        }
        for r in rows
    ]
