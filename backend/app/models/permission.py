"""Configurable per-role capability matrix (RBAC).

Capabilities are decoupled from roles: each Organization stores, per OrgRole, which
capabilities are allowed. The Org Admin edits this matrix; resolution falls back to
sensible defaults (see `services/permissions.py`) for any cell not explicitly stored,
so existing orgs keep working without a backfill.

Role and capability are stored as plain strings (the enum `.value`) to keep the SQL
migration simple and avoid Postgres enum-type churn.
"""
import enum
import uuid
from datetime import datetime

from sqlalchemy import Boolean, DateTime, String, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column

from app.db.session import Base


class Capability(str, enum.Enum):
    """Stable capability keys gated server-side. Do not rename existing values."""

    view_content = "view_content"            # see campaigns & content
    edit_campaign = "edit_campaign"          # create/edit campaign setup
    edit_copy = "edit_copy"                  # generate/edit post copy
    edit_media = "edit_media"                # generate/edit images & videos
    submit_review = "submit_review"          # send content to review
    approve_copy = "approve_copy"            # approve/reject copy
    approve_media = "approve_media"          # approve/reject images & videos
    schedule = "schedule"                    # place approved content on the calendar
    publish = "publish"                      # publish now / send to channels
    manage_channels = "manage_channels"      # connect/manage social channels
    manage_members = "manage_members"        # manage org members & role assignments
    configure_permissions = "configure_permissions"  # edit this matrix
    approve_campaign = "approve_campaign"    # approve/reject entire campaigns


class RolePermission(Base):
    """One (org, role, capability) → allowed cell. Rows are sparse: a missing cell
    falls back to the default matrix."""

    __tablename__ = "role_permissions"
    __table_args__ = (
        UniqueConstraint("org_id", "role", "capability", name="uq_role_permission"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    org_id: Mapped[str] = mapped_column(String(36), index=True, nullable=False)
    role: Mapped[str] = mapped_column(String(50), nullable=False)
    capability: Mapped[str] = mapped_column(String(50), nullable=False)
    allowed: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )
