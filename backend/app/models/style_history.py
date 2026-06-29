"""StyleHistory — one row per style family actually used in a generation.

Drives the Visual Agent's repetition-penalty block ("avoid these
families") and the style_alternatives endpoint (which returns 3
families different from the ones the user has just seen).
"""
import enum
import uuid
from datetime import datetime
from typing import Optional

from sqlalchemy import DateTime, String, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.session import Base


class StyleHistorySource(str, enum.Enum):
    """Why a style_family was used — affects how the penalty weighs it."""

    generation = "generation"               # normal Visual Agent output
    style_alternatives = "style_alternatives"  # picked from the 'Make it different' popover
    manual_override = "manual_override"     # admin / user picked via StylePicker


class StyleHistory(Base):
    __tablename__ = "style_history"

    id: Mapped[str] = mapped_column(
        UUID(as_uuid=False), primary_key=True, default=lambda: str(uuid.uuid4())
    )
    org_id: Mapped[str] = mapped_column(UUID(as_uuid=False), nullable=False)
    client_id: Mapped[Optional[str]] = mapped_column(UUID(as_uuid=False), nullable=True)
    style_family: Mapped[str] = mapped_column(String(64), nullable=False)
    style_card_id: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    image_id: Mapped[Optional[str]] = mapped_column(UUID(as_uuid=False), nullable=True)
    image_prompt_hash: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    source: Mapped[str] = mapped_column(
        String(32), nullable=False, default=StyleHistorySource.generation.value
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
