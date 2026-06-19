from datetime import datetime

from pydantic import BaseModel, ConfigDict

from app.models.social import ChannelStatus, PublishStatus


class SocialAccountOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    client_id: str
    platform: str
    display_name: str
    username: str
    avatar_url: str
    status: ChannelStatus
    token_expires_at: datetime | None
    last_verified_at: datetime | None
    error: str
    created_at: datetime


class ChannelConnectResponse(BaseModel):
    platform: str
    connect_url: str


# --- platform-admin: Zernio integration key ---


class ZernioKeyOut(BaseModel):
    has_key: bool
    api_key_hint: str


class ZernioKeyUpdate(BaseModel):
    api_key: str = ""


# --- publishing ---


class ScheduledPostOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    post_id: str
    social_account_id: str
    post_image_id: str | None
    scheduled_at: datetime | None
    timezone: str
    status: PublishStatus
    zernio_post_id: str
    published_url: str
    error: str
    created_at: datetime


# --- scheduling (Phase 3) ---


class ScheduleRequest(BaseModel):
    scheduled_at: datetime
    timezone: str = "UTC"


class RescheduleRequest(BaseModel):
    scheduled_at: datetime
    timezone: str | None = None


class AutopilotPreviewRequest(BaseModel):
    timezone: str = "UTC"
    per_day: int = 2


class AutopilotProposal(BaseModel):
    post_id: str
    platform: str
    channel_id: str
    channel_name: str
    headline: str
    preview: str
    suggested_at: datetime
    local_label: str
    rationale: str


class AutopilotSkipped(BaseModel):
    post_id: str
    platform: str
    headline: str
    reason: str


class AutopilotPreviewResponse(BaseModel):
    proposals: list[AutopilotProposal]
    skipped: list[AutopilotSkipped]


class AutopilotCommitItem(BaseModel):
    post_id: str
    scheduled_at: datetime


class AutopilotCommitRequest(BaseModel):
    timezone: str = "UTC"
    items: list[AutopilotCommitItem]


class ReviewQueueItem(BaseModel):
    post_id: str
    campaign_id: str
    campaign_name: str
    client_id: str
    client_name: str
    platform: str
    headline: str
    preview: str
    approval_status: str
    updated_at: datetime


class CalendarItemOut(BaseModel):
    """A scheduled/published post enriched for the calendar view."""

    id: str
    status: PublishStatus
    scheduled_at: datetime | None
    timezone: str
    published_url: str
    error: str
    created_at: datetime

    post_id: str
    campaign_id: str
    campaign_name: str
    platform: str
    headline: str
    preview: str

    channel_id: str
    channel_name: str
    channel_avatar: str
