"""Competitive intelligence (PRD §4): competitor identification via LLM + web
search, and comparative analysis of each competitor against the client profile.
"""
import logging

import anthropic
from sqlalchemy.orm import Session

from app.core.crypto import decrypt_secret
from app.models.client import Client
from app.models.competitor import Competitor
from app.models.llm import LLMFunction
from app.services.extraction import (
    ExtractionError,
    complete_text,
    get_llm_config,
    parse_json_value,
)

logger = logging.getLogger(__name__)

IDENTIFICATION_INSTRUCTIONS = """\
You are a competitive intelligence analyst. Using web search, identify the {count} most
relevant {ctype} competitors of the company described below, considering a {scope}
geographic scope relative to where the company operates.

A "direct" competitor sells similar products/services to the same market. An "indirect"
competitor addresses the same customer need with a different solution.

Rules:
- Each competitor must be a real, currently operating company with a working website.
- Do NOT include the analyzed company itself, its subsidiaries, or generic directories,
  marketplaces, or review sites.
- Verify each company's website URL via web search before including it.

After researching, answer ONLY with a JSON array, no other text:
[
  {{"company_name": string, "website_url": string, "reason": string (1-2 sentences in English explaining why it is a relevant competitor)}},
  ...
]

COMPANY PROFILE:
{profile}
"""

COMPARISON_INSTRUCTIONS = """\
You are a competitive intelligence analyst. Compare the COMPETITOR against the CLIENT
using the two profiles below and answer ONLY with a single JSON object:

{
  "positioning": string (2-3 paragraphs: the competitor's differential positioning relative to the client),
  "strengths": [string, ...] (4-7 identified strengths of the competitor versus the client),
  "weaknesses": [string, ...] (4-7 identified weaknesses of the competitor versus the client)
}

Be specific and comparative — every point must relate the competitor to the client.
Write everything in English. Base your analysis only on the two profiles provided.
"""


def _profile_text(label: str, name: str, url: str, data: dict) -> str:
    lines = [f"=== {label}: {name} ({url})"]
    for key in (
        "industry", "description", "products_services", "target_audience",
        "value_proposition", "communication_tone",
    ):
        if data.get(key):
            lines.append(f"{key.replace('_', ' ').title()}: {data[key]}")
    if data.get("business_objectives"):
        lines.append("Business objectives: " + "; ".join(data["business_objectives"]))
    if data.get("social_media_urls"):
        lines.append("Social media: " + ", ".join(data["social_media_urls"]))
    return "\n".join(lines)


def client_profile_dict(client: Client) -> dict:
    return {
        "industry": client.industry,
        "description": client.description,
        "products_services": client.products_services,
        "target_audience": client.target_audience,
        "value_proposition": client.value_proposition,
        "business_objectives": client.business_objectives,
        "communication_tone": client.communication_tone,
        "social_media_urls": client.social_media_urls,
    }


def identify_competitors(
    db: Session, client: Client, count: int, competitor_type: str, scope: str
) -> list[dict]:
    """Identify competitors with the configured identification LLM + web search.

    Web search currently requires the Anthropic provider (server-side web_search tool).
    """
    cfg = get_llm_config(db, LLMFunction.competitor_identification)
    if cfg.provider != "anthropic":
        raise ExtractionError(
            "Competitor identification requires an Anthropic model (web search support). "
            "Update the 'competitor identification' LLM config."
        )
    prompt = IDENTIFICATION_INSTRUCTIONS.format(
        count=count,
        ctype=competitor_type,
        scope=scope,
        profile=_profile_text("COMPANY", client.company_name, client.website_url, client_profile_dict(client)),
    )
    api_key = getattr(cfg, "resolved_api_key", "") or decrypt_secret(cfg.api_key_encrypted)
    api = anthropic.Anthropic(api_key=api_key, max_retries=5)
    message = api.messages.create(
        model=cfg.model_name,
        max_tokens=cfg.max_tokens,
        temperature=min(cfg.temperature, 1.0),
        system=cfg.system_prompt or "You are a competitive intelligence analyst.",
        tools=[{"type": "web_search_20250305", "name": "web_search", "max_uses": 10}],
        messages=[{"role": "user", "content": prompt}],
    )
    text = "".join(block.text for block in message.content if block.type == "text")
    results = parse_json_value(text, opener="[", closer="]")
    if not isinstance(results, list):
        raise ExtractionError("The identification LLM did not return a list of competitors")

    cleaned: list[dict] = []
    for item in results:
        url = str(item.get("website_url", "")).strip()
        name = str(item.get("company_name", "")).strip()
        if name and url.startswith("http"):
            cleaned.append({
                "company_name": name,
                "website_url": url.rstrip("/"),
                "reason": str(item.get("reason", "")),
            })
    if not cleaned:
        raise ExtractionError("No valid competitors were identified")
    return cleaned[:count]


def compare_with_client(db: Session, client: Client, competitor: Competitor) -> dict:
    """Comparative LLM analysis (PRD §4.4) using the competitor_analysis config."""
    cfg = get_llm_config(db, LLMFunction.competitor_analysis)
    competitor_profile = {
        "industry": competitor.industry,
        "description": competitor.description,
        "products_services": competitor.products_services,
        "target_audience": competitor.target_audience,
        "value_proposition": competitor.value_proposition,
        "business_objectives": competitor.business_objectives,
        "communication_tone": competitor.communication_tone,
        "social_media_urls": competitor.social_media_urls,
    }
    prompt = (
        f"{COMPARISON_INSTRUCTIONS}\n\n"
        f"{_profile_text('CLIENT', client.company_name, client.website_url, client_profile_dict(client))}\n\n"
        f"{_profile_text('COMPETITOR', competitor.company_name, competitor.website_url, competitor_profile)}"
    )
    result = parse_json_value(complete_text(cfg, cfg.system_prompt, prompt))
    return {
        "positioning": str(result.get("positioning", "")),
        "strengths": [str(s) for s in result.get("strengths", []) if s],
        "weaknesses": [str(w) for w in result.get("weaknesses", []) if w],
    }
