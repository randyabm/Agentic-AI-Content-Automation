import enum
import uuid
from datetime import datetime

from sqlalchemy import JSON, DateTime, Enum, ForeignKey, Integer, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from app.db.session import Base


class CompetitorSource(str, enum.Enum):
    auto = "auto"      # identified by LLM + web search
    manual = "manual"  # added by a user via URL


class AnalysisStatus(str, enum.Enum):
    pending = "pending"
    crawling = "crawling"
    extracting = "extracting"
    comparing = "comparing"
    completed = "completed"
    failed = "failed"


class Competitor(Base):
    """A competitor of a client (PRD §4). Profile fields mirror the client profile
    (§3.2) plus the comparative analysis fields from §4.4."""

    __tablename__ = "competitors"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    client_id: Mapped[str] = mapped_column(String(36), ForeignKey("clients.id", ondelete="CASCADE"), index=True)
    company_name: Mapped[str] = mapped_column(String(255), nullable=False)
    website_url: Mapped[str] = mapped_column(String(500), nullable=False)
    source: Mapped[CompetitorSource] = mapped_column(Enum(CompetitorSource), default=CompetitorSource.manual)
    identification_reason: Mapped[str] = mapped_column(Text, default="")  # why the LLM picked it

    # Profile fields (same as client, §3.2)
    industry: Mapped[str] = mapped_column(String(255), default="")
    description: Mapped[str] = mapped_column(Text, default="")
    products_services: Mapped[str] = mapped_column(Text, default="")
    target_audience: Mapped[str] = mapped_column(Text, default="")
    value_proposition: Mapped[str] = mapped_column(Text, default="")
    business_objectives: Mapped[list] = mapped_column(JSON, default=list)
    communication_tone: Mapped[str] = mapped_column(Text, default="")
    social_media_urls: Mapped[list] = mapped_column(JSON, default=list)

    # Comparative analysis (§4.4)
    positioning: Mapped[str] = mapped_column(Text, default="")       # differential positioning vs the client
    strengths: Mapped[list] = mapped_column(JSON, default=list)
    weaknesses: Mapped[list] = mapped_column(JSON, default=list)

    analysis_status: Mapped[AnalysisStatus] = mapped_column(Enum(AnalysisStatus), default=AnalysisStatus.pending)
    analysis_error: Mapped[str] = mapped_column(Text, default="")
    pages_crawled: Mapped[int] = mapped_column(Integer, default=0)
    analyzed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


class SearchJobStatus(str, enum.Enum):
    pending = "pending"
    identifying = "identifying"
    completed = "completed"
    failed = "failed"


class CompetitorSearchJob(Base):
    """An automatic competitor identification run (PRD §4.2–4.3)."""

    __tablename__ = "competitor_search_jobs"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    client_id: Mapped[str] = mapped_column(String(36), ForeignKey("clients.id", ondelete="CASCADE"), index=True)
    status: Mapped[SearchJobStatus] = mapped_column(Enum(SearchJobStatus), default=SearchJobStatus.pending)
    num_competitors: Mapped[int] = mapped_column(Integer, default=5)
    competitor_type: Mapped[str] = mapped_column(String(20), default="direct")     # direct | indirect
    geographic_scope: Mapped[str] = mapped_column(String(20), default="national")  # local | national | international
    identified: Mapped[list] = mapped_column(JSON, default=list)  # [{company_name, website_url, reason}]
    error: Mapped[str] = mapped_column(Text, default="")
    created_by: Mapped[str] = mapped_column(String(36), default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )
