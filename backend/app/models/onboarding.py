import enum
import uuid
from datetime import datetime

from sqlalchemy import JSON, DateTime, Enum, ForeignKey, String, func
from sqlalchemy.orm import Mapped, mapped_column

from app.db.session import Base


class OnboardingStatus(str, enum.Enum):
    running = "running"
    completed = "completed"
    completed_with_errors = "completed_with_errors"
    failed = "failed"


class OnboardingStepStatus(str, enum.Enum):
    """Per-step status inside `OnboardingJob.steps[*].status`. The data lives in
    a JSONB array, but the writer (`workers/tasks.py::_set_step`) now uses this
    enum so a typo is caught at call time instead of being silently persisted."""

    pending = "pending"
    running = "running"
    ok = "ok"
    error = "error"
    skipped = "skipped"


# Predefined pipeline steps, in execution order. The orchestrator seeds the job
# with these (all "pending") and updates each as it runs.
ONBOARDING_STEPS = [
    {"key": "profile", "label": "Analyzing website & extracting profile"},
    {"key": "branding", "label": "Recovering logo & profile photo"},
    {"key": "brand_memory", "label": "Generating brand memory"},
    {"key": "competitors", "label": "Researching competitors"},
    {"key": "articles", "label": "Importing articles"},
]


def initial_steps() -> list[dict]:
    return [{**s, "status": OnboardingStepStatus.pending.value, "detail": ""} for s in ONBOARDING_STEPS]


class OnboardingJob(Base):
    """A background pipeline that fully populates a client right after creation
    (profile + branding + competitors + articles), with per-step live progress."""

    __tablename__ = "onboarding_jobs"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    client_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("clients.id", ondelete="CASCADE"), index=True
    )
    status: Mapped[OnboardingStatus] = mapped_column(
        Enum(OnboardingStatus), default=OnboardingStatus.running
    )
    steps: Mapped[list] = mapped_column(JSON, default=initial_steps)
    created_by: Mapped[str] = mapped_column(String(36), default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )
