import uuid
from datetime import datetime

from sqlalchemy import DateTime, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from app.db.session import Base


class Notification(Base):
    """A persistent in-app notification for a single user (PRD FR-07).

    Written on approval-workflow events (submitted, approved, rejected,
    changes_requested, publish_failed, missed_approval, reapproval_required).
    `entity_type`/`entity_id` let the UI deep-link to the related post or
    campaign. `read_at` is NULL until the user reads it (drives the unread
    badge)."""

    __tablename__ = "notifications"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    user_id: Mapped[str] = mapped_column(String(36), index=True, nullable=False)
    type: Mapped[str] = mapped_column(String(48), default="")
    title: Mapped[str] = mapped_column(String(255), default="")
    body: Mapped[str] = mapped_column(Text, default="")
    entity_type: Mapped[str] = mapped_column(String(32), default="")  # "post" | "campaign"
    entity_id: Mapped[str] = mapped_column(String(36), default="")
    # Deep-link the UI can navigate to (e.g. /campaigns/{id}). Optional.
    link: Mapped[str] = mapped_column(String(500), default="")
    read_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), index=True)
