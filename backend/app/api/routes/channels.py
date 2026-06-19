"""Per-client connected social channels.

Routes work transparently in both publishing modes:
  - 'zernio': Zernio is the OAuth middleman; connect returns Zernio's hosted-OAuth URL.
  - 'direct': Platform OAuth directly; connect returns the platform's own OAuth URL
    and the callback (handled by oauth_callback.py) stores the token here.

Every route is under a client_id and protected by `require_client`, so only members
of the owning org can reach it.
"""
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import get_current_user, require_client, require_editor
from app.db.session import get_db
from app.models.client import Client
from app.models.social import ChannelStatus, SocialAccount
from app.models.user import User
from app.schemas.social import ChannelConnectResponse, SocialAccountOut
from app.services import audit, zernio
from app.services.direct_social import (
    DirectSocialError,
    get_connect_url,
    get_publishing_mode,
    verify_channel_health,
)

router = APIRouter(
    prefix="/clients/{client_id}/channels",
    tags=["channels"],
    dependencies=[Depends(require_client)],
)


def _channels(db: Session, client_id: str) -> list[SocialAccount]:
    return db.scalars(
        select(SocialAccount)
        .where(SocialAccount.client_id == client_id)
        .order_by(SocialAccount.created_at)
    ).all()


# --- Zernio helpers (unchanged) ----------------------------------------------


def _upsert_from_zernio(
    db: Session, client_id: str, profile_id: str, remote: list[dict], actor_id: str
) -> None:
    """Mirror Zernio's accounts for this profile into local SocialAccount rows."""
    existing = {a.zernio_account_id: a for a in _channels(db, client_id)}
    seen: set[str] = set()
    for raw in remote:
        info = zernio.summarize_account(raw)
        aid = info["zernio_account_id"]
        if not aid:
            continue
        seen.add(aid)
        row = existing.get(aid)
        if row is None:
            row = SocialAccount(client_id=client_id, connected_by=actor_id)
            db.add(row)
        row.zernio_account_id = aid
        row.zernio_profile_id = profile_id
        row.platform = info["platform"]
        row.display_name = info["display_name"]
        row.username = info["username"]
        row.avatar_url = info["avatar_url"]
        row.status = ChannelStatus(info["status"])
        row.token_expires_at = info["token_expires_at"]
        row.last_verified_at = datetime.now(timezone.utc)
        row.error = ""
    for aid, row in existing.items():
        if aid not in seen:
            row.status = ChannelStatus.disconnected
    db.commit()


# --- Routes ------------------------------------------------------------------


@router.get("", response_model=list[SocialAccountOut])
def list_channels(client_id: str, db: Session = Depends(get_db), _: User = Depends(get_current_user)):
    return _channels(db, client_id)


@router.post("/connect/{platform}", response_model=ChannelConnectResponse)
def connect_channel(
    platform: str,
    client: Client = Depends(require_client),
    db: Session = Depends(get_db),
    actor: User = Depends(require_editor),
):
    """Return the OAuth authorization URL for the given platform.

    In Zernio mode: returns Zernio's hosted-OAuth URL (user authorizes on Zernio,
    then clicks Sync to pull the account in).
    In direct mode: returns the platform's own OAuth URL (user authorizes on the
    platform, the backend callback stores the token, then a frontend postMessage
    triggers a channel refresh).
    """
    mode = get_publishing_mode(db)

    if mode == "direct":
        try:
            url = get_connect_url(db, platform, client.id, actor.id)
        except DirectSocialError as exc:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, str(exc))
        audit.record(db, actor, "channel.connect_start", "client", client.id,
                     {"platform": platform, "mode": "direct"})
        return ChannelConnectResponse(platform=platform, connect_url=url)

    # --- Zernio mode ---
    profile_id = zernio.ensure_profile(db, client)
    try:
        url = zernio.connect_url(db, profile_id, platform)
    except zernio.ZernioError as exc:
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, str(exc))
    audit.record(db, actor, "channel.connect_start", "client", client.id,
                 {"platform": platform, "mode": "zernio"})
    return ChannelConnectResponse(platform=platform, connect_url=url)


@router.post("/sync", response_model=list[SocialAccountOut])
def sync_channels(
    client: Client = Depends(require_client),
    db: Session = Depends(get_db),
    actor: User = Depends(require_editor),
):
    """Sync / verify all channels for this client.

    Zernio mode: pulls the latest account list + health from Zernio.
    Direct mode: pings each stored channel's token against the platform and
    updates the status (connected / expired / error).
    """
    mode = get_publishing_mode(db)
    channels = _channels(db, client.id)

    if mode == "direct":
        now = datetime.now(timezone.utc)
        for ch in channels:
            ch.status = verify_channel_health(ch)
            ch.last_verified_at = now
        db.commit()
        return channels

    # --- Zernio mode ---
    if not client.zernio_profile_id:
        return []
    try:
        remote = zernio.list_accounts(db, client.zernio_profile_id)
    except zernio.ZernioError as exc:
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, str(exc))
    _upsert_from_zernio(db, client.id, client.zernio_profile_id, remote, actor.id)
    return _channels(db, client.id)


@router.post("/{channel_id}/verify", response_model=SocialAccountOut)
def verify_channel(
    channel_id: str,
    client: Client = Depends(require_client),
    db: Session = Depends(get_db),
    actor: User = Depends(require_editor),
):
    """Re-check a single channel's token health."""
    channel = db.get(SocialAccount, channel_id)
    if channel is None or channel.client_id != client.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Channel not found")

    mode = get_publishing_mode(db)

    if mode == "direct":
        channel.status = verify_channel_health(channel)
        channel.last_verified_at = datetime.now(timezone.utc)
        db.commit()
        db.refresh(channel)
        return channel

    # --- Zernio mode ---
    try:
        remote = zernio.list_accounts(db, client.zernio_profile_id)
    except zernio.ZernioError as exc:
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, str(exc))
    match = next((a for a in remote if a.get("_id") == channel.zernio_account_id), None)
    if match is None:
        channel.status = ChannelStatus.disconnected
    else:
        info = zernio.summarize_account(match)
        channel.status = ChannelStatus(info["status"])
        channel.token_expires_at = info["token_expires_at"]
        channel.display_name = info["display_name"] or channel.display_name
        channel.username = info["username"] or channel.username
    channel.last_verified_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(channel)
    return channel


@router.delete("/{channel_id}", status_code=status.HTTP_204_NO_CONTENT)
def disconnect_channel(
    channel_id: str,
    client: Client = Depends(require_client),
    db: Session = Depends(get_db),
    actor: User = Depends(require_editor),
):
    """Remove the channel locally. The user revokes platform access separately."""
    channel = db.get(SocialAccount, channel_id)
    if channel is None or channel.client_id != client.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Channel not found")
    db.delete(channel)
    db.commit()
    audit.record(db, actor, "channel.disconnect", "client", client.id, {"channel_id": channel_id})
