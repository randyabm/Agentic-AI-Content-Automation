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

from sqlalchemy.orm import Session

from app.models.campaign import Campaign, CampaignElement
from app.models.llm import LLMConfig, LLMFunction
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
from app.services.llm import complete_text
from app.services.style_repetition import StyleHistorySource
from app.schemas.style_alternative import StyleAlternativeOut

logger = logging.getLogger(__name__)


# Hard cap on how many families we expose per call. The library has 6
# families, recent usage blocks ~5, so the realistic upper bound is 6.
# We ask for 3 (the PDF's "show 3 style directions" recommendation) and
# fall back to fewer if the library is exhausted.
ALTERNATIVES_COUNT = 3


def _patch_prompt_for_force_family(user_prompt: str, family: str) -> str:
    """Append a small override that tells the agent it MUST pick this
    specific family. We don't mutate VISUAL_INSTRUCTIONS itself (it's a
    module-level constant) — we just add an extra instruction at the
    end of the user_prompt where the agent reads it as the last word.
    """
    override = (
        f"\n\nOverride for this call: pick style_family='{family}'. Do not pick "
        f"any other family. The repetition-penalty block in CONTEXT above is "
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


def get_alternatives(
    db: Session,
    *,
    campaign: Campaign,
    elements: list[CampaignElement],
    exclude_families: Iterable[str] = (),
) -> tuple[list[StyleAlternativeOut], list[str]]:
    """Build 3 style directions for the Make-it-different popover.

    Returns (alternatives, excluded_families) where `excluded_families` is the
    list of style_families we deliberately avoided (so the UI can tell
    the user "we skipped bold_typographic because you saw it yesterday").
    """
    visual = [el for el in elements if campaign_gen._slots_for(el) > 0]
    if not visual:
        return [], []

    org_id = str(campaign.org_id) if campaign.org_id else ""
    client_id = str(campaign.client_id) if campaign.client_id else None

    excluded = set(exclude_families) | set(
        style_repetition.recent_families(
            db, org_id=org_id, client_id=client_id, limit=5
        )
    )
    candidates = [f for f in _ALLOWED_STYLE_FAMILIES if f not in excluded]
    if not candidates:
        # Library exhausted — fall back to least-recently-used families.
        candidates = style_repetition.different_families(
            db,
            org_id=org_id,
            client_id=client_id,
            available=_ALLOWED_STYLE_FAMILIES,
            exclude=exclude_families,
            limit=ALTERNATIVES_COUNT,
        )
    if not candidates:
        return [], sorted(excluded)

    candidates = candidates[:ALTERNATIVES_COUNT]

    raw_cfg = get_llm_config(db, LLMFunction.visual_agent)
    if raw_cfg is None:
        return [], sorted(excluded)
    cfg = _snapshot_cfg(raw_cfg)

    prep = _prepare_visual(db, campaign, elements, context=_alternative_context(campaign))
    if prep is None:
        return [], sorted(excluded)
    base_user_prompt = prep[1]

    alternatives: list[StyleAlternativeOut] = []
    for family in candidates:
        try:
            forced_prompt = _patch_prompt_for_force_family(base_user_prompt, family)
            raw = complete_text(cfg, cfg.system_prompt, forced_prompt, prep[2])
            parsed = _parse_visual(raw, prep[3], prep[4])
            # Use the FIRST visual element's first slot as the representative direction
            for slots in parsed:
                if slots:
                    alternatives.append(_build_alternative_from_slot(slots[0], family))
                    break
        except Exception:
            logger.exception("Failed to build style alternative for family=%s", family)
            continue

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
                    image_prompt=alt.image_prompt_without_text,
                    source=StyleHistorySource.style_alternatives,
                )
        except Exception:
            logger.exception("Failed to record style_alternatives history")

    return alternatives, sorted(excluded)


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
