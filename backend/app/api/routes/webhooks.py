"""Inbound webhooks (Phase 2) — Zernio publish-status callbacks.

Zernio signs each call with an HMAC-SHA256 `X-Zernio-Signature` header. We verify
it when a secret is configured (recommended in production), then apply the status
to the matching ScheduledPost.
"""
import hashlib
import hmac
import json

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.db.session import get_db
from app.services import publishing

router = APIRouter(prefix="/webhooks", tags=["webhooks"])


@router.post("/zernio")
async def zernio_webhook(request: Request, db: Session = Depends(get_db)):
    raw = await request.body()

    secret = get_settings().zernio_webhook_secret
    if secret:
        signature = request.headers.get("X-Zernio-Signature", "")
        expected = hmac.new(secret.encode(), raw, hashlib.sha256).hexdigest()
        if not hmac.compare_digest(signature, expected):
            raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid signature")

    try:
        event = json.loads(raw or b"{}")
    except json.JSONDecodeError:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Invalid JSON")

    post = event.get("post") or event.get("data") or event
    zernio_post_id = post.get("_id") or post.get("id") or ""
    if zernio_post_id:
        publishing.update_from_zernio_status(db, zernio_post_id, post)
    return {"ok": True}
