"""Style alternatives for the 'Make it different' popover (Stage 1.4).

When a user is unhappy with the visual a campaign just produced, the
popover shows them 3 DIFFERENT style directions, each driven by a
forced style_family from the closed list and the repetition-penalty
block (so the agent's choice is not just random — it's chosen to be
genuinely different from the user's recent history).

We piggy-back on the existing Visual Agent LLMConfig: same model,
same temperature, same penalty block — the only change is the
`force_style_family` override injected into the user_prompt. Three
parallel calls, one per family, returning a structured style direction
that the UI can preview as a card.
"""
import logging
from typing import Iterable

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.campaign import Campaign, CampaignElement, PostImage
from app.models.llm import LLMConfig, LLMFunction
from app.models.style_history import StyleHistory
from app.services import campaign_gen, style_repetition
from app.services.campaign_gen import (
    VISUAL_INSTRUCTIONS,
    VISUAL_BANNED_PHRASES,
    _ALLOWED_STYLE_FAMILIES,
    _parse_visual,
    _prepare_visual,
    _snapshot_cfg,
    get_llm_config,
)
from app.services.extraction import complete_text
from app.services.style_repetition import StyleHistorySource
from app.schemas.style_alternative import StyleAlternativeOut

logger = logging.getLogger(__name__)


# Hard cap on how many families we expose per call. The library has 6
# families; the penalty softly blocks 2, the current family is hard-
# excluded, so the realistic upper bound is 3-4. We ask for 3 (the
# PDF's "show 3 style directions" recommendation).
ALTERNATIVES_COUNT = 3

# How many of the most-recently-used families the popover softly skips.
# The user has explicitly asked for "something different" so the penalty
# is gentler than the automatic generation penalty (which uses 5). With
# limit=2 the primary path almost always leaves 3+ candidates; only a
# pathological "all 6 in recent history" case falls through to the
# least-recently-used fallback below.
POPOVER_SOFT_PENALTY_LIMIT = 2


def _patch_prompt_for_force_family(user_prompt: str, family: str) -> str:
    """Append a small override that tells the agent it MUST pick this
    specific family. We don't mutate VISUAL_INSTRUCTIONS itself (it's a
    module-level constant) — we just add an extra instruction at the
    end of the user_prompt where the agent reads it as the last word.
    """
    override = (
        f"\n\nOverride for this call: pick style_family='{family}'. Do not pick "
        f"any other family and do not remix it with another family even if the "
        f"creativity guidance above allows remixing — for this call, '{family}' "
        f"alone, no blend, is_remix=false, base_families=[]. "
        f"The repetition-penalty block in CONTEXT above is "
        f"suspended for this single call — the user has explicitly asked for "
        f"a '{family}' take."
    )
    return user_prompt + override


def _build_alternative_from_slot(
    slot: dict, family: str
) -> StyleAlternativeOut:
    return StyleAlternativeOut(
        style_family=family,
        style_name=slot.get("style_name", "") or family.replace("_", " ").title(),
        novelty_reason=slot.get("novelty_reason", ""),
        visual_keywords=list(slot.get("visual_keywords", []) or []),
        colour_mood=slot.get("colour_mood", ""),
        image_prompt_without_text=slot.get("prompt", ""),
        negative_prompt=slot.get("negative_prompt", ""),
        avoid=list(slot.get("avoid", []) or []),
    )


def _current_image_family(db: Session, image: PostImage) -> str | None:
    """Look up the style_family the current PostImage was generated with,
    via the most recent style_history row keyed to image_id. Returns None
    if the image predates the style_history feature or no usage was
    recorded.
    """
    row = db.execute(
        select(StyleHistory.style_family)
        .where(StyleHistory.image_id == image.id)
        .order_by(StyleHistory.created_at.desc())
        .limit(1)
    ).first()
    return row[0] if row else None


def _least_recent_families(
    db: Session,
    *,
    org_id: str,
    available: Iterable[str],
    exclude: Iterable[str] = (),
    limit: int = 3,
) -> list[str]:
    """Pick `limit` families from `available` that are NOT in `exclude`
    (the user-provided exclusions only — does NOT apply the recent-history
    exclusion). Used as the fallback when the primary candidates list is
    exhausted. Order: least-recently-used first, so we rotate through the
    library before repeating.
    """
    pool = [f for f in available if f not in set(exclude)]
    if len(pool) <= limit:
        return pool
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
    pool.sort(key=lambda f: last_seen.get(f, 10_000))
    return pool[:limit]


def get_alternatives(
    db: Session,
    *,
    campaign: Campaign,
    elements: list[CampaignElement],
    exclude_families: Iterable[str] = (),
    image: PostImage | None = None,
) -> tuple[list[StyleAlternativeOut], list[str]]:
    """Build 3 style directions for the Make-it-different popover.

    Returns (alternatives, excluded_families) where `excluded_families` is
    the list of style_families the soft penalty skipped (so the UI can
    tell the user "we skipped bold_typographic because you saw it
    yesterday"). The current image's family is hard-excluded but NOT
    surfaced in excluded_families — the user knows what they have.

    Selection logic (3-tier):
    1. Start with the 6 allowed families.
    2. Hard-exclude: caller-provided + the current image's family.
    3. Soft-exclude: the POPOVER_SOFT_PENALTY_LIMIT most-recent families.
       If (2) and (3) leave ≥ 3 candidates, use them.
    4. Fallback: ignore the soft penalty, pick the 3 least-recently-used
       families (so a heavy user who has cycled through the whole library
       still sees 3 cards instead of an empty dialog).
    """
    visual = [el for el in elements if campaign_gen._slots_for(el) > 0]
    if not visual:
        logger.warning(
            "style_alternatives: no visual elements (all text-only or zero slots). "
            "image_id=%s campaign_id=%s elements=%d",
            image.id if image else None, campaign.id, len(elements),
        )
        return [], []

    # Resolve org_id via the Client (Campaign only has client_id).
    from app.models.client import Client
    org_id = ""
    if campaign.client_id:
        client_row = db.get(Client, campaign.client_id)
        if client_row is not None and client_row.org_id:
            org_id = str(client_row.org_id)
    client_id = str(campaign.client_id) if campaign.client_id else None

    # Hard exclusions: caller-provided + the current image's family.
    # We never want to suggest the very same style the user is trying to
    # escape from.
    hard_excluded = set(exclude_families)
    current_family = _current_image_family(db, image) if image is not None else None
    if current_family:
        hard_excluded.add(current_family)

    # Soft exclusions: the most-recently-used families. Capped low (2)
    # because this is a user-initiated flow — we want to show options,
    # not punish the user for clicking the button. The auto-generation
    # penalty is the stricter one (5); see style_repetition.penalty_block.
    soft_recent_list = style_repetition.recent_families(
        db, org_id=org_id, client_id=client_id, limit=POPOVER_SOFT_PENALTY_LIMIT
    )
    soft_recent = set(soft_recent_list) - hard_excluded

    # The list shown to the UI as "skipped" is the soft set, not the
    # hard set. The user already knows what they excluded.
    excluded_for_ui = sorted(soft_recent)

    candidates = [
        f for f in _ALLOWED_STYLE_FAMILIES
        if f not in hard_excluded and f not in soft_recent
    ]
    if len(candidates) < ALTERNATIVES_COUNT:
        # Library exhausted under the soft penalty. Fall back: ignore the
        # soft penalty, pick least-recently-used, still respect hard.
        candidates = _least_recent_families(
            db,
            org_id=org_id,
            available=_ALLOWED_STYLE_FAMILIES,
            exclude=hard_excluded,
            limit=ALTERNATIVES_COUNT,
        )
    if not candidates:
        # Pathological (e.g. no style_history at all, or the only
        # non-excluded family is a brand-scoped one not in the global
        # library). Just return the whole library minus hard exclusions.
        candidates = [f for f in _ALLOWED_STYLE_FAMILIES if f not in hard_excluded]
    candidates = candidates[:ALTERNATIVES_COUNT]

    raw_cfg = get_llm_config(db, LLMFunction.visual_agent)
    if raw_cfg is None:
        logger.warning(
            "style_alternatives: no visual_agent LLMConfig — returning empty. "
            "image_id=%s campaign_id=%s candidates=%d",
            image.id if image else None, campaign.id, len(candidates),
        )
        return [], excluded_for_ui
    cfg = _snapshot_cfg(raw_cfg)

    prep = _prepare_visual(db, campaign, elements, context=_alternative_context(campaign))
    if prep is None:
        logger.warning(
            "style_alternatives: _prepare_visual returned None — returning empty. "
            "image_id=%s campaign_id=%s candidates=%d",
            image.id if image else None, campaign.id, len(candidates),
        )
        return [], excluded_for_ui
    base_user_prompt = prep[1]

    # Fire the 3 LLM calls in parallel — each takes 15-25s, sequential would
    # be 45-75s and the frontend's 30s default timeout would kick in. Each
    # call is its own try/except so a single failure doesn't poison the
    # others. We re-use the prep snapshot across all 3 calls (it's a
    # tuple of immutable references so thread-safe).
    from concurrent.futures import ThreadPoolExecutor, as_completed

    def _build_one(family: str) -> StyleAlternativeOut | None:
        try:
            forced_prompt = _patch_prompt_for_force_family(base_user_prompt, family)
            raw = complete_text(cfg, cfg.system_prompt, forced_prompt, prep[2])
            parsed = _parse_visual(raw, prep[3], prep[4])
            # Use the FIRST visual element's first slot as the representative
            for slots in parsed:
                if slots:
                    return _build_alternative_from_slot(slots[0], family)
            logger.warning(
                "style_alternatives: LLM returned parseable JSON but no non-empty "
                "slots for family=%s. parsed_len=%d",
                family, len(parsed),
            )
            return None
        except Exception:
            logger.exception("Failed to build style alternative for family=%s", family)
            return None

    alternatives: list[StyleAlternativeOut] = []
    with ThreadPoolExecutor(max_workers=len(candidates)) as pool:
        futures = {pool.submit(_build_one, fam): fam for fam in candidates}
        for fut in as_completed(futures):
            result = fut.result()
            if result is not None:
                alternatives.append(result)

    # Record each picked family in style_history with source=style_alternatives
    # so the next generation's penalty block (which is per-source) doesn't
    # immediately punish the user for clicking "make it different".
    if alternatives and org_id:
        try:
            for alt in alternatives:
                style_repetition.record_usage(
                    db,
                    org_id=org_id,
                    client_id=client_id,
                    style_family=alt.style_family,
                    image_id=image.id if image is not None else None,
                    image_prompt=alt.image_prompt_without_text,
                    source=StyleHistorySource.style_alternatives,
                )
        except Exception:
            logger.exception("Failed to record style_alternatives history")

    if not alternatives:
        logger.warning(
            "style_alternatives: no alternatives produced. image_id=%s campaign_id=%s "
            "candidates=%d current_family=%s hard_excluded=%s soft_recent=%s",
            image.id if image else None, campaign.id, len(candidates),
            current_family, sorted(hard_excluded), sorted(soft_recent),
        )

    return alternatives, excluded_for_ui


def _alternative_context(campaign: Campaign) -> str:
    """Trimmed CONTEXT for the alternative-generation calls. We pass
    brand + campaign info but skip the heavyweight editorial/posts context
    — alternatives only need enough info to pick a style direction.
    """
    parts = [
        f"Campaign objective: {campaign.objective.value if campaign.objective else 'awareness'}",
        f"Campaign central theme: {campaign.central_theme or '(see element descriptors)'}",
        "Each alternative is a preview — the user will pick one to regenerate with.",
    ]
    return "\n".join(parts)


def apply_alternative(
    db: Session,
    *,
    campaign: Campaign,
    image,
    alt: StyleAlternativeOut,
    persist_prompt: bool = True,
) -> None:
    """Persist the user's pick on the PostImage so the next
    /generate call uses the same family, and optionally save the
    prompt fields so the user sees the new wording in the editor.
    """
    if alt.style_family and alt.style_family not in _ALLOWED_STYLE_FAMILIES:
        from fastapi import HTTPException, status

        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            f"Unknown style_family '{alt.style_family}'.",
        )
    if persist_prompt and alt.image_prompt_without_text:
        image.prompt = alt.image_prompt_without_text
    if persist_prompt and alt.negative_prompt:
        image.negative_prompt = alt.negative_prompt
    db.commit()
    db.refresh(image)
