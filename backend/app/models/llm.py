import enum
import uuid
from datetime import datetime

from sqlalchemy import Boolean, DateTime, Enum, Float, Integer, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from app.db.session import Base


class LLMFunction(str, enum.Enum):
    """The configurable LLM functions defined in PRD §9.1."""

    client_extraction = "client_extraction"
    competitor_identification = "competitor_identification"
    competitor_analysis = "competitor_analysis"
    editorial_agent = "editorial_agent"
    visual_agent = "visual_agent"
    article_analysis = "article_analysis"
    article_relevance_scoring = "article_relevance_scoring"


class LLMConfig(Base):
    __tablename__ = "llm_configs"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    function: Mapped[LLMFunction] = mapped_column(Enum(LLMFunction), unique=True, nullable=False)
    provider: Mapped[str] = mapped_column(String(50), default="anthropic")  # anthropic | openrouter | openai | google
    model_name: Mapped[str] = mapped_column(String(100), default="claude-sonnet-4-6")
    api_key_encrypted: Mapped[str] = mapped_column(Text, default="")
    temperature: Mapped[float] = mapped_column(Float, default=0.7)
    max_tokens: Mapped[int] = mapped_column(Integer, default=4096)
    system_prompt: Mapped[str] = mapped_column(Text, default="")
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


class ImageModel(Base):
    """Admin-defined list of image generation models users can choose from.

    Per product decision: the admin curates this list (OpenRouter/Gemini models),
    and the end user picks one at image generation time.
    """

    __tablename__ = "image_models"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    display_name: Mapped[str] = mapped_column(String(100), nullable=False)
    provider: Mapped[str] = mapped_column(String(50), default="openrouter")
    model_name: Mapped[str] = mapped_column(String(150), nullable=False)  # e.g. google/gemini-2.5-flash-image
    api_key_encrypted: Mapped[str] = mapped_column(Text, default="")
    is_default: Mapped[bool] = mapped_column(Boolean, default=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )
