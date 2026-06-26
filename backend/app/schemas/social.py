from datetime import date, datetime

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
    social_account_id: str | None = None
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
    # When set, the post will be planned only (not approved yet, or no channel)
    # and won't auto-publish until it's ready. Empty = ready to publish on time.
    blocked_reason: str = ""


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
    """An item in the review queue — either a post or an entire campaign.

    `review_type` distinguishes: "post" (per-post approval) or "campaign"
    (campaign-level approval). For campaign items, `post_id` is empty and
    `platform` is the campaign's platform list.
    """

    review_type: str = "post"  # post | campaign
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
    assigned_approver_id: str | None = None
    approval_due_date: date | None = None
    approval_message: str = ""
    review_note: str = ""


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

    client_id: str = ""
    client_name: str = ""
    approval_status: str = ""


class ScheduleablePostOut(BaseModel):
    """An approved post that has no ScheduledPost yet — ready to be dragged
    onto the calendar to be scheduled."""

    post_id: str
    campaign_id: str
    campaign_name: str
    client_id: str
    client_name: str
    platform: str
    headline: str
    preview: str
    channel_id: str
    channel_name: str
    best_time: str = ""
    # When set, the post can't be scheduled yet (e.g. no connected channel).
    # Empty string means the post is ready to schedule.
    blocked_reason: str = ""
