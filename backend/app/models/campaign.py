"""Social Media Campaign Generation models (PRD §5 — Module 3).

A Campaign belongs to a client and targets one or more platforms. Each active
platform holds its own per-platform parameters (§5.3.2) and a set of Posts. Each
Post carries the Editorial Agent output (copy/hashtags/CTA) and one or more
PostImage slots, each carrying the Visual Agent prompt plus the Image Editor
canvas state (logo + uploaded asset layers).
"""
import enum
import uuid
from datetime import date, datetime

from sqlalchemy import JSON, Boolean, Date, DateTime, Enum, Float, ForeignKey, Integer, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.session import Base


class Platform(str, enum.Enum):
    facebook = "facebook"
    instagram = "instagram"
    linkedin = "linkedin"
    tiktok = "tiktok"
    x = "x"
    youtube = "youtube"


class CampaignObjective(str, enum.Enum):
    awareness = "awareness"
    consideration = "consideration"
    conversion = "conversion"
    retention = "retention"
    launch = "launch"
    promotion = "promotion"


class VisualFormat(str, enum.Enum):
    static_image = "static_image"
    carousel = "carousel"


class CampaignStatus(str, enum.Enum):
    draft = "draft"            # created, not yet generated
    generating = "generating"  # agents running
    ready = "ready"            # generation complete
    failed = "failed"


class PostStatus(str, enum.Enum):
    pending = "pending"
    generating = "generating"
    ready = "ready"
    failed = "failed"


class Campaign(Base):
    __tablename__ = "campaigns"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    client_id: Mapped[str] = mapped_column(String(36), ForeignKey("clients.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    objective: Mapped[CampaignObjective] = mapped_column(Enum(CampaignObjective), default=CampaignObjective.awareness)
    central_theme: Mapped[str] = mapped_column(Text, default="")
    content_language: Mapped[str] = mapped_column(String(20), default="en")
    creativity_level: Mapped[int] = mapped_column(Integer, default=5)  # 1–10, mapped to LLM temperature
    start_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    end_date: Mapped[date | None] = mapped_column(Date, nullable=True)

    # Article reference (PRD §5.3 / §6 / §7) — optional link to a library article or external URL.
    article_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("articles.id", ondelete="SET NULL"), nullable=True)
    article_url: Mapped[str] = mapped_column(String(1000), default="")

    status: Mapped[CampaignStatus] = mapped_column(Enum(CampaignStatus), default=CampaignStatus.draft)
    error: Mapped[str] = mapped_column(Text, default="")
    created_by: Mapped[str] = mapped_column(String(36), default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    platforms: Mapped[list["CampaignPlatform"]] = relationship(
        back_populates="campaign", cascade="all, delete-orphan"
    )
    posts: Mapped[list["Post"]] = relationship(back_populates="campaign", cascade="all, delete-orphan")


class CampaignPlatform(Base):
    """Per-platform configuration within a campaign (PRD §5.3.2)."""

    __tablename__ = "campaign_platforms"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    campaign_id: Mapped[str] = mapped_column(String(36), ForeignKey("campaigns.id", ondelete="CASCADE"), index=True)
    platform: Mapped[Platform] = mapped_column(Enum(Platform), nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    num_posts: Mapped[int] = mapped_column(Integer, default=3)
    images_per_post: Mapped[int] = mapped_column(Integer, default=1)
    visual_format: Mapped[VisualFormat] = mapped_column(Enum(VisualFormat), default=VisualFormat.static_image)
    carousel_slides: Mapped[int] = mapped_column(Integer, default=3)
    tone: Mapped[str] = mapped_column(Text, default="")          # platform-specific tone override
    include_cta: Mapped[bool] = mapped_column(Boolean, default=True)
    cta_text: Mapped[str] = mapped_column(String(500), default="")  # suggested CTA text (optional)
    hashtag_count: Mapped[int] = mapped_column(Integer, default=5)
    # {"branded": int, "trending": int, "niche": int} percentages, must total 100
    hashtag_mix: Mapped[dict] = mapped_column(JSON, default=lambda: {"branded": 40, "trending": 30, "niche": 30})
    emojis: Mapped[str] = mapped_column(String(20), default="moderate")  # none | moderate | abundant

    campaign: Mapped[Campaign] = relationship(back_populates="platforms")


class Post(Base):
    """A single social post produced by the Editorial Agent (PRD §5.4 Agent 1)."""

    __tablename__ = "posts"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    campaign_id: Mapped[str] = mapped_column(String(36), ForeignKey("campaigns.id", ondelete="CASCADE"), index=True)
    platform: Mapped[Platform] = mapped_column(Enum(Platform), nullable=False)
    position: Mapped[int] = mapped_column(Integer, default=0)  # post index within the platform

    headline: Mapped[str] = mapped_column(Text, default="")     # opening hook
    copy: Mapped[str] = mapped_column(Text, default="")         # main post copy
    cta: Mapped[str] = mapped_column(Text, default="")
    hashtags: Mapped[list] = mapped_column(JSON, default=list)
    best_time: Mapped[str] = mapped_column(String(255), default="")  # suggested posting time
    rationale: Mapped[str] = mapped_column(Text, default="")          # strategic rationale

    status: Mapped[PostStatus] = mapped_column(Enum(PostStatus), default=PostStatus.pending)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    campaign: Mapped[Campaign] = relationship(back_populates="posts")
    images: Mapped[list["PostImage"]] = relationship(
        back_populates="post", cascade="all, delete-orphan", order_by="PostImage.slot_index"
    )


class PostImage(Base):
    """An image slot for a post (PRD §5.4 Agent 2 + §5.5 Image Editor).

    Holds the editable Visual Agent prompt, the generated/uploaded base image, the
    generation history, and the Image Editor canvas state (logo + asset layers).
    """

    __tablename__ = "post_images"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    post_id: Mapped[str] = mapped_column(String(36), ForeignKey("posts.id", ondelete="CASCADE"), index=True)
    slot_index: Mapped[int] = mapped_column(Integer, default=0)  # 0..n for carousel/multi-image
    aspect_ratio: Mapped[str] = mapped_column(String(20), default="1:1")

    prompt: Mapped[str] = mapped_column(Text, default="")               # current editable image prompt
    negative_prompt: Mapped[str] = mapped_column(Text, default="")      # current editable negative prompt
    additional_guidance: Mapped[str] = mapped_column(Text, default="")  # appended supplementary guidance
    # [{prompt, negative_prompt, created_at}] — restorable prompt history (§5.5.3)
    prompt_history: Mapped[list] = mapped_column(JSON, default=list)

    image_model_id: Mapped[str | None] = mapped_column(String(36), nullable=True)  # ImageModel used
    base_object_key: Mapped[str] = mapped_column(String(500), default="")  # current generated/uploaded image
    is_uploaded: Mapped[bool] = mapped_column(Boolean, default=False)
    # [{object_key, prompt, created_at}] — all generated versions (§5.5.4)
    generation_history: Mapped[list] = mapped_column(JSON, default=list)

    # Image Editor canvas state (§5.5.1–5.5.2). Coordinates are relative (0..1) to
    # the base image so they composite correctly at full resolution on export.
    # {"logo": {x,y,scale,opacity,locked,visible}, "assets": [{asset_id,x,y,scale,rotation,opacity,z,visible}]}
    canvas_state: Mapped[dict] = mapped_column(JSON, default=dict)
    composited_object_key: Mapped[str] = mapped_column(String(500), default="")  # final flattened image

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    post: Mapped[Post] = relationship(back_populates="images")


class PostAsset(Base):
    """A custom overlay asset uploaded for the Image Editor (PRD §5.5.2).

    Scoped to the campaign so it can be reused across posts in the same campaign.
    """

    __tablename__ = "post_assets"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    campaign_id: Mapped[str] = mapped_column(String(36), ForeignKey("campaigns.id", ondelete="CASCADE"), index=True)
    object_key: Mapped[str] = mapped_column(String(500), nullable=False)
    filename: Mapped[str] = mapped_column(String(255), default="")
    content_type: Mapped[str] = mapped_column(String(100), default="")
    created_by: Mapped[str] = mapped_column(String(36), default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
