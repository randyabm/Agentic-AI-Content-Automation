import enum
import uuid
from datetime import datetime

from sqlalchemy import Boolean, DateTime, Enum, ForeignKey, String, func
from sqlalchemy.orm import Mapped, mapped_column

from app.db.session import Base


class UserRole(str, enum.Enum):
    """Legacy global role — retained for backward compatibility during the
    multi-tenancy transition. New authorization uses `is_platform_admin` +
    `org_role` (see OrgRole). Do not add new logic keyed on this enum."""

    admin = "admin"
    editor = "editor"
    viewer = "viewer"


class OrgRole(str, enum.Enum):
    """A user's role *within their Organization* (tenant-scoped)."""

    org_admin = "org_admin"   # manages members, roles, client access in the org
    analyst = "analyst"       # creates clients, connects channels, sets up campaigns
    creative = "creative"     # generates/edits images & copy; cannot publish (needs review)
    reviewer = "reviewer"     # approves/rejects content; only approved content can publish
    viewer = "viewer"         # read-only


def _uuid() -> str:
    return str(uuid.uuid4())


class User(Base):
    __tablename__ = "users"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    email: Mapped[str] = mapped_column(String(255), unique=True, index=True, nullable=False)
    full_name: Mapped[str] = mapped_column(String(255), default="")
    hashed_password: Mapped[str] = mapped_column(String(255), nullable=False)
    role: Mapped[UserRole] = mapped_column(Enum(UserRole), default=UserRole.viewer, nullable=False)

    # Multi-tenancy + RBAC. Platform system admin (us/SolomoIT) is org-less and
    # owns functional config only; everyone else belongs to one org with an org_role.
    is_platform_admin: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    org_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("organizations.id", ondelete="CASCADE"), index=True, nullable=True
    )
    org_role: Mapped[OrgRole | None] = mapped_column(Enum(OrgRole), nullable=True)

    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


class RefreshToken(Base):
    __tablename__ = "refresh_tokens"

    jti: Mapped[str] = mapped_column(String(64), primary_key=True)
    user_id: Mapped[str] = mapped_column(String(36), ForeignKey("users.id"), index=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    revoked: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class PasswordResetToken(Base):
    __tablename__ = "password_reset_tokens"

    token: Mapped[str] = mapped_column(String(128), primary_key=True)
    user_id: Mapped[str] = mapped_column(String(36), ForeignKey("users.id"), index=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    used: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
