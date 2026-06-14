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
from app.services.crawler import CrawledPage
from app.services.extraction import (
    ExtractionError,
    build_corpus,
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

# Single-call instructions: extract the competitor's profile from its crawled site AND
# compare it to the client, in one JSON object. Halves the LLM round-trips per
# competitor versus the separate extract-then-compare flow.
COMBINED_INSTRUCTIONS = """\
You are a competitive intelligence analyst. You are given the CLIENT profile (below)
and the raw crawled website content of a COMPETITOR (in the next message). Do two
things and answer ONLY with a single JSON object using exactly these keys:

{
  "industry": string,
  "description": string (2-4 paragraphs describing the competitor),
  "products_services": string (detailed list/description of the competitor's products and services),
  "target_audience": string,
  "value_proposition": string,
  "business_objectives": [string, ...] (inferred business objectives of the competitor),
  "communication_tone": string (perceived communication tone of the competitor's brand),
  "social_media_urls": [string, ...] (social media profile URLs found in the competitor content),
  "positioning": string (2-3 paragraphs: the competitor's differential positioning relative to the client),
  "strengths": [string, ...] (4-7 strengths of the competitor versus the client),
  "weaknesses": [string, ...] (4-7 weaknesses of the competitor versus the client)
}

For the first nine keys, extract only from the COMPETITOR website content — never
invent facts; use an empty string or empty list when something cannot be determined.
For positioning/strengths/weaknesses, be specific and comparative — every point must
relate the competitor to the client. Write everything in English.
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


def _normalize_analysis(result: dict) -> dict:
    """Coerce the combined LLM output into the competitor's stored shape."""
    str_keys = (
        "industry", "description", "products_services", "target_audience",
        "value_proposition", "communication_tone", "positioning",
    )
    list_keys = ("business_objectives", "social_media_urls", "strengths", "weaknesses")
    out: dict = {}
    for key in str_keys:
        value = result.get(key, "")
        out[key] = value if isinstance(value, str) else str(value)
    for key in list_keys:
        value = result.get(key, [])
        if not isinstance(value, list):
            value = [value] if value else []
        out[key] = [str(item) for item in value if item]
    return out


def analyze_competitor(
    db: Session, client: Client, competitor: Competitor, pages: list[CrawledPage]
) -> dict:
    """Extract the competitor profile and compare it to the client in ONE LLM call.

    The stable client-profile block is sent as a cached prompt prefix (Anthropic
    prompt caching), so analysing several competitors of the same client reuses it.
    Returns the competitor's profile fields plus positioning/strengths/weaknesses.
    """
    if not pages:
        raise ExtractionError("The crawler could not retrieve any pages from the competitor's website")
    cfg = get_llm_config(db, LLMFunction.competitor_analysis)
    corpus = build_corpus(pages)
    client_block = _profile_text(
        "CLIENT", client.company_name, client.website_url, client_profile_dict(client)
    )
    cached_prefix = f"{COMBINED_INSTRUCTIONS}\n\n{client_block}"
    competitor_msg = (
        f"COMPETITOR WEBSITE CONTENT — {competitor.company_name} ({competitor.website_url}):\n\n{corpus}"
    )

    if cfg.provider == "anthropic":
        api_key = getattr(cfg, "resolved_api_key", "") or decrypt_secret(cfg.api_key_encrypted)
        api = anthropic.Anthropic(api_key=api_key, max_retries=5)
        message = api.messages.create(
            model=cfg.model_name,
            max_tokens=cfg.max_tokens,
            temperature=min(cfg.temperature, 1.0),
            system=[
                {"type": "text", "text": cfg.system_prompt or "You are a competitive intelligence analyst."},
                {"type": "text", "text": cached_prefix, "cache_control": {"type": "ephemeral"}},
            ],
            messages=[{"role": "user", "content": competitor_msg}],
        )
        raw = "".join(block.text for block in message.content if block.type == "text")
    else:
        # Other providers have no shared-prefix caching; send it all in one prompt.
        raw = complete_text(cfg, cfg.system_prompt, f"{cached_prefix}\n\n{competitor_msg}")

    return _normalize_analysis(parse_json_value(raw))
