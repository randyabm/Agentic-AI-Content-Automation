"""Schemas for the style-alternatives endpoint (Stage 1.4)."""
from typing import Optional

from pydantic import BaseModel, ConfigDict, Field


class StyleAlternativeOut(BaseModel):
    """One style direction the user can pick from the Make-it-different popover.

    `image_prompt_without_text` is the only field the image generator needs
    to actually generate; the rest is for the UI preview and the
    explanation under the card.
    """
    model_config = ConfigDict(from_attributes=True)

    style_family: str = Field(..., min_length=1, max_length=64)
    style_name: str
    novelty_reason: str
    visual_keywords: list[str] = []
    colour_mood: str = ""
    image_prompt_without_text: str
    negative_prompt: str = ""
    avoid: list[str] = []


class StyleAlternativesResponse(BaseModel):
    alternatives: list[StyleAlternativeOut]
    excluded_families: list[str] = Field(
        default_factory=list,
        description="The style_families the agent avoided because the user has just seen them.",
    )


class ApplyStyleAlternativeRequest(BaseModel):
    """Body for `POST /style-alternatives/apply`: pick one of the alternatives
    and persist it on the image so the next generation uses the same family.
    """
    alternative: StyleAlternativeOut
    persist_prompt: bool = Field(
        default=True,
        description="If true, also save image_prompt_without_text + negative_prompt on the PostImage (matches the current /prompt endpoint behaviour).",
    )
