"""AI brand-safety checks and feedback-driven rewrite (Phase 3).

Reuses the editorial LLM config + provider abstraction. Pre-approval, a reviewer
can run a brand/risky-claim check; and a rejected post can be auto-rewritten
from the reviewer's comment.
"""
from __future__ import annotations

import json
import logging

from sqlalchemy.orm import Session

from app.models.campaign import Campaign, Post
from app.models.client import Client
from app.models.llm import LLMFunction
from app.services.campaign_gen import _client_context
from app.services.extraction import complete_text, get_llm_config

logger = logging.getLogger(__name__)


def _parse_json(raw: str) -> dict:
    text = raw.strip()
    if text.startswith("```"):
        text = text.strip("`")
        if text.lower().startswith("json"):
            text = text[4:]
    start, end = text.find("{"), text.rfind("}")
    if start >= 0 and end > start:
        text = text[start : end + 1]
    try:
        return json.loads(text)
    except Exception:
        return {"risk": "unknown", "issues": [{"type": "parse", "severity": "low", "detail": raw[:300]}]}


def brand_check(db: Session, client: Client, post: Post) -> dict:
    """Flag brand-guideline violations and risky/unverifiable claims.
    Returns {"risk": low|medium|high, "issues": [{type, severity, detail}]}."""
    cfg = get_llm_config(db, LLMFunction.editorial_agent)
    system = (
        "You are a brand-compliance and risk reviewer for social media copy. "
        "Return ONLY compact JSON, no preamble or markdown."
    )
    prompt = (
        f"BRAND GUIDELINES:\n{_client_context(client)}\n\n"
        f"Review this {post.platform.value} post for: (1) brand-guideline violations "
        "(tone, forbidden words, missing required words); (2) risky or unverifiable "
        "claims (medical/financial/legal, absolute guarantees, superlatives); "
        "(3) compliance/legal issues.\n\n"
        f"POST:\nHeadline: {post.headline}\nCopy: {post.copy}\nCTA: {post.cta}\n"
        f"Hashtags: {' '.join(post.hashtags or [])}\n\n"
        'Return JSON: {"risk":"low|medium|high","issues":[{"type":"brand|claim|compliance",'
        '"severity":"low|medium|high","detail":"..."}]}. If nothing is wrong return '
        '{"risk":"low","issues":[]}.'
    )
    raw = complete_text(cfg, system, prompt, temperature=0.2)
    result = _parse_json(raw)
    result.setdefault("risk", "unknown")
    result.setdefault("issues", [])
    return result


def rewrite_from_feedback(db: Session, client: Client, campaign: Campaign, post: Post, feedback: str) -> str:
    """Return a rewritten `copy` that addresses the reviewer's feedback."""
    cfg = get_llm_config(db, LLMFunction.editorial_agent)
    system = (
        "You are an expert social copy editor. Rewrite the post copy to address the "
        "reviewer's feedback while staying on-brand. Return ONLY the revised copy — "
        "no preamble, quotes, or markdown. Preserve the original language."
    )
    prompt = (
        f"BRAND CONTEXT:\n{_client_context(client)}\n\n"
        f"PLATFORM: {post.platform.value}\n\n"
        f"REVIEWER FEEDBACK:\n{feedback}\n\n"
        f"CURRENT COPY:\n{post.copy}"
    )
    return complete_text(cfg, system, prompt, temperature=0.6).strip().strip('"').strip()
