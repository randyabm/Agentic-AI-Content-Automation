"""Small helpers for reading DB-backed platform settings (the Setting table).

Kept separate from routes so services/workers can read feature flags without a
circular import. Values are stored as strings; get_bool normalizes them.
"""
from sqlalchemy.orm import Session

from app.models.setting import Setting


def get_bool(db: Session, key: str, default: bool) -> bool:
    row = db.get(Setting, key)
    if row is None or row.value is None or row.value == "":
        return default
    return row.value.strip().lower() == "true"


def negative_prompt_enabled(db: Session) -> bool:
    """Whether the negative-prompt feature is active. When OFF, generation ignores
    any stored negative prompts and the UI hides the field (functionality and
    endpoints stay intact)."""
    return get_bool(db, "negative_prompt_enabled", True)
