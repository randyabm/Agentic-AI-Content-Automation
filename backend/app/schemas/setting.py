from datetime import datetime

from pydantic import BaseModel, ConfigDict


class SettingOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    key: str
    value: str
    description: str
    updated_at: datetime


class SettingsUpdate(BaseModel):
    values: dict[str, str]
