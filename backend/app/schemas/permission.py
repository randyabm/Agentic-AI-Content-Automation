from pydantic import BaseModel

from app.models.permission import Capability
from app.models.user import OrgRole


class CapabilityInfo(BaseModel):
    key: Capability
    label: str
    group: str


class PermissionMatrixOut(BaseModel):
    """The org's full matrix for the admin grid. `grid[role][capability] = allowed`.
    The `org_admin` row is always all-true and not editable."""

    roles: list[OrgRole]
    capabilities: list[CapabilityInfo]
    grid: dict[OrgRole, dict[Capability, bool]]


class PermissionCell(BaseModel):
    role: OrgRole
    capability: Capability
    allowed: bool


class PermissionUpdate(BaseModel):
    updates: list[PermissionCell]
