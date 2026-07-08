"""In-app notification feed for the current user (PRD FR-07)."""
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import func, select, update
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.db.session import get_db
from app.models.notification import Notification
from app.models.user import User
from app.schemas.notification import NotificationOut, UnreadCountOut

router = APIRouter(tags=["notifications"])


@router.get("/notifications", response_model=list[NotificationOut])
def list_notifications(
    limit: int = 50,
    unread_only: bool = False,
    db: Session = Depends(get_db),
    actor: User = Depends(get_current_user),
):
    """The current user's notifications, newest first."""
    stmt = select(Notification).where(Notification.user_id == actor.id)
    if unread_only:
        stmt = stmt.where(Notification.read_at.is_(None))
    stmt = stmt.order_by(Notification.created_at.desc()).limit(min(max(limit, 1), 200))
    return db.scalars(stmt).all()


@router.get("/notifications/unread-count", response_model=UnreadCountOut)
def unread_count(db: Session = Depends(get_db), actor: User = Depends(get_current_user)):
    count = db.scalar(
        select(func.count())
        .select_from(Notification)
        .where(Notification.user_id == actor.id, Notification.read_at.is_(None))
    )
    return UnreadCountOut(count=count or 0)


@router.post("/notifications/{notification_id}/read", response_model=NotificationOut)
def mark_read(
    notification_id: str,
    db: Session = Depends(get_db),
    actor: User = Depends(get_current_user),
):
    n = db.get(Notification, notification_id)
    if n is None or n.user_id != actor.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Notification not found")
    if n.read_at is None:
        n.read_at = datetime.now(timezone.utc)
        db.commit()
        db.refresh(n)
    return n


@router.post("/notifications/read-all", response_model=UnreadCountOut)
def mark_all_read(db: Session = Depends(get_db), actor: User = Depends(get_current_user)):
    """Mark every unread notification for the current user as read."""
    db.execute(
        update(Notification)
        .where(Notification.user_id == actor.id, Notification.read_at.is_(None))
        .values(read_at=datetime.now(timezone.utc))
    )
    db.commit()
    return UnreadCountOut(count=0)
