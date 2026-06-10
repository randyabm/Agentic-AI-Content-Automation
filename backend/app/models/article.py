import enum
import uuid
from datetime import date, datetime

from sqlalchemy import JSON, Boolean, Date, DateTime, Enum, ForeignKey, Integer, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from app.db.session import Base


class ArticleEntryType(str, enum.Enum):
    auto = "auto"      # imported by auto-sync
    manual = "manual"  # added by a user


class ArticleStatus(str, enum.Enum):
    active = "active"
    archived = "archived"


class SyncFrequency(str, enum.Enum):
    daily = "daily"
    weekly = "weekly"
    on_demand = "on_demand"


class Article(Base):
    """Internal Article Library entry (PRD §7.3)."""

    __tablename__ = "articles"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    title: Mapped[str] = mapped_column(String(500), default="")
    author: Mapped[str] = mapped_column(String(255), default="")
    publication_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    source_url: Mapped[str] = mapped_column(String(1000), default="", index=True)
    summary: Mapped[str] = mapped_column(Text, default="")          # 200-400 words
    body: Mapped[str] = mapped_column(Text, default="")             # full body text
    tags: Mapped[list] = mapped_column(JSON, default=list)          # topics / tags

    entry_type: Mapped[ArticleEntryType] = mapped_column(Enum(ArticleEntryType), default=ArticleEntryType.manual)
    status: Mapped[ArticleStatus] = mapped_column(Enum(ArticleStatus), default=ArticleStatus.active)
    # When an auto-synced source is set to "queue for review", new articles land
    # here flagged for an Editor/Admin to approve before they are usable.
    needs_review: Mapped[bool] = mapped_column(Boolean, default=False)

    source_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("article_sources.id", ondelete="SET NULL"), nullable=True
    )
    last_used_in_campaign: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


class ArticleSource(Base):
    """An auto-sync source pointing at a company blog/article section (PRD §7.4)."""

    __tablename__ = "article_sources"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    name: Mapped[str] = mapped_column(String(255), default="")
    url: Mapped[str] = mapped_column(String(1000), nullable=False)
    frequency: Mapped[SyncFrequency] = mapped_column(Enum(SyncFrequency), default=SyncFrequency.weekly)
    max_articles_per_sync: Mapped[int] = mapped_column(Integer, default=50)
    auto_publish: Mapped[bool] = mapped_column(Boolean, default=False)  # False => queue for review
    duplicate_detection: Mapped[bool] = mapped_column(Boolean, default=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    last_synced_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    last_sync_status: Mapped[str] = mapped_column(String(50), default="")  # idle | running | ok | error
    last_sync_detail: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )
