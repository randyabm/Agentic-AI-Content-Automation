"""Authentication and RBAC dependencies (PRD §8 — enforced server-side).

Two authorization axes (SOCIAL_PUBLISHING_PLAN.md):
  * Platform axis  — `is_platform_admin` (us/SolomoIT): functional config only.
  * Org axis       — `org_role` within `org_id`: tenant-scoped content access.

Tenant isolation is enforced through the client root: every client-scoped
resource is reachable only by a member of the owning org (`require_client`).
"""
import jwt as pyjwt
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.orm import Session

from app.core.security import decode_token
from app.db.session import get_db
from app.models.client import Client
from app.models.user import OrgRole, User, UserRole

bearer_scheme = HTTPBearer(auto_error=False)


def get_current_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
    db: Session = Depends(get_db),
) -> User:
    if credentials is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Not authenticated")
    try:
        payload = decode_token(credentials.credentials, expected_type="access")
    except pyjwt.PyJWTError:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid or expired token")
    user = db.get(User, payload["sub"])
    if user is None or not user.is_active:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "User not found or inactive")
    return user


def require_roles(*roles: UserRole):
    def checker(user: User = Depends(get_current_user)) -> User:
        if user.role not in roles:
            raise HTTPException(status.HTTP_403_FORBIDDEN, "Insufficient permissions")
        return user

    return checker


require_admin = require_roles(UserRole.admin)
require_editor = require_roles(UserRole.admin, UserRole.editor)


# --- Multi-tenancy / org-scoped RBAC ---


def require_platform_admin(user: User = Depends(get_current_user)) -> User:
    """The platform system admin (us) — owns functional config (AI keys, models,
    Zernio key, global settings). Not a member of any org."""
    if not user.is_platform_admin:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Platform admin only")
    return user


def require_org_member(user: User = Depends(get_current_user)) -> User:
    """Any user acting within an organization (must belong to one)."""
    if user.org_id is None:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Not a member of any organization")
    return user


def require_org_roles(*roles: OrgRole):
    """Require one of the given org roles. org_admin always passes."""

    allowed = {OrgRole.org_admin, *roles}

    def checker(user: User = Depends(require_org_member)) -> User:
        if user.org_role not in allowed:
            raise HTTPException(status.HTTP_403_FORBIDDEN, "Insufficient permissions")
        return user

    return checker


require_org_admin = require_org_roles(OrgRole.org_admin)
# Roles allowed to create/modify content (campaigns, channels, clients).
require_content_editor = require_org_roles(OrgRole.analyst, OrgRole.creative)


def require_org_roles_or_platform(*roles: OrgRole):
    """Like require_org_roles but also allows the platform admin (super-admin).
    org_admin always passes. Used by the approval workflow."""

    allowed = {OrgRole.org_admin, *roles}

    def checker(user: User = Depends(get_current_user)) -> User:
        if user.is_platform_admin:
            return user
        if user.org_id is None or user.org_role not in allowed:
            raise HTTPException(status.HTTP_403_FORBIDDEN, "Insufficient permissions")
        return user

    return checker


# Approvers: reviewers (and org admins / platform admin) gate publishing.
require_reviewer = require_org_roles_or_platform(OrgRole.reviewer)
# Contributors who may draft/submit content for review.
require_contributor = require_org_roles_or_platform(OrgRole.analyst, OrgRole.creative, OrgRole.reviewer)


def assert_client_access(user: User, client: Client) -> None:
    """Raise 404 if `user` may not access `client`. Client/brand data belongs to
    org members only — the platform super-admin manages system configuration, not
    tenant content, so it has NO client access. 404 (not 403) avoids leaking the
    existence of other tenants' clients."""
    if user.org_id is None or client.org_id != user.org_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Client not found")


def require_client(client_id: str, db: Session = Depends(get_db), user: User = Depends(get_current_user)) -> Client:
    """Dependency: load a client and enforce org access. Use on every
    client-scoped route (directly, or as a router-level dependency)."""
    client = db.get(Client, client_id)
    if client is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Client not found")
    assert_client_access(user, client)
    return client


def org_client_filter(user: User):
    """A SQLAlchemy WHERE condition restricting `Client` rows to the user's own org.
    The platform super-admin has no org, so this yields no client rows for them
    (they don't work with brand/client data). Apply to list queries."""
    return Client.org_id == user.org_id
