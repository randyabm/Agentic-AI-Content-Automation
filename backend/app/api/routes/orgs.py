"""Organization & membership management (Phase 0 — multi-tenancy).

- Platform admin (us) creates and lists organizations and can bootstrap a first
  org admin for each tenant.
- Org admins manage members and roles *within their own organization only*.
"""
import re

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.api.deps import get_current_user, require_capability, require_org_admin, require_platform_admin
from app.core.security import hash_password
from app.db.session import get_db
from app.models.org import Organization
from app.models.permission import Capability
from app.models.user import OrgRole, User, UserRole
from app.schemas.org import (
    OrganizationCreate,
    OrganizationOut,
    OrgMemberCreate,
    OrgMemberUpdate,
    OrgSettingsUpdate,
)
from app.schemas.permission import CapabilityInfo, PermissionMatrixOut, PermissionUpdate
from app.schemas.user import UserOut
from app.services import audit
from app.services.permissions import (
    CAPABILITY_CATALOG,
    MATRIX_ROLES,
    effective_matrix,
    set_permission,
)

router = APIRouter(prefix="/orgs", tags=["organizations"])


def _slugify(value: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", value.lower()).strip("-")
    return slug or "org"


def _unique_slug(db: Session, base: str) -> str:
    slug = _slugify(base)
    candidate, n = slug, 2
    while db.scalar(select(Organization).where(Organization.slug == candidate)):
        candidate = f"{slug}-{n}"
        n += 1
    return candidate


def _member_count(db: Session, org_id: str) -> int:
    return db.scalar(select(func.count()).select_from(User).where(User.org_id == org_id)) or 0


def _out(db: Session, org: Organization) -> OrganizationOut:
    data = OrganizationOut.model_validate(org)
    data.member_count = _member_count(db, org.id)
    return data


def _require_org(db: Session, org_id: str, user: User) -> Organization:
    """Load an org and enforce access: platform admin anywhere, org admin only
    within their own org."""
    org = db.get(Organization, org_id)
    if org is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Organization not found")
    if not user.is_platform_admin and user.org_id != org.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Organization not found")
    return org


# --- Organizations (platform admin) ---


@router.get("", response_model=list[OrganizationOut])
def list_orgs(db: Session = Depends(get_db), _: User = Depends(require_platform_admin)):
    orgs = db.scalars(select(Organization).order_by(Organization.created_at)).all()
    return [_out(db, o) for o in orgs]


@router.post("", response_model=OrganizationOut, status_code=status.HTTP_201_CREATED)
def create_org(body: OrganizationCreate, db: Session = Depends(get_db), actor: User = Depends(require_platform_admin)):
    org = Organization(name=body.name, slug=_unique_slug(db, body.slug or body.name))
    db.add(org)
    db.flush()

    # Optionally bootstrap the first org admin.
    if body.admin_email and body.admin_password:
        email = body.admin_email.lower()
        if db.scalar(select(User).where(User.email == email)):
            raise HTTPException(status.HTTP_409_CONFLICT, "A user with this email already exists")
        db.add(
            User(
                email=email,
                full_name=body.admin_full_name,
                hashed_password=hash_password(body.admin_password),
                role=UserRole.admin,  # legacy field kept in sync
                org_id=org.id,
                org_role=OrgRole.org_admin,
            )
        )
    db.commit()
    audit.record(db, actor, "org.create", "organization", org.id, {"name": org.name})
    db.refresh(org)
    return _out(db, org)


@router.get("/me", response_model=OrganizationOut)
def my_org(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    """The caller's own organization (platform admins have none → 404)."""
    if user.org_id is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "You are not a member of an organization")
    org = db.get(Organization, user.org_id)
    if org is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Organization not found")
    return _out(db, org)


@router.patch("/{org_id}/settings", response_model=OrganizationOut)
def update_org_settings(
    org_id: str,
    body: OrgSettingsUpdate,
    db: Session = Depends(get_db),
    user: User = Depends(require_org_admin),
):
    """Update org-level settings (Slack/Teams webhook URL, Phase 3)."""
    org = _require_org(db, org_id, user)
    org.notify_webhook_url = (body.notify_webhook_url or "").strip()
    db.commit()
    db.refresh(org)
    return _out(db, org)


# --- Members (org admin within own org, or platform admin) ---


@router.get("/{org_id}/members", response_model=list[UserOut])
def list_members(org_id: str, db: Session = Depends(get_db), user: User = Depends(require_org_admin)):
    _require_org(db, org_id, user)
    return db.scalars(
        select(User).where(User.org_id == org_id).order_by(User.created_at)
    ).all()


@router.post("/{org_id}/members", response_model=UserOut, status_code=status.HTTP_201_CREATED)
def add_member(
    org_id: str, body: OrgMemberCreate, db: Session = Depends(get_db), actor: User = Depends(require_org_admin)
):
    _require_org(db, org_id, actor)
    email = body.email.lower()
    if db.scalar(select(User).where(User.email == email)):
        raise HTTPException(status.HTTP_409_CONFLICT, "A user with this email already exists")
    member = User(
        email=email,
        full_name=body.full_name,
        hashed_password=hash_password(body.password),
        role=UserRole.editor,  # legacy field; org_role is authoritative
        org_id=org_id,
        org_role=body.org_role,
    )
    db.add(member)
    db.commit()
    audit.record(db, actor, "org.member_add", "user", member.id, {"org_id": org_id, "org_role": body.org_role.value})
    return member


@router.patch("/{org_id}/members/{user_id}", response_model=UserOut)
def update_member(
    org_id: str,
    user_id: str,
    body: OrgMemberUpdate,
    db: Session = Depends(get_db),
    actor: User = Depends(require_org_admin),
):
    _require_org(db, org_id, actor)
    member = db.get(User, user_id)
    if member is None or member.org_id != org_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Member not found")
    changes = body.model_dump(exclude_unset=True)
    if "password" in changes:
        member.hashed_password = hash_password(changes.pop("password"))
    for field, value in changes.items():
        setattr(member, field, value)
    db.commit()
    audit.record(db, actor, "org.member_update", "user", member.id, {k: str(v) for k, v in changes.items()})
    return member


# --- Permission matrix (configure_permissions; org_admin by default) ---


def _matrix_out(db: Session, org_id: str) -> PermissionMatrixOut:
    matrix = effective_matrix(db, org_id)
    grid = {role: {cap: (cap in caps) for cap in Capability} for role, caps in matrix.items()}
    capabilities = [CapabilityInfo(key=cap, label=label, group=group) for cap, label, group in CAPABILITY_CATALOG]
    return PermissionMatrixOut(roles=MATRIX_ROLES, capabilities=capabilities, grid=grid)


@router.get("/{org_id}/permissions", response_model=PermissionMatrixOut)
def get_permissions(
    org_id: str,
    db: Session = Depends(get_db),
    actor: User = Depends(require_capability(Capability.configure_permissions)),
):
    _require_org(db, org_id, actor)
    return _matrix_out(db, org_id)


@router.put("/{org_id}/permissions", response_model=PermissionMatrixOut)
def update_permissions(
    org_id: str,
    body: PermissionUpdate,
    db: Session = Depends(get_db),
    actor: User = Depends(require_capability(Capability.configure_permissions)),
):
    _require_org(db, org_id, actor)
    for cell in body.updates:
        set_permission(db, org_id, cell.role, cell.capability, cell.allowed)
    db.commit()
    audit.record(db, actor, "org.permissions_update", "organization", org_id, {"cells": len(body.updates)})
    return _matrix_out(db, org_id)
