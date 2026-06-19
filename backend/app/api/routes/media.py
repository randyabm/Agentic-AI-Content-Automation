"""Public, token-guarded media proxy (Phase 2).

Unauthenticated by design — access is gated by a short-lived signed token — so
external services (Zernio, the social platforms) can fetch post media by URL.
"""
import jwt as pyjwt
from fastapi import APIRouter, HTTPException, Response, status

from app.services import storage
from app.services.media_links import verify_media_token

router = APIRouter(prefix="/media", tags=["media"])


@router.get("/public/{token}")
def public_media(token: str):
    try:
        object_key = verify_media_token(token)
    except pyjwt.PyJWTError:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Not found")
    try:
        data, content_type = storage.get_object(object_key)
    except Exception:  # noqa: BLE001 — any storage miss is a 404 to the fetcher
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Not found")
    # Allow downstream caching; the token already bounds the lifetime.
    return Response(content=data, media_type=content_type, headers={"Cache-Control": "public, max-age=3600"})
