"""Organization (tenant) model — the multi-tenancy root.

Every Client belongs to an Organization; users (except the platform system
admin) belong to exactly one Organization and only ever see that org's data.
The platform system admin is org-less (`is_platform_admin=True`, `org_id=NULL`)
and owns the functional configuration (AI keys, image/video models, the Zernio
key, global settings) — never an org's content.
"""
import enum
import uuid
from datetime import datetime

from sqlalchemy import DateTime, Enum, String, func
from sqlalchemy.orm import Mapped, mapped_column

from app.db.session import Base


class OrgStatus(str, enum.Enum):
    active = "active"


class Organization(Base):
    __tablename__ = "organizations"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    slug: Mapped[str] = mapped_column(String(120), unique=True, index=True, nullable=False)
    status: Mapped[OrgStatus] = mapped_column(Enum(OrgStatus), default=OrgStatus.active, nullable=False)
    # Optional Slack/Teams incoming-webhook URL — approval events are also
    # posted here (Phase 3). Both platforms accept a simple {"text": ...} body.
    notify_webhook_url: Mapped[str] = mapped_column(String(500), default="", server_default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )
