"""Smart scheduling slots (Phase 2): drop approved, unscheduled posts into the
next open recurring slot times for a client."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.campaign import ApprovalStatus, Campaign, Post
from app.models.client import Client
from app.models.posting_slot import PostingSlot
from app.models.social import ChannelStatus, ScheduledPost, SocialAccount
from app.services import publishing


def _tz(name: str):
    try:
        return ZoneInfo(name) if name else timezone.utc
    except Exception:
        return timezone.utc


def upcoming_slot_times(slots: list[PostingSlot], tz_name: str, weeks: int = 8) -> list[tuple[datetime, PostingSlot]]:
    """Concrete future datetimes (UTC) for each recurring slot, chronological."""
    tz = _tz(tz_name)
    now = datetime.now(tz)
    out: list[tuple[datetime, PostingSlot]] = []
    for slot in slots:
        for wk in range(weeks):
            days_ahead = (slot.weekday - now.weekday()) % 7 + wk * 7
            local = (now + timedelta(days=days_ahead)).replace(
                hour=slot.hour, minute=slot.minute, second=0, microsecond=0
            )
            if local > now:
                out.append((local.astimezone(timezone.utc), slot))
    out.sort(key=lambda x: x[0])
    return out


def fill_slots(db: Session, client: Client, actor_id: str, tz_name: str = "UTC") -> dict:
    """Schedule approved+connected unscheduled posts into upcoming slots.
    Returns {scheduled, skipped, reason}."""
    slots = list(db.scalars(
        select(PostingSlot).where(PostingSlot.client_id == client.id, PostingSlot.active.is_(True))
    ))
    if not slots:
        return {"scheduled": 0, "skipped": 0, "reason": "No active slots configured."}

    times = upcoming_slot_times(slots, tz_name)
    if not times:
        return {"scheduled": 0, "skipped": 0, "reason": "No upcoming slot times."}

    # Existing bookings for this client — avoid double-booking a time.
    booked = {
        sp.scheduled_at.replace(second=0, microsecond=0)
        for sp in db.scalars(
            select(ScheduledPost)
            .join(Post, Post.id == ScheduledPost.post_id)
            .join(Campaign, Campaign.id == Post.campaign_id)
            .where(Campaign.client_id == client.id, ScheduledPost.scheduled_at.is_not(None))
        )
        if sp.scheduled_at is not None
    }

    scheduled_ids = select(ScheduledPost.post_id).scalar_subquery()
    posts = list(db.scalars(
        select(Post)
        .join(Campaign, Campaign.id == Post.campaign_id)
        .where(
            Campaign.client_id == client.id,
            Post.approval_status.in_((ApprovalStatus.approved, ApprovalStatus.not_required)),
            ~Post.id.in_(scheduled_ids),
        )
        .order_by(Post.updated_at.desc())
    ))
    channels = {
        c.platform: c
        for c in db.scalars(
            select(SocialAccount).where(
                SocialAccount.client_id == client.id,
                SocialAccount.status == ChannelStatus.connected,
            )
        )
    }

    used: set[datetime] = set()
    scheduled = 0
    skipped = 0
    for post in posts:
        channel = channels.get(post.platform.value)
        if channel is None:
            skipped += 1
            continue
        placed = False
        for when, slot in times:
            if when in used or when in booked:
                continue
            if slot.platform and slot.platform != post.platform.value:
                continue
            try:
                publishing.schedule_post(db, post, channel, actor_id, when, tz_name=tz_name)
            except publishing.DuplicatePost:
                used.add(when)  # burn the slot; try this post in a later one
                continue
            except publishing.PublishError:
                break
            used.add(when)
            scheduled += 1
            placed = True
            break
        if not placed:
            skipped += 1
    return {"scheduled": scheduled, "skipped": skipped, "reason": ""}
