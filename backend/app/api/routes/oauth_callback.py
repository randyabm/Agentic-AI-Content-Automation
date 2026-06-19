"""OAuth callback handler for direct social account connections.

Platforms redirect here after the user authorizes the app:
  GET /auth/{platform}/callback?code=...&state=...

The handler:
  1. Verifies the state JWT (carries client_id + user_id)
  2. Exchanges the authorization code for platform tokens
  3. Upserts SocialAccount rows (one per page for Facebook/Instagram)
  4. Redirects the browser to the frontend callback page
"""
from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, Request
from fastapi.responses import RedirectResponse
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.services.direct_social import (
    DirectSocialError,
    exchange_code,
    get_app_frontend_url,
    upsert_channel,
    verify_state,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/auth", tags=["oauth"])


@router.get("/{platform}/callback")
def oauth_callback(
    platform: str,
    request: Request,
    db: Session = Depends(get_db),
    code: str = "",
    state: str = "",
    error: str = "",
    error_description: str = "",
):
    """Receive the OAuth authorization code from the social platform and exchange
    it for access tokens. Redirects the user's browser to the frontend success
    or error page when done."""
    frontend_url = get_app_frontend_url(db)
    base_redirect = f"{frontend_url}/auth/callback"

    # --- user denied access ---
    if error:
        msg = error_description or error
        return RedirectResponse(
            f"{base_redirect}?status=error&platform={platform}&error={msg}",
            status_code=302,
        )

    if not code or not state:
        return RedirectResponse(
            f"{base_redirect}?status=error&platform={platform}&error=Missing+code+or+state",
            status_code=302,
        )

    try:
        state_payload = verify_state(state)
        client_id: str = state_payload["client_id"]
        actor_id: str = state_payload["user_id"]
        intended_platform: str = state_payload.get("platform", platform)

        accounts = exchange_code(db, intended_platform, code, state_payload)

        if not accounts:
            return RedirectResponse(
                f"{base_redirect}?status=error&platform={platform}"
                f"&error=No+accounts+found.+Ensure+you+have+at+least+one+connected+page.",
                status_code=302,
            )

        for account in accounts:
            upsert_channel(db, client_id, actor_id, account)
        db.commit()

        count = len(accounts)
        return RedirectResponse(
            f"{base_redirect}?status=ok&platform={intended_platform}"
            f"&client_id={client_id}&count={count}",
            status_code=302,
        )

    except DirectSocialError as exc:
        logger.warning("OAuth callback error for %s: %s", platform, exc)
        return RedirectResponse(
            f"{base_redirect}?status=error&platform={platform}&error={str(exc)[:200]}",
            status_code=302,
        )
    except Exception as exc:
        logger.exception("Unexpected OAuth callback error for %s", platform)
        return RedirectResponse(
            f"{base_redirect}?status=error&platform={platform}&error=Unexpected+error",
            status_code=302,
        )
