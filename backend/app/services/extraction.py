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

# Keep the corpus under ~25k tokens so a single request fits within low
# per-minute token rate limits (e.g. 30k TPM on entry Anthropic tiers).
MAX_CORPUS_CHARS = 100_000

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
    from app.services import providers

    cfg = db.scalar(select(LLMConfig).where(LLMConfig.function == function))
    if cfg is None or not cfg.is_active:
        raise ExtractionError(f"No active LLM configured for function '{function.value}'")
    # The key lives on the central provider credential; fall back to the config's
    # own key for rows that predate central credentials.
    cfg.resolved_api_key = providers.resolve_api_key(db, cfg.provider, cfg.api_key_encrypted)
    if not cfg.resolved_api_key:
        raise ExtractionError(
            f"No API key configured for provider '{cfg.provider}'. "
            "An Admin must set it under Providers & Keys in System Settings."
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


def complete_text(
    cfg: LLMConfig, system_prompt: str, user_prompt: str, temperature: float | None = None
) -> str:
    api_key = getattr(cfg, "resolved_api_key", "") or decrypt_secret(cfg.api_key_encrypted)
    temp = cfg.temperature if temperature is None else temperature
    if cfg.provider == "anthropic":
        # Retries with backoff absorb per-minute token rate limits (429s).
        client = anthropic.Anthropic(api_key=api_key, max_retries=5)
        message = client.messages.create(
            model=cfg.model_name,
            max_tokens=cfg.max_tokens,
            temperature=min(temp, 1.0),
            system=system_prompt,
            messages=[{"role": "user", "content": user_prompt}],
        )
        return "".join(block.text for block in message.content if block.type == "text")
    if cfg.provider in ("openrouter", "openai"):
        # Both speak the OpenAI chat-completions dialect; only the base URL differs.
        base = "https://openrouter.ai/api/v1" if cfg.provider == "openrouter" else "https://api.openai.com/v1"
        payload: dict = {
            "model": cfg.model_name,
            "temperature": temp,
            "messages": [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
            ],
        }
        # OpenAI reasoning models (o-series, gpt-5*) reject max_tokens and fixed
        # temperature; use the newer parameter and let them default.
        if cfg.provider == "openai" and (cfg.model_name.startswith("o") or cfg.model_name.startswith("gpt-5")):
            payload.pop("temperature")
            payload["max_completion_tokens"] = cfg.max_tokens
        else:
            payload["max_tokens"] = cfg.max_tokens
        response = httpx.post(
            f"{base}/chat/completions",
            headers={"Authorization": f"Bearer {api_key}"},
            json=payload,
            timeout=180,
        )
        if response.status_code >= 400:
            raise ExtractionError(
                f"{cfg.provider} request failed ({response.status_code}): {response.text[:300]}"
            )
        return response.json()["choices"][0]["message"]["content"]
    raise ExtractionError(f"Unsupported LLM provider: {cfg.provider}")


def parse_json_value(text: str, opener: str = "{", closer: str = "}"):
    """Extract and parse the outermost JSON object (or array) from LLM output."""
    start, end = text.find(opener), text.rfind(closer)
    if start == -1 or end == -1:
        raise ExtractionError("The LLM response did not contain the expected JSON")
    try:
        return json.loads(text[start : end + 1])
    except json.JSONDecodeError as exc:
        raise ExtractionError(f"Could not parse the LLM response as JSON: {exc}") from exc


BRAND_MEMORY_INSTRUCTIONS = """\
From the company profile below, infer the brand's Brand Memory. Answer ONLY with a
single JSON object using exactly these keys:

{
  "brand_tone": string (tone & voice guidelines, 2-4 sentences),
  "brand_words_required": [string, ...] (words/phrases the brand should always use),
  "brand_words_forbidden": [string, ...] (words/phrases the brand should avoid),
  "brand_visual_style": string (e.g. minimalist, vibrant, corporate — short phrase),
  "brand_copy_examples": [string, ...] (2-4 short on-brand example copy lines),
  "brand_legal_disclaimer": string (recurring legal/disclaimer text, empty if none)
}

All values in English. Only infer what the profile supports; use empty string/list
when unknown — never invent legal text.
"""


def generate_brand_memory(db: Session, profile_text: str) -> dict:
    """Infer Brand Memory fields from a client's profile text (PRD §5.3.3).

    Colors are derived separately from the logo, not by the LLM.
    """
    cfg = get_llm_config(db, LLMFunction.brand_memory)
    raw = complete_text(cfg, cfg.system_prompt, f"{BRAND_MEMORY_INSTRUCTIONS}\n\nCOMPANY PROFILE:\n\n{profile_text}")
    data = parse_json_value(raw)
    expected = {
        "brand_tone": "", "brand_words_required": [], "brand_words_forbidden": [],
        "brand_visual_style": "", "brand_copy_examples": [], "brand_legal_disclaimer": "",
    }
    normalized = {}
    for key, default in expected.items():
        value = data.get(key, default)
        if isinstance(default, list) and not isinstance(value, list):
            value = [value] if value else []
        if isinstance(default, str) and not isinstance(value, str):
            value = str(value)
        normalized[key] = value
    return normalized


def extract_client_profile(
    db: Session, pages: list[CrawledPage], function: LLMFunction = LLMFunction.client_extraction
) -> dict:
    if not pages:
        raise ExtractionError("The crawler could not retrieve any pages from the website")
    cfg = get_llm_config(db, function)
    corpus = build_corpus(pages)
    raw = complete_text(cfg, cfg.system_prompt, f"{PROFILE_SCHEMA_INSTRUCTIONS}\n\nWEBSITE CONTENT:\n\n{corpus}")
    draft = parse_json_value(raw)

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
