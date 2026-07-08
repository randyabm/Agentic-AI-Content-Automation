from datetime import datetime

from pydantic import BaseModel, ConfigDict, EmailStr, Field

from app.models.org import OrgStatus
from app.models.user import OrgRole


class OrganizationCreate(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    slug: str | None = None  # auto-derived from name if omitted
    # Optional first org admin to bootstrap the new tenant.
    admin_email: EmailStr | None = None
    admin_full_name: str = ""
    admin_password: str | None = Field(default=None, min_length=8)


class OrganizationOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    name: str
    slug: str
    status: OrgStatus
    created_at: datetime
    member_count: int = 0
    notify_webhook_url: str = ""


class OrgSettingsUpdate(BaseModel):
    notify_webhook_url: str = ""


class OrgMemberCreate(BaseModel):
    email: EmailStr
    full_name: str = ""
    password: str = Field(min_length=8)
    org_role: OrgRole = OrgRole.viewer


class OrgMemberUpdate(BaseModel):
    full_name: str | None = None
    org_role: OrgRole | None = None
    is_active: bool | None = None
    password: str | None = Field(default=None, min_length=8)
