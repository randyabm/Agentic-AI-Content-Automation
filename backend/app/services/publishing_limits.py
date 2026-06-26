"""Per-platform publishing limits — anti-block safeguards.

Centralized limits that the Celery Beat sweep consults to throttle posts per
account: at most `per_day` published posts in the last 24h, and at least
`min_gap_min` minutes between consecutive publishes on the same account.

Conservative defaults (well under Meta's documented limits):
  - Instagram Content Publishing API: 25 posts / 24h rolling
  - Facebook Pages: 50 posts / 24h soft cap (Meta has no hard limit, but
    bursts > 25/day trigger spam detection)

Admins can override per-platform via the `publishing_limits` Setting (a JSON
blob keyed by platform). `effective_limits(db)` returns the merged view used
by both the worker and the admin UI.
"""
from __future__ import annotations

import json
from datetime import datetime, timedelta, timezone

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.setting import Setting
from app.models.social import PublishStatus, ScheduledPost

# --- defaults ---------------------------------------------------------------

DEFAULT_LIMITS: dict[str, dict[str, int]] = {
    "instagram": {"per_day": 20, "min_gap_min": 10},
    "facebook":  {"per_day": 25, "min_gap_min": 10},
    "linkedin":  {"per_day": 15, "min_gap_min": 15},
    "x":         {"per_day": 15, "min_gap_min": 10},
    "twitter":   {"per_day": 15, "min_gap_min": 10},
    "_default":  {"per_day": 20, "min_gap_min": 10},
}

# Backoff schedule (minutes) per retry attempt index.
# retry_count 0 (first failure) waits 5 min, then 15, 60, 180, then failed.
RETRY_BACKOFF_MIN = [5, 15, 60, 180]


def _load_overrides(db: Session) -> dict[str, dict[str, int]]:
    """Read the `publishing_limits` Setting (JSON dict) and validate the shape."""
    row = db.get(Setting, "publishing_limits")
    if not row or not row.value:
        return {}
    try:
        data = json.loads(row.value)
    except (TypeError, ValueError):
        return {}
    if not isinstance(data, dict):
        return {}
    out: dict[str, dict[str, int]] = {}
    for platform, limits in data.items():
        if not isinstance(limits, dict):
            continue
        per_day = limits.get("per_day")
        min_gap = limits.get("min_gap_min")
        if not isinstance(per_day, int) or per_day <= 0:
            continue
        if not isinstance(min_gap, int) or min_gap < 0:
            continue
        out[str(platform)] = {"per_day": per_day, "min_gap_min": min_gap}
    return out


def limit_for(db: Session, platform: str) -> dict[str, int]:
    """Effective per-day / min-gap for `platform`, falling back to _default."""
    overrides = _load_overrides(db)
    if platform in overrides:
        return overrides[platform]
    return overrides.get("_default", DEFAULT_LIMITS["_default"])


def effective_limits(db: Session) -> dict[str, dict[str, int]]:
    """The full merged view: defaults overridden by any admin overrides.
    Always includes `_default` so callers can rely on it."""
    overrides = _load_overrides(db)
    merged: dict[str, dict[str, int]] = {}
    for platform, limits in DEFAULT_LIMITS.items():
        merged[platform] = dict(limits)
    for platform, limits in overrides.items():
        merged[platform] = dict(limits)
    if "_default" not in merged:
        merged["_default"] = dict(DEFAULT_LIMITS["_default"])
    return merged


def save_overrides(db: Session, overrides: dict[str, dict[str, int]]) -> None:
    """Persist admin overrides as a single Setting row.

    The full default schema isn't required — the worker always falls back to
    `DEFAULT_LIMITS` for keys the admin didn't override. We reject obviously
    bad input here so the API can return a clean 400.
    """
    clean: dict[str, dict[str, int]] = {}
    for platform, limits in overrides.items():
        if not isinstance(limits, dict):
            raise ValueError(f"Limits for {platform!r} must be an object")
        per_day = limits.get("per_day")
        min_gap = limits.get("min_gap_min")
        if not isinstance(per_day, int) or per_day <= 0:
            raise ValueError(f"per_day for {platform!r} must be a positive integer")
        if not isinstance(min_gap, int) or min_gap < 0:
            raise ValueError(f"min_gap_min for {platform!r} must be a non-negative integer")
        clean[str(platform)] = {"per_day": per_day, "min_gap_min": min_gap}

    row = db.get(Setting, "publishing_limits")
    if row is None:
        row = Setting(key="publishing_limits", value=json.dumps(clean))
        db.add(row)
    else:
        row.value = json.dumps(clean)


# --- count helpers ----------------------------------------------------------


def count_published_last_24h(db: Session, account_id: str) -> int:
    """How many posts this account has actually published in the last 24 hours.

    Counts ScheduledPost rows for this account in the *published* state with a
    recent `last_attempt_at` (or `updated_at` as a fallback for legacy rows
    that pre-date migration 007). Only posts that have *actually completed*
    count toward the daily cap — posts in flight (publishing/retrying) are
    not counted, so a transient retry doesn't lock out the daily quota.
    """
    cutoff = datetime.now(timezone.utc) - timedelta(hours=24)
    return len(
        db.scalars(
            select(ScheduledPost).where(
                ScheduledPost.social_account_id == account_id,
                ScheduledPost.status == PublishStatus.published,
                ScheduledPost.last_attempt_at >= cutoff,
            )
        ).all()
    )


def last_published_at(db: Session, account_id: str) -> datetime | None:
    """Timestamp of the most recent successful publish on this account, or None.

    Falls back to `updated_at` for legacy rows so the min-gap throttle still
    works for old data; new rows always have `last_attempt_at` populated.
    """
    from sqlalchemy import func as sa_func

    return db.scalar(
        select(sa_func.coalesce(ScheduledPost.last_attempt_at, ScheduledPost.updated_at))
        .where(
            ScheduledPost.social_account_id == account_id,
            ScheduledPost.status == PublishStatus.published,
        )
        .order_by(ScheduledPost.last_attempt_at.desc().nulls_last(), ScheduledPost.updated_at.desc())
        .limit(1)
    )


def backoff_for(retry_count: int) -> int:
    """Minutes to wait before the next attempt, indexed by retry_count.

    `retry_count` is the count *after* incrementing — i.e. the first failure
    becomes retry_count=1 and waits 5 min. Out-of-range returns the longest
    window so the worker defers safely.
    """
    if retry_count < 0:
        retry_count = 0
    if retry_count >= len(RETRY_BACKOFF_MIN):
        return RETRY_BACKOFF_MIN[-1]
    return RETRY_BACKOFF_MIN[retry_count]
