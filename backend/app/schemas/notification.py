from datetime import datetime

from pydantic import BaseModel, ConfigDict


class NotificationOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    type: str
    title: str
    body: str
    entity_type: str
    entity_id: str
    link: str
    read_at: datetime | None
    created_at: datetime


class UnreadCountOut(BaseModel):
    count: int
