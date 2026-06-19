"""Scheduling calendar (SOCIAL_PUBLISHING_PLAN.md Phase 3).

The publishing calendar for a client: every future-dated `ScheduledPost` plus
recently-sent ones, enriched with their post/campaign/channel context. Scheduled
posts can be rescheduled or cancelled while still pending; the Celery Beat sweep
(`social.publish_due`) sends them when their time arrives.

Tenant isolation runs through the owning client's organization, like the rest of
the brand-content routes.
"""
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import assert_client_access, get_current_user, require_client, require_editor, require_reviewer
from app.db.session import get_db
from app.models.campaign import ApprovalStatus, Campaign, Post
from app.models.client import Client
from app.models.social import PublishStatus, ScheduledPost, SocialAccount
from app.models.user import User
from app.schemas.social import CalendarItemOut, RescheduleRequest, ReviewQueueItem, ScheduledPostOut
from app.services import audit

router = APIRouter(tags=["scheduling"])


@router.get("/review-queue", response_model=list[ReviewQueueItem])
def review_queue(db: Session = Depends(get_db), actor: User = Depends(require_reviewer)):
    """Posts awaiting review across the reviewer's organization (newest first)."""
    if actor.org_id is None:  # platform admin has no brand content
        return []
    rows = db.execute(
        select(Post, Campaign, Client)
        .join(Campaign, Campaign.id == Post.campaign_id)
        .join(Client, Client.id == Campaign.client_id)
        .where(Client.org_id == actor.org_id, Post.approval_status == ApprovalStatus.pending_review)
        .order_by(Post.updated_at.desc())
    ).all()
    return [
        ReviewQueueItem(
            post_id=post.id,
            campaign_id=campaign.id,
            campaign_name=campaign.name,
            client_id=client.id,
            client_name=client.company_name,
            platform=post.platform.value,
            headline=post.headline or "",
            preview=(post.copy or post.headline or "").strip().replace("\n", " ")[:140],
            approval_status=post.approval_status.value,
            updated_at=post.updated_at,
        )
        for post, campaign, client in rows
    ]


def _preview(post: Post) -> str:
    text = (post.copy or post.headline or "").strip().replace("\n", " ")
    return text[:140] + ("…" if len(text) > 140 else "")


def _to_item(sp: ScheduledPost, post: Post, campaign: Campaign, channel: SocialAccount | None) -> CalendarItemOut:
    return CalendarItemOut(
        id=sp.id,
        status=sp.status,
        scheduled_at=sp.scheduled_at,
        timezone=sp.timezone,
        published_url=sp.published_url,
        error=sp.error,
        created_at=sp.created_at,
        post_id=sp.post_id,
        campaign_id=campaign.id,
        campaign_name=campaign.name,
        platform=post.platform.value,
        headline=post.headline or "",
        preview=_preview(post),
        channel_id=channel.id if channel else "",
        channel_name=channel.display_name if channel else "",
        channel_avatar=channel.avatar_url if channel else "",
    )


@router.get("/clients/{client_id}/calendar", response_model=list[CalendarItemOut])
def client_calendar(
    client: Client = Depends(require_client),
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
):
    """All scheduled / publishing / recently-published posts for this client,
    ordered by time, for the calendar view."""
    rows = db.execute(
        select(ScheduledPost, Post, Campaign)
        .join(Post, Post.id == ScheduledPost.post_id)
        .join(Campaign, Campaign.id == Post.campaign_id)
        .where(Campaign.client_id == client.id)
        .order_by(ScheduledPost.scheduled_at.is_(None), ScheduledPost.scheduled_at, ScheduledPost.created_at)
    ).all()
    channels = {c.id: c for c in db.scalars(select(SocialAccount).where(SocialAccount.client_id == client.id)).all()}
    return [_to_item(sp, post, campaign, channels.get(sp.social_account_id)) for sp, post, campaign in rows]


# --- single scheduled-post management (reschedule / cancel) ---


def _load_scheduled(db: Session, sp_id: str, user: User) -> tuple[ScheduledPost, Post, Campaign]:
    """Load a scheduled post and enforce org access through its client."""
    sp = db.get(ScheduledPost, sp_id)
    if sp is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Scheduled post not found")
    post = db.get(Post, sp.post_id)
    campaign = db.get(Campaign, post.campaign_id) if post else None
    client = db.get(Client, campaign.client_id) if campaign else None
    if post is None or campaign is None or client is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Scheduled post not found")
    assert_client_access(user, client)
    return sp, post, campaign


@router.patch("/scheduled-posts/{sp_id}", response_model=ScheduledPostOut)
def reschedule(
    sp_id: str,
    body: RescheduleRequest,
    db: Session = Depends(get_db),
    actor: User = Depends(require_editor),
):
    """Move a still-pending scheduled post to a new future time."""
    sp, post, _ = _load_scheduled(db, sp_id, actor)
    if sp.status != PublishStatus.scheduled:
        raise HTTPException(status.HTTP_409_CONFLICT, "Only a pending scheduled post can be rescheduled.")
    when = body.scheduled_at
    if when.tzinfo is None:
        when = when.replace(tzinfo=timezone.utc)
    if when <= datetime.now(timezone.utc):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Scheduled time must be in the future.")
    sp.scheduled_at = when
    if body.timezone:
        sp.timezone = body.timezone
    db.commit()
    audit.record(db, actor, "post.reschedule", "post", post.id, {"scheduled_post": sp.id, "scheduled_at": when.isoformat()})
    db.refresh(sp)
    return sp


@router.delete("/scheduled-posts/{sp_id}", status_code=status.HTTP_204_NO_CONTENT)
def cancel_scheduled(
    sp_id: str,
    db: Session = Depends(get_db),
    actor: User = Depends(require_editor),
):
    """Cancel a still-pending scheduled post (removes it from the calendar)."""
    sp, post, _ = _load_scheduled(db, sp_id, actor)
    if sp.status != PublishStatus.scheduled:
        raise HTTPException(status.HTTP_409_CONFLICT, "Only a pending scheduled post can be cancelled.")
    db.delete(sp)
    db.commit()
    audit.record(db, actor, "post.unschedule", "post", post.id, {"scheduled_post": sp_id})
