"""LLM-powered client profile extraction from crawled website content (PRD §3.3).

Uses the LLM configured for the `client_extraction` function (Anthropic Claude by
default). Returns a structured draft the user reviews before it is applied.
"""
import json
import logging

import anthropic
import httpx
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.crypto import decrypt_secret
from app.models.llm import LLMConfig, LLMFunction
from app.services.crawler import CrawledPage

logger = logging.getLogger(__name__)

# Keep the corpus within a safe context budget (~150k chars ≈ 40k tokens).
MAX_CORPUS_CHARS = 150_000

PROFILE_SCHEMA_INSTRUCTIONS = """\
Extract the company profile from the website content below and answer ONLY with a
single JSON object using exactly these keys:

{
  "company_name": string,
  "industry": string,
  "description": string (2-4 paragraphs, general description of the company),
  "products_services": string (detailed list/description of products and services),
  "target_audience": string,
  "value_proposition": string,
  "business_objectives": [string, ...] (inferred business objectives),
  "communication_tone": string (perceived communication tone of the brand),
  "social_media_urls": [string, ...] (social media profile URLs found in the content)
}

All values must be written in English. If something cannot be determined from the
content, use an empty string or empty list — never invent facts.
"""


class ExtractionError(Exception):
    pass


def get_llm_config(db: Session, function: LLMFunction) -> LLMConfig:
    cfg = db.scalar(select(LLMConfig).where(LLMConfig.function == function))
    if cfg is None or not cfg.is_active:
        raise ExtractionError(f"No active LLM configured for function '{function.value}'")
    if not decrypt_secret(cfg.api_key_encrypted):
        raise ExtractionError(
            f"The LLM for '{function.value}' has no API key configured. "
            "An Admin must set it in System Configuration."
        )
    return cfg


def build_corpus(pages: list[CrawledPage]) -> str:
    chunks: list[str] = []
    used = 0
    for page in pages:
        chunk = f"=== PAGE: {page.url}\nTITLE: {page.title}\n{page.text}\n"
        if used + len(chunk) > MAX_CORPUS_CHARS:
            remaining = MAX_CORPUS_CHARS - used
            if remaining > 500:
                chunks.append(chunk[:remaining])
            break
        chunks.append(chunk)
        used += len(chunk)
    return "\n".join(chunks)


def _complete(cfg: LLMConfig, system_prompt: str, user_prompt: str) -> str:
    api_key = decrypt_secret(cfg.api_key_encrypted)
    if cfg.provider == "anthropic":
        client = anthropic.Anthropic(api_key=api_key)
        message = client.messages.create(
            model=cfg.model_name,
            max_tokens=cfg.max_tokens,
            temperature=min(cfg.temperature, 1.0),
            system=system_prompt,
            messages=[{"role": "user", "content": user_prompt}],
        )
        return "".join(block.text for block in message.content if block.type == "text")
    if cfg.provider == "openrouter":
        response = httpx.post(
            "https://openrouter.ai/api/v1/chat/completions",
            headers={"Authorization": f"Bearer {api_key}"},
            json={
                "model": cfg.model_name,
                "max_tokens": cfg.max_tokens,
                "temperature": cfg.temperature,
                "messages": [
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": user_prompt},
                ],
            },
            timeout=180,
        )
        response.raise_for_status()
        return response.json()["choices"][0]["message"]["content"]
    raise ExtractionError(f"Unsupported LLM provider: {cfg.provider}")


def _parse_json_object(text: str) -> dict:
    start, end = text.find("{"), text.rfind("}")
    if start == -1 or end == -1:
        raise ExtractionError("The LLM response did not contain a JSON object")
    try:
        return json.loads(text[start : end + 1])
    except json.JSONDecodeError as exc:
        raise ExtractionError(f"Could not parse the LLM response as JSON: {exc}") from exc


def extract_client_profile(db: Session, pages: list[CrawledPage]) -> dict:
    if not pages:
        raise ExtractionError("The crawler could not retrieve any pages from the website")
    cfg = get_llm_config(db, LLMFunction.client_extraction)
    corpus = build_corpus(pages)
    raw = _complete(cfg, cfg.system_prompt, f"{PROFILE_SCHEMA_INSTRUCTIONS}\n\nWEBSITE CONTENT:\n\n{corpus}")
    draft = _parse_json_object(raw)

    expected = {
        "company_name": "", "industry": "", "description": "", "products_services": "",
        "target_audience": "", "value_proposition": "", "business_objectives": [],
        "communication_tone": "", "social_media_urls": [],
    }
    normalized = {}
    for key, default in expected.items():
        value = draft.get(key, default)
        if isinstance(default, list) and not isinstance(value, list):
            value = [value] if value else []
        if isinstance(default, str) and not isinstance(value, str):
            value = str(value)
        normalized[key] = value
    return normalized
