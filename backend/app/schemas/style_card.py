"""Pydantic schemas for style_cards CRUD."""
from datetime import datetime
from typing import Optional

from pydantic import BaseModel, ConfigDict, Field


class StyleCardOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    name: str
    family: str
    description: str
    best_for: list[str]
    not_for: list[str]
    visual_cues: list[str]
    negative_constraints: list[str]
    is_global: bool
    brand_id: Optional[str] = None
    is_active: bool
    created_at: datetime
    updated_at: datetime


class StyleCardCreate(BaseModel):
    id: str = Field(..., min_length=1, max_length=64,
                    description="Stable slug, e.g. 'bold_typographic' or 'i4t_bold_v2'.")
    name: str = Field(..., min_length=1, max_length=128)
    family: str = Field(..., min_length=1, max_length=64)
    description: str = ""
    best_for: list[str] = []
    not_for: list[str] = []
    visual_cues: list[str] = []
    negative_constraints: list[str] = []
    is_global: bool = True
    brand_id: Optional[str] = None
    is_active: bool = True


class StyleCardUpdate(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1, max_length=128)
    description: Optional[str] = None
    best_for: Optional[list[str]] = None
    not_for: Optional[list[str]] = None
    visual_cues: Optional[list[str]] = None
    negative_constraints: Optional[list[str]] = None
    is_global: Optional[bool] = None
    is_active: Optional[bool] = None
