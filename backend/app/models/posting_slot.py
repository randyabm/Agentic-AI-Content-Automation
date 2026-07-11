import uuid
from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, String, func
from sqlalchemy.orm import Mapped, mapped_column

from app.db.session import Base


class PostingSlot(Base):
    """A recurring weekly publishing slot for a client (Phase 2 smart scheduling).

    "Fill slots" drops approved, unscheduled posts into the next open slot times
    so teams can batch-create content and let the system place it on the
    calendar. Slots are wall-clock local; the fill request supplies the timezone.
    """

    __tablename__ = "posting_slots"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    client_id: Mapped[str] = mapped_column(String(36), ForeignKey("clients.id", ondelete="CASCADE"), index=True)
    weekday: Mapped[int] = mapped_column(Integer, nullable=False)  # 0=Mon … 6=Sun
    hour: Mapped[int] = mapped_column(Integer, nullable=False)     # 0–23
    minute: Mapped[int] = mapped_column(Integer, default=0)        # 0–59
    # Optional platform filter ("" = any platform can use this slot).
    platform: Mapped[str] = mapped_column(String(32), default="")
    active: Mapped[bool] = mapped_column(Boolean, default=True, server_default="true", nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
