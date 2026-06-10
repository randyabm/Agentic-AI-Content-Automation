from datetime import date, datetime

from pydantic import BaseModel, ConfigDict, Field

from app.models.campaign import CampaignObjective, CampaignStatus, Platform, PostStatus, VisualFormat


class PlatformConfigIn(BaseModel):
    platform: Platform
    is_active: bool = True
    num_posts: int = Field(3, ge=1, le=20)
    images_per_post: int = Field(1, ge=1, le=10)
    visual_format: VisualFormat = VisualFormat.static_image
    carousel_slides: int = Field(3, ge=2, le=10)
    tone: str = ""
    include_cta: bool = True
    cta_text: str = ""
    hashtag_count: int = Field(5, ge=0, le=30)
    hashtag_mix: dict = Field(default_factory=lambda: {"branded": 40, "trending": 30, "niche": 30})
    emojis: str = "moderate"


class CampaignCreate(BaseModel):
    client_id: str
    name: str
    objective: CampaignObjective = CampaignObjective.awareness
    central_theme: str = ""
    content_language: str = "en"
    creativity_level: int = Field(5, ge=1, le=10)
    start_date: date | None = None
    end_date: date | None = None
    article_id: str | None = None
    article_url: str = ""
    platforms: list[PlatformConfigIn]

    # Article-to-Content mode (PRD §6 — Module 4)
    generation_mode: str = "campaign"  # campaign | article
    content_angle: str = ""            # informational | opinion | promotional | educational
    article_text: str = ""             # pasted article body
    include_article_link: bool = False
    link_format: str = "direct"        # direct | shortened | in_bio
    mention_author: bool = False
    generate_images: bool = True


class CampaignUpdate(BaseModel):
    name: str | None = None
    objective: CampaignObjective | None = None
    central_theme: str | None = None
    content_language: str | None = None
    creativity_level: int | None = Field(None, ge=1, le=10)
    start_date: date | None = None
    end_date: date | None = None


class PlatformConfigOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    platform: Platform
    is_active: bool
    num_posts: int
    images_per_post: int
    visual_format: VisualFormat
    carousel_slides: int
    tone: str
    include_cta: bool
    cta_text: str
    hashtag_count: int
    hashtag_mix: dict
    emojis: str


class PostImageOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    post_id: str
    slot_index: int
    aspect_ratio: str
    prompt: str
    negative_prompt: str
    additional_guidance: str
    prompt_history: list
    image_model_id: str | None
    base_object_key: str
    is_uploaded: bool
    generation_history: list
    canvas_state: dict
    composited_object_key: str


class PostOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    campaign_id: str
    platform: Platform
    position: int
    headline: str
    copy: str
    cta: str
    hashtags: list
    best_time: str
    rationale: str
    status: PostStatus
    images: list[PostImageOut]


class PostAssetOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    campaign_id: str
    object_key: str
    filename: str
    content_type: str


class CampaignOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    client_id: str
    name: str
    objective: CampaignObjective
    central_theme: str
    content_language: str
    creativity_level: int
    start_date: date | None
    end_date: date | None
    article_id: str | None
    article_url: str
    generation_mode: str
    content_angle: str
    article_text: str
    include_article_link: bool
    link_format: str
    mention_author: bool
    generate_images: bool
    status: CampaignStatus
    error: str
    created_at: datetime
    updated_at: datetime
    platforms: list[PlatformConfigOut]


class CampaignDetail(CampaignOut):
    posts: list[PostOut]


class CampaignListItem(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    client_id: str
    name: str
    objective: CampaignObjective
    status: CampaignStatus
    created_at: datetime
    updated_at: datetime


class PostUpdate(BaseModel):
    headline: str | None = None
    copy: str | None = None
    cta: str | None = None
    hashtags: list[str] | None = None
    best_time: str | None = None
    rationale: str | None = None


class PromptUpdate(BaseModel):
    prompt: str | None = None
    negative_prompt: str | None = None
    additional_guidance: str | None = None


class GenerateImageRequest(BaseModel):
    image_model_id: str | None = None


class CanvasUpdate(BaseModel):
    canvas_state: dict


class RegenerateRequest(BaseModel):
    """Optional parameter overrides when regenerating copy (PRD §5.6 step 22)."""

    creativity_level: int | None = Field(None, ge=1, le=10)
    central_theme: str | None = None
