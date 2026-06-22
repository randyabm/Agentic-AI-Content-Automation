"""Capability resolution + the default permission matrix.

The default matrix reproduces the platform's original role behavior, so an org that
has never edited its permissions behaves exactly as before. Stored `RolePermission`
rows override individual cells.
"""
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.permission import Capability, RolePermission
from app.models.user import OrgRole, User

C = Capability

# Default capabilities per org role. Editable per-org via the matrix.
DEFAULT_MATRIX: dict[OrgRole, set[Capability]] = {
    OrgRole.viewer: {C.view_content},
    OrgRole.creative: {C.view_content, C.edit_copy, C.edit_media, C.submit_review},
    OrgRole.reviewer: {C.view_content, C.approve_copy, C.approve_media},
    OrgRole.analyst: {
        C.view_content, C.edit_campaign, C.edit_copy, C.submit_review,
        C.schedule, C.publish, C.manage_channels,
    },
    OrgRole.org_admin: set(Capability),  # org admin always has everything
}

# Roles shown as columns in the matrix UI, in display order.
MATRIX_ROLES: list[OrgRole] = [
    OrgRole.viewer, OrgRole.creative, OrgRole.reviewer, OrgRole.analyst, OrgRole.org_admin,
]

# Capability catalog for the UI: (capability, human label, group).
CAPABILITY_CATALOG: list[tuple[Capability, str, str]] = [
    (C.view_content, "View campaigns & content", "Content"),
    (C.edit_campaign, "Create/edit campaigns", "Content"),
    (C.edit_copy, "Generate/edit copy", "Content"),
    (C.edit_media, "Generate/edit images & videos", "Content"),
    (C.submit_review, "Submit for review", "Review"),
    (C.approve_copy, "Approve/reject copy", "Review"),
    (C.approve_media, "Approve/reject images & videos", "Review"),
    (C.schedule, "Schedule", "Publishing"),
    (C.publish, "Publish (now / to channels)", "Publishing"),
    (C.manage_channels, "Connect/manage channels", "Publishing"),
    (C.manage_members, "Manage members & roles", "Admin"),
    (C.configure_permissions, "Configure permissions", "Admin"),
]


def _stored_overrides(db: Session, org_id: str) -> dict[tuple[str, str], bool]:
    rows = db.scalars(select(RolePermission).where(RolePermission.org_id == org_id)).all()
    return {(r.role, r.capability): r.allowed for r in rows}


def effective_matrix(db: Session, org_id: str) -> dict[OrgRole, set[Capability]]:
    """The org's full matrix = defaults overlaid with stored overrides."""
    overrides = _stored_overrides(db, org_id)
    result: dict[OrgRole, set[Capability]] = {}
    for role in MATRIX_ROLES:
        caps: set[Capability] = set()
        for cap in Capability:
            stored = overrides.get((role.value, cap.value))
            allowed = stored if stored is not None else (cap in DEFAULT_MATRIX.get(role, set()))
            if allowed:
                caps.add(cap)
        result[role] = caps
    return result


def capabilities_for(db: Session, user: User) -> set[str]:
    """The capability value-set granted to `user`. Platform admin and org_admin get
    everything; org members resolve through their org's matrix."""
    if user.is_platform_admin:
        return {c.value for c in Capability}
    if user.org_id is None or user.org_role is None:
        return set()
    if user.org_role == OrgRole.org_admin:
        return {c.value for c in Capability}
    overrides = _stored_overrides(db, user.org_id)
    granted: set[str] = set()
    for cap in Capability:
        stored = overrides.get((user.org_role.value, cap.value))
        allowed = stored if stored is not None else (cap in DEFAULT_MATRIX.get(user.org_role, set()))
        if allowed:
            granted.add(cap.value)
    return granted


def set_permission(db: Session, org_id: str, role: OrgRole, capability: Capability, allowed: bool) -> None:
    """Upsert a single matrix cell. org_admin cannot be stripped of capabilities."""
    if role == OrgRole.org_admin:
        return
    row = db.scalar(
        select(RolePermission).where(
            RolePermission.org_id == org_id,
            RolePermission.role == role.value,
            RolePermission.capability == capability.value,
        )
    )
    if row is None:
        db.add(RolePermission(org_id=org_id, role=role.value, capability=capability.value, allowed=allowed))
    else:
        row.allowed = allowed
