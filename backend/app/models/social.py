"""Connected social accounts (channels) — Phase 1 of SOCIAL_PUBLISHING_PLAN.md.

A SocialAccount is a single social profile (a Facebook Page, an Instagram
Business account, …) that an org has connected, through Zernio, to one of its
clients. Zernio is the OAuth/token middleman: it holds the platform tokens and
exposes an account id + live health (status, token expiry) that we mirror here.
"""
import enum
import uuid
from datetime import datetime

from sqlalchemy import DateTime, Enum, ForeignKey, Integer, String, Text, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.db.session import Base


class ChannelStatus(str, enum.Enum):
    connected = "connected"   # active and healthy
    expired = "expired"       # token expired — needs reconnect
    revoked = "revoked"       # user/platform revoked access
    error = "error"           # last sync/verify failed
    disconnected = "disconnected"


class SocialAccount(Base):
    __tablename__ = "social_accounts"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    client_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("clients.id", ondelete="CASCADE"), index=True
    )
    platform: Mapped[str] = mapped_column(String(40), nullable=False)  # facebook, instagram, ...

    # Identifiers on Zernio's side (the middleman).
    zernio_account_id: Mapped[str] = mapped_column(String(64), index=True, default="")
    zernio_profile_id: Mapped[str] = mapped_column(String(64), default="")

    # Mirrored display + health, refreshed on sync/verify.
    display_name: Mapped[str] = mapped_column(String(255), default="")
    username: Mapped[str] = mapped_column(String(255), default="")
    avatar_url: Mapped[str] = mapped_column(Text, default="")
    status: Mapped[ChannelStatus] = mapped_column(Enum(ChannelStatus), default=ChannelStatus.connected)
    token_expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    last_verified_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    error: Mapped[str] = mapped_column(Text, default="")

    # Direct-mode OAuth tokens (encrypted). zernio_* columns remain for Zernio mode.
    access_token_encrypted: Mapped[str] = mapped_column(Text, default="")
    access_token_secret_encrypted: Mapped[str] = mapped_column(Text, default="")  # Twitter OAuth 1.0a
    refresh_token_encrypted: Mapped[str] = mapped_column(Text, default="")
    platform_account_id: Mapped[str] = mapped_column(String(255), default="")  # native ID (page_id, etc.)

    connected_by: Mapped[str] = mapped_column(String(36), default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


class PublishStatus(str, enum.Enum):
    scheduled = "scheduled"    # due in the future (Phase 3 calendar)
    publishing = "publishing"  # handed to the connector, awaiting result
    published = "published"
    failed = "failed"
    retrying = "retrying"      # transient failure, will be retried (next_attempt_at)
    throttled = "throttled"    # skipped this tick — daily limit / min gap reached


class ScheduledPost(Base):
    """A publish/schedule of one Post to one connected channel — immediate
    (scheduled_at NULL) or future-dated. Tracks the Zernio result + permalink."""

    __tablename__ = "scheduled_posts"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    post_id: Mapped[str] = mapped_column(String(36), ForeignKey("posts.id", ondelete="CASCADE"), index=True)
    # Nullable: a "planned" schedule (approved post with no connected channel yet)
    # has no target account. The due sweep skips these until a channel exists.
    social_account_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("social_accounts.id", ondelete="CASCADE"), index=True, nullable=True
    )
    # The chosen rendition (one of these), if any. Text-only posts have neither.
    post_image_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    post_video_id: Mapped[str | None] = mapped_column(String(36), nullable=True)

    scheduled_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    timezone: Mapped[str] = mapped_column(String(64), default="UTC")

    status: Mapped[PublishStatus] = mapped_column(Enum(PublishStatus), default=PublishStatus.scheduled)
    zernio_post_id: Mapped[str] = mapped_column(String(64), index=True, default="")
    external_post_id: Mapped[str] = mapped_column(String(255), default="")  # platform-native ID for direct mode
    published_url: Mapped[str] = mapped_column(Text, default="")
    error: Mapped[str] = mapped_column(Text, default="")

    # --- Publishing safeguards (migration 007) ----------------------------
    # Retry accounting + a gate (next_attempt_at) for the due sweep. error_code
    # uses a short taxonomy (rate_limited / auth_expired / spam_blocked /
    # transient / permanent / duplicate / daily_limit_reached) so the UI can
    # show friendly messages and the worker can decide to retry or fail.
    retry_count: Mapped[int] = mapped_column(Integer, default=0, server_default="0", nullable=False)
    max_retries: Mapped[int] = mapped_column(Integer, default=4, server_default="4", nullable=False)
    next_attempt_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    last_attempt_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    error_code: Mapped[str] = mapped_column(String(40), default="", server_default="", nullable=False)
    # sha256 of normalized text + sorted media keys — for duplicate detection.
    content_hash: Mapped[str] = mapped_column(String(64), default="", server_default="", nullable=False)
    # Append-only log of every publish attempt: [{at, status, error_code, error}].
    attempt_history: Mapped[list] = mapped_column(JSONB, default=list, server_default="[]", nullable=False)

    created_by: Mapped[str] = mapped_column(String(36), default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )
