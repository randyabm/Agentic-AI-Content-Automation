"""In-app + email notifications for approval-workflow events (PRD FR-07).

`notify()` writes a persistent Notification row (drives the bell/unread badge)
and, when `send_email=True`, also sends a best-effort email via services.email.
Callers own the transaction — notify() adds rows but does not commit.
"""
from __future__ import annotations

import logging

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.notification import Notification
from app.models.user import OrgRole, User
from app.services import email as email_service

logger = logging.getLogger(__name__)


def notify(
    db: Session,
    *,
    user_id: str | None,
    type: str,
    title: str,
    body: str = "",
    entity_type: str = "",
    entity_id: str = "",
    link: str = "",
    send_email: bool = False,
) -> Notification | None:
    """Create one in-app notification (+ optional email). No-op without a user."""
    if not user_id:
        return None
    n = Notification(
        user_id=user_id, type=type, title=title, body=body,
        entity_type=entity_type, entity_id=entity_id, link=link,
    )
    db.add(n)
    if send_email:
        user = db.get(User, user_id)
        if user and user.email:
            text = body if not link else f"{body}\n\n{link}".strip()
            try:
                email_service.send_email(user.email, title, text)
            except Exception:  # best-effort — never fail the request on email
                logger.exception("notification email to %s failed", user.email)
    return n


def notify_many(db: Session, *, user_ids, **kwargs) -> None:
    """Fan out the same notification to several users (deduplicated)."""
    for uid in {u for u in user_ids if u}:
        notify(db, user_id=uid, **kwargs)


def reviewer_ids(db: Session, org_id: str | None, exclude: str | None = None) -> list[str]:
    """User ids in the org who can act on reviews (reviewers + org admins).

    A pragmatic stand-in for full capability resolution — the approver
    assignment on a campaign takes precedence when present."""
    if not org_id:
        return []
    rows = db.scalars(
        select(User.id).where(
            User.org_id == org_id,
            User.is_active.is_(True),
            User.org_role.in_((OrgRole.reviewer, OrgRole.org_admin)),
        )
    ).all()
    return [uid for uid in rows if uid != exclude]
