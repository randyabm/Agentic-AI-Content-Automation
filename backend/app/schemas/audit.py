from datetime import datetime

from pydantic import BaseModel, ConfigDict


class AuditLogOut(BaseModel):
    """One row from the audit log. Surfaced both to the platform admin (global
    view in System Settings) and to entity owners via per-entity endpoints
    like `GET /clients/{id}/audit-log`."""

    model_config = ConfigDict(from_attributes=True)

    id: str
    user_email: str = ""
    action: str                  # e.g. "client.create", "campaign.approve", "post.submit"
    entity_type: str             # e.g. "client", "campaign", "post"
    entity_id: str = ""
    detail: dict = {}
    created_at: datetime
