import enum
import uuid
from datetime import datetime

from sqlalchemy import JSON, DateTime, Enum, ForeignKey, Integer, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.session import Base


class Client(Base):
    """Client profile (PRD §3.2)."""

    __tablename__ = "clients"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    company_name: Mapped[str] = mapped_column(String(255), nullable=False)
    website_url: Mapped[str] = mapped_column(String(500), nullable=False)
    industry: Mapped[str] = mapped_column(String(255), default="")
    description: Mapped[str] = mapped_column(Text, default="")
    products_services: Mapped[str] = mapped_column(Text, default="")
    target_audience: Mapped[str] = mapped_column(Text, default="")
    value_proposition: Mapped[str] = mapped_column(Text, default="")
    business_objectives: Mapped[list] = mapped_column(JSON, default=list)
    communication_tone: Mapped[str] = mapped_column(Text, default="")
    social_media_urls: Mapped[list] = mapped_column(JSON, default=list)
    logo_object_key: Mapped[str] = mapped_column(String(500), default="")  # S3/MinIO object key
    notes: Mapped[str] = mapped_column(Text, default="")
    last_extraction_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    extraction_jobs: Mapped[list["ExtractionJob"]] = relationship(
        back_populates="client", cascade="all, delete-orphan"
    )


class JobStatus(str, enum.Enum):
    pending = "pending"
    crawling = "crawling"
    extracting = "extracting"
    awaiting_review = "awaiting_review"  # draft ready, waiting for user confirmation
    completed = "completed"              # draft confirmed and applied to the profile
    failed = "failed"


class ExtractionJob(Base):
    """A crawl + LLM extraction run for a client website (PRD §3.3)."""

    __tablename__ = "extraction_jobs"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    client_id: Mapped[str] = mapped_column(String(36), ForeignKey("clients.id"), index=True)
    status: Mapped[JobStatus] = mapped_column(Enum(JobStatus), default=JobStatus.pending)
    pages_crawled: Mapped[int] = mapped_column(Integer, default=0)
    pages_total_estimate: Mapped[int] = mapped_column(Integer, default=0)
    error: Mapped[str] = mapped_column(Text, default="")
    draft: Mapped[dict] = mapped_column(JSON, default=dict)  # LLM-extracted profile awaiting review
    created_by: Mapped[str] = mapped_column(String(36), default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    client: Mapped[Client] = relationship(back_populates="extraction_jobs")
