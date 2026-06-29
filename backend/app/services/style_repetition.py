"""Repetition penalty for the Visual Agent.

The Visual Agent has a closed list of style_families to pick from. Without
memory, it falls into the safe default every time and every image looks
alike. This service:

- records every style_family actually used in a generation (one row per
  use, append-only)
- reads the last N families for a (org, client) and renders a markdown
  block the Visual Agent prompt injects as a 'penalty' hint
- reads the last N families to compute a set of 'different' candidates
  for the Make-it-different popover (Stage 1.4)

We never delete from style_history — the soft-delete on style_cards keeps
the family slug stable even when a card is deactivated.
"""
import hashlib
import logging
from typing import Iterable

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.style_history import StyleHistory, StyleHistorySource

logger = logging.getLogger(__name__)


# How many recent style_families to penalise / surface to the agent.
# 5 is enough to break the 'same poster 5 times in a row' pattern without
# starving a small library of 6 families.
DEFAULT_RECENT_LIMIT = 5


def hash_prompt(prompt: str) -> str:
    """Stable 16-char hash of the final image prompt, for future
    perceptual-similarity detection (Stage 3.3)."""
    return hashlib.sha256(prompt.encode("utf-8")).hexdigest()[:16]


def record_usage(
    db: Session,
    *,
    org_id: str,
    client_id: str | None,
    style_family: str,
    style_card_id: str | None = None,
    image_id: str | None = None,
    image_prompt: str | None = None,
    source: StyleHistorySource = StyleHistorySource.generation,
) -> None:
    """Append a row. Caller is responsible for db.commit() (or letting the
    surrounding session commit). This is intentionally fire-and-forget so
    it can be called from a background thread without blocking the
    generation response.
    """
    row = StyleHistory(
        org_id=org_id,
        client_id=client_id,
        style_family=style_family,
        style_card_id=style_card_id,
        image_id=image_id,
        image_prompt_hash=hash_prompt(image_prompt) if image_prompt else None,
        source=source.value,
    )
    db.add(row)
    try:
        db.commit()
    except Exception:
        db.rollback()
        # Don't break the generation pipeline if the history write fails —
        # just log it. The penalty degrades to 'no memory' until next write.
        logger.exception("Failed to record style_history row for %s/%s", org_id, style_family)


def recent_families(
    db: Session,
    *,
    org_id: str,
    client_id: str | None,
    limit: int = DEFAULT_RECENT_LIMIT,
) -> list[str]:
    """The last `limit` style_families used, newest first. Falls back to the
    org-wide history if there's no client-specific one yet (e.g. a brand
    that just got its first generation).
    """
    rows: list[tuple] = []
    if client_id:
        rows = db.execute(
            select(StyleHistory.style_family, StyleHistory.created_at)
            .where(StyleHistory.org_id == org_id, StyleHistory.client_id == client_id)
            .order_by(StyleHistory.created_at.desc())
            .limit(limit)
        ).all()
    if not rows:
        # Fall back to org-wide — useful the first time a client generates.
        rows = db.execute(
            select(StyleHistory.style_family, StyleHistory.created_at)
            .where(StyleHistory.org_id == org_id)
            .order_by(StyleHistory.created_at.desc())
            .limit(limit)
        ).all()
    return [r[0] for r in rows]


def penalty_block(
    db: Session,
    *,
    org_id: str,
    client_id: str | None,
    limit: int = DEFAULT_RECENT_LIMIT,
) -> str:
    """Markdown block the Visual Agent prompt injects when asking for a
    new style_direction. Empty string when there's no history yet, so the
    agent can use any family.
    """
    families = recent_families(db, org_id=org_id, client_id=client_id, limit=limit)
    if not families:
        return ""
    return (
        "Recent style_families the user has already seen (avoid unless they "
        "explicitly ask for consistency in a series): "
        + ", ".join(families)
        + "."
    )


def different_families(
    db: Session,
    *,
    org_id: str,
    client_id: str | None,
    available: Iterable[str],
    exclude: Iterable[str] = (),
    limit: int = 3,
) -> list[str]:
    """For the Make-it-different popover: pick up to `limit` families
    from `available` that are NOT in the recent history and NOT in
    `exclude`. Order is 'least-recently-used first' so we cycle through the
    full library before repeating.
    """
    excluded = set(recent_families(db, org_id=org_id, client_id=client_id, limit=10)) | set(exclude)
    candidates = [f for f in available if f not in excluded]
    if len(candidates) <= limit:
        return candidates
    # Cycle: if we still have too many, prefer the ones used least recently.
    last_seen: dict[str, int] = {}
    rows = db.execute(
        select(StyleHistory.style_family)
        .where(StyleHistory.org_id == org_id)
        .order_by(StyleHistory.created_at.desc())
        .limit(50)
    ).all()
    for i, (fam,) in enumerate(rows):
        if fam not in last_seen:
            last_seen[fam] = i
    candidates.sort(key=lambda f: last_seen.get(f, 10_000))
    return candidates[:limit]
