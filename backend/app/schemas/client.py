from datetime import datetime

from pydantic import BaseModel, ConfigDict, HttpUrl, field_validator

from app.models.client import JobStatus


class ClientCreate(BaseModel):
    company_name: str
    website_url: HttpUrl
    notes: str = ""

    @field_validator("company_name")
    @classmethod
    def name_not_blank(cls, v: str) -> str:
        if not v.strip():
            raise ValueError("Company name is required")
        return v.strip()


class ClientUpdate(BaseModel):
    company_name: str | None = None
    website_url: HttpUrl | None = None
    industry: str | None = None
    description: str | None = None
    products_services: str | None = None
    target_audience: str | None = None
    value_proposition: str | None = None
    business_objectives: list[str] | None = None
    communication_tone: str | None = None
    social_media_urls: list[str] | None = None
    notes: str | None = None


class ClientOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    company_name: str
    website_url: str
    industry: str
    description: str
    products_services: str
    target_audience: str
    value_proposition: str
    business_objectives: list
    communication_tone: str
    social_media_urls: list
    logo_object_key: str
    avatar_object_key: str
    notes: str
    brand_tone: str
    brand_words_required: list
    brand_words_forbidden: list
    brand_colors: list
    brand_visual_style: str
    brand_copy_examples: list
    brand_legal_disclaimer: str
    last_extraction_at: datetime | None
    created_at: datetime
    updated_at: datetime


class BrandMemoryUpdate(BaseModel):
    """Brand Memory fields (PRD §5.3.3). Each save creates a version snapshot."""

    brand_tone: str = ""
    brand_words_required: list[str] = []
    brand_words_forbidden: list[str] = []
    brand_colors: list[str] = []
    brand_visual_style: str = ""
    brand_copy_examples: list[str] = []
    brand_legal_disclaimer: str = ""


class BrandMemoryVersionOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    client_id: str
    snapshot: dict
    created_at: datetime


class ExtractionJobOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    client_id: str
    status: JobStatus
    pages_crawled: int
    pages_total_estimate: int
    error: str
    draft: dict
    created_at: datetime
    updated_at: datetime


class ExtractionConfirm(BaseModel):
    """User-reviewed (possibly edited) extracted fields to apply to the profile."""

    industry: str = ""
    description: str = ""
    products_services: str = ""
    target_audience: str = ""
    value_proposition: str = ""
    business_objectives: list[str] = []
    communication_tone: str = ""
    social_media_urls: list[str] = []
    company_name: str | None = None
