from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field, HttpUrl

from app.models.competitor import AnalysisStatus, CompetitorSource, SearchJobStatus


class CompetitorSearchRequest(BaseModel):
    """Search parameters per PRD §4.2."""

    num_competitors: int = Field(default=5, ge=1, le=20)
    competitor_type: str = Field(default="direct", pattern="^(direct|indirect)$")
    geographic_scope: str = Field(default="national", pattern="^(local|national|international)$")


class CompetitorCreate(BaseModel):
    website_url: HttpUrl
    company_name: str = ""  # optional; extraction fills it in if empty


class CompetitorUpdate(BaseModel):
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
    positioning: str | None = None
    strengths: list[str] | None = None
    weaknesses: list[str] | None = None


class CompetitorOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    client_id: str
    company_name: str
    website_url: str
    source: CompetitorSource
    identification_reason: str
    industry: str
    description: str
    products_services: str
    target_audience: str
    value_proposition: str
    business_objectives: list
    communication_tone: str
    social_media_urls: list
    positioning: str
    strengths: list
    weaknesses: list
    analysis_status: AnalysisStatus
    analysis_error: str
    pages_crawled: int
    analyzed_at: datetime | None
    created_at: datetime


class CompetitorSearchJobOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    client_id: str
    status: SearchJobStatus
    num_competitors: int
    competitor_type: str
    geographic_scope: str
    identified: list
    error: str
    created_at: datetime
    updated_at: datetime
