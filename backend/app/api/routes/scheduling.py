"""Scheduling calendar (SOCIAL_PUBLISHING_PLAN.md Phase 3).

The publishing calendar for a client: every future-dated `ScheduledPost` plus
recently-sent ones, enriched with their post/campaign/channel context. Scheduled
posts can be rescheduled or cancelled while still pending; the Celery Beat sweep
(`social.publish_due`) sends them when their time arrives.

Tenant isolation runs through the owning client's organization, like the rest of
the brand-content routes.
"""
import io
import zipfile
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import assert_client_access, get_current_user, require_capability, require_client
from app.models.permission import Capability
from app.db.session import get_db
from app.models.campaign import ApprovalStatus, Campaign, CampaignApprovalStatus, ContentStatus, Post
from app.models.client import Client
from app.models.posting_slot import PostingSlot
from app.models.social import ChannelStatus, PublishStatus, ScheduledPost, SocialAccount
from app.models.user import User
from app.schemas.social import (
    CalendarItemOut,
    FillSlotsRequest,
    FillSlotsResponse,
    PostingSlotIn,
    PostingSlotOut,
    RescheduleRequest,
    ReviewQueueItem,
    ScheduleablePostOut,
    ScheduledPostOut,
)
from app.services import audit, publishing, slots as slots_service

router = APIRouter(tags=["scheduling"])


@router.get("/review-queue", response_model=list[ReviewQueueItem])
def review_queue(db: Session = Depends(get_db), actor: User = Depends(require_capability(Capability.approve_copy))):
    """Posts and campaigns awaiting review across the organization (newest first)."""
    if actor.org_id is None:  # platform admin has no brand content
        return []
    items: list[ReviewQueueItem] = []

    # 1) Per-post pending reviews. Posts submitted as part of a FULL-campaign
    # review are represented by the campaign card below — listing them here
    # too would duplicate every item in the queue.
    rows = db.execute(
        select(Post, Campaign, Client)
        .join(Campaign, Campaign.id == Post.campaign_id)
        .join(Client, Client.id == Campaign.client_id)
        .where(
            Client.org_id == actor.org_id,
            # A post is "in the review queue" when it's been submitted
            # (content ready_for_review) and the gate is still pending.
            Post.content_status == ContentStatus.ready_for_review,
            Post.approval_status == ApprovalStatus.pending,
        )
        .order_by(Post.updated_at.desc())
    ).all()
    rows = [
        (post, campaign, client) for post, campaign, client in rows
        if not (
            campaign.approval_status == CampaignApprovalStatus.pending_review
            and campaign.approval_scope == "full_campaign"
        )
    ]
    for post, campaign, client in rows:
        items.append(ReviewQueueItem(
            review_type="post",
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
        ))

    # 2) Campaign-level pending reviews
    camp_rows = db.execute(
        select(Campaign, Client)
        .join(Client, Client.id == Campaign.client_id)
        .where(
            Client.org_id == actor.org_id,
            Campaign.approval_status == CampaignApprovalStatus.pending_review,
        )
        .order_by(Campaign.updated_at.desc())
    ).all()
    for campaign, client in camp_rows:
        platforms = ", ".join(p.platform.value for p in campaign.platforms) if campaign.platforms else ""
        items.append(ReviewQueueItem(
            review_type="campaign",
            post_id="",
            campaign_id=campaign.id,
            campaign_name=campaign.name,
            client_id=client.id,
            client_name=client.company_name,
            platform=platforms,
            headline=campaign.name,
            preview=campaign.approval_message or "Awaiting review",
            approval_status=campaign.approval_status.value,
            updated_at=campaign.updated_at,
            assigned_approver_id=campaign.assigned_approver_id,
            approval_due_date=campaign.approval_due_date,
            approval_message=campaign.approval_message or "",
            review_note=campaign.review_note or "",
        ))

    items.sort(key=lambda i: i.updated_at, reverse=True)
    return items


def _preview(post: Post) -> str:
    text = (post.copy or post.headline or "").strip().replace("\n", " ")
    return text[:140] + ("…" if len(text) > 140 else "")


def _to_item(
    sp: ScheduledPost,
    post: Post,
    campaign: Campaign,
    channel: SocialAccount | None,
    client: Client | None = None,
) -> CalendarItemOut:
    return CalendarItemOut(
        id=sp.id,
        status=sp.status,
        scheduled_at=sp.scheduled_at,
        timezone=sp.timezone,
        published_url=sp.published_url,
        error=sp.error,
        error_code=sp.error_code or "",
        retry_count=sp.retry_count or 0,
        max_retries=sp.max_retries or 4,
        next_attempt_at=sp.next_attempt_at,
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
        client_id=client.id if client else "",
        client_name=client.company_name if client else "",
        content_status=post.content_status.value if post.content_status else "",
        approval_status=post.approval_status.value if post.approval_status else "",
        blocked_reason=sp.blocked_reason,
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
    return [_to_item(sp, post, campaign, channels.get(sp.social_account_id), client) for sp, post, campaign in rows]


@router.get("/calendar", response_model=list[CalendarItemOut])
def global_calendar(
    db: Session = Depends(get_db),
    actor: User = Depends(get_current_user),
):
    """Cross-client calendar: all scheduled/publishing/published posts across
    the user's organization, enriched with client + campaign + channel context.
    Platform super-admins get an empty list (they have no brand content)."""
    if actor.org_id is None:
        return []
    rows = db.execute(
        select(ScheduledPost, Post, Campaign, Client)
        .join(Post, Post.id == ScheduledPost.post_id)
        .join(Campaign, Campaign.id == Post.campaign_id)
        .join(Client, Client.id == Campaign.client_id)
        .where(Client.org_id == actor.org_id)
        .order_by(ScheduledPost.scheduled_at.is_(None), ScheduledPost.scheduled_at, ScheduledPost.created_at)
    ).all()
    client_ids = {client.id for _, _, _, client in rows}
    channels = (
        {c.id: c for c in db.scalars(select(SocialAccount).where(SocialAccount.client_id.in_(client_ids))).all()}
        if client_ids
        else {}
    )
    return [
        _to_item(sp, post, campaign, channels.get(sp.social_account_id), client)
        for sp, post, campaign, client in rows
    ]


@router.get("/scheduleable-posts", response_model=list[ScheduleablePostOut])
def scheduleable_posts(
    include_blocked: bool = False,
    db: Session = Depends(get_db),
    actor: User = Depends(get_current_user),
):
    """Posts that have no ScheduledPost yet — ready to be dragged onto the
    calendar. By default only fully-ready posts are returned (approved + a
    connected channel). With ``include_blocked=true`` posts that aren't ready
    yet are also returned, flagged with ``blocked_reason`` (e.g. not approved,
    or no connected channel) so the UI can show them as plan-only — they can be
    placed on the calendar but won't auto-publish until they're ready."""
    from app.models.social import ChannelStatus

    if actor.org_id is None:
        return []
    # Subquery: post_ids that already have a ScheduledPost
    scheduled_post_ids = select(ScheduledPost.post_id).scalar_subquery()
    where = [
        Client.org_id == actor.org_id,
        ~Post.id.in_(scheduled_post_ids),
    ]
    if not include_blocked:
        # The global calendar only schedules cleared posts (approved, or
        # not_required for brands that opted out of approval).
        where.append(Post.approval_status.in_((ApprovalStatus.approved, ApprovalStatus.not_required)))
    rows = db.execute(
        select(Post, Campaign, Client)
        .join(Campaign, Campaign.id == Post.campaign_id)
        .join(Client, Client.id == Campaign.client_id)
        .where(*where)
        .order_by(Post.updated_at.desc())
    ).all()
    if not rows:
        return []
    client_ids = {client.id for _, _, client in rows}
    connected = db.scalars(
        select(SocialAccount).where(
            SocialAccount.client_id.in_(client_ids),
            SocialAccount.status == ChannelStatus.connected,
        )
    ).all()
    channels: dict[str, SocialAccount] = {}
    for ch in connected:
        channels[f"{ch.client_id}|{ch.platform}"] = ch
    out: list[ScheduleablePostOut] = []
    for post, campaign, client in rows:
        ch = channels.get(f"{client.id}|{post.platform.value}")
        approved = post.approval_status in (ApprovalStatus.approved, ApprovalStatus.not_required)
        # Why isn't this post ready to publish? (Empty = ready.)
        if not approved:
            blocked_reason = "Not approved yet"
        elif ch is None:
            blocked_reason = f"No connected {post.platform.value} channel"
        else:
            blocked_reason = ""
        if blocked_reason and not include_blocked:
            continue
        out.append(
            ScheduleablePostOut(
                post_id=post.id,
                campaign_id=campaign.id,
                campaign_name=campaign.name,
                client_id=client.id,
                client_name=client.company_name,
                platform=post.platform.value,
                headline=post.headline or "",
                preview=_preview(post),
                channel_id=ch.id if ch else "",
                channel_name=ch.display_name if ch else "",
                best_time=post.best_time or "",
                blocked_reason=blocked_reason,
            )
        )
    return out


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
    actor: User = Depends(require_capability(Capability.schedule)),
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
    actor: User = Depends(require_capability(Capability.schedule)),
):
    """Cancel a still-pending scheduled post (removes it from the calendar)."""
    sp, post, _ = _load_scheduled(db, sp_id, actor)
    if sp.status != PublishStatus.scheduled:
        raise HTTPException(status.HTTP_409_CONFLICT, "Only a pending scheduled post can be cancelled.")
    db.delete(sp)
    db.commit()
    audit.record(db, actor, "post.unschedule", "post", post.id, {"scheduled_post": sp_id})


@router.post("/scheduled-posts/{sp_id}/retry", response_model=ScheduledPostOut)
def retry_scheduled(
    sp_id: str,
    db: Session = Depends(get_db),
    actor: User = Depends(require_capability(Capability.publish)),
):
    """Manually retry a `failed` scheduled post.

    Resets the row to `scheduled`, clears the error state, zeroes the
    retry_count, and re-arms `next_attempt_at` to now so the next Beat
    tick picks it up immediately. `attempt_history` is preserved so the
    user can still see what failed before.
    """
    sp, post, _ = _load_scheduled(db, sp_id, actor)
    if sp.status != PublishStatus.failed:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            "Only a failed scheduled post can be retried.",
        )
    sp.status = PublishStatus.scheduled
    sp.error = ""
    sp.error_code = ""
    sp.retry_count = 0
    sp.next_attempt_at = datetime.now(timezone.utc)
    # Immediate publishes have scheduled_at NULL, which the due sweep's
    # `scheduled_at <= now` filter never matches — arm it so the retry fires.
    if sp.scheduled_at is None:
        sp.scheduled_at = datetime.now(timezone.utc)
    db.commit()
    audit.record(
        db, actor, "post.retry", "post", post.id,
        {"scheduled_post": sp_id},
    )
    db.refresh(sp)
    return sp


@router.get("/scheduled-posts/{sp_id}/export-pack")
def export_scheduled_post_pack(
    sp_id: str,
    db: Session = Depends(get_db),
    actor: User = Depends(get_current_user),
):
    """Download a ZIP with captions, media, and manual publishing instructions
    for a scheduled post — useful when another team member will manually post."""
    from app.models.campaign import CampaignElement, PostImage, PostVideo
    from app.services import storage
    from app.services.compositing import composite_post_image

    sp, post, campaign = _load_scheduled(db, sp_id, actor)
    client = db.get(Client, campaign.client_id)
    channel = db.get(SocialAccount, sp.social_account_id) if sp.social_account_id else None

    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        # Caption file
        caption_lines = [post.headline or "", "", post.copy or ""]
        if post.hashtags:
            caption_lines.append("")
            caption_lines.append(" ".join(post.hashtags))
        if post.cta:
            caption_lines.append("")
            caption_lines.append(f"CTA: {post.cta}")
        platform_name = post.platform.value
        zf.writestr(
            f"captions/{platform_name}.txt",
            "\n".join(caption_lines),
        )

        # Summary CSV
        import csv
        csv_buf = io.StringIO()
        writer = csv.writer(csv_buf)
        writer.writerow(["Field", "Value"])
        writer.writerow(["Platform", platform_name])
        writer.writerow(["Client", client.company_name if client else ""])
        writer.writerow(["Campaign", campaign.name])
        writer.writerow(["Headline", post.headline or ""])
        writer.writerow(["CTA", post.cta or ""])
        writer.writerow(["Hashtags", " ".join(post.hashtags)])
        writer.writerow(["Scheduled at", sp.scheduled_at.isoformat() if sp.scheduled_at else ""])
        writer.writerow(["Timezone", sp.timezone])
        writer.writerow(["Channel", channel.display_name if channel else ""])
        zf.writestr("summary.csv", csv_buf.getvalue())

        # Publishing instructions
        instructions = f"""Manual Publishing Instructions
================================

Platform: {platform_name}
Client: {client.company_name if client else ""}
Campaign: {campaign.name}

Steps:
1. Open {platform_name} manually (or the mobile app).
2. Copy the caption from captions/{platform_name}.txt.
3. If there are media files in the media/ folder, download and upload them.
4. Paste the caption and upload the media.
5. Publish the post manually.
6. Return to the platform and paste the live URL in the post's "Mark as published" form.

Scheduled time: {sp.scheduled_at.strftime('%Y-%m-%d %H:%M %Z') if sp.scheduled_at else 'Not scheduled'}
"""
        zf.writestr("instructions/publishing_checklist.txt", instructions)

        # Media — find the post's element and its images/videos
        element = db.get(CampaignElement, post.element_id) if post.element_id else None
        if element:
            ratio = (element.platform_ratios or {}).get(post.platform.value)
            images = [i for i in element.images if not ratio or i.aspect_ratio == ratio]
            videos = [v for v in element.videos if not ratio or v.aspect_ratio == ratio]
            for img in images:
                # Prefer composite, then base
                data = None
                if img.composited_object_key:
                    try:
                        data = storage.get_object(img.composited_object_key)[0]
                    except Exception:
                        pass
                if data is None and img.base_object_key:
                    if img.canvas_state and client:
                        try:
                            data = composite_post_image(db, img, client)
                        except Exception:
                            pass
                    if data is None:
                        try:
                            data = storage.get_object(img.base_object_key)[0]
                        except Exception:
                            pass
                if data:
                    zf.writestr(f"media/{platform_name}_image_{img.slot_index + 1}.png", data)
            for vidx, vid in enumerate(videos):
                if vid.base_object_key:
                    try:
                        vdata = storage.get_object(vid.base_object_key)[0]
                        zf.writestr(f"media/{platform_name}_video_{vidx + 1}.mp4", vdata)
                    except Exception:
                        pass

    zip_data = buf.getvalue()
    return Response(
        content=zip_data,
        media_type="application/zip",
        headers={"Content-Disposition": f'attachment; filename="post-{sp.id[:8]}-export.zip"'},
    )


# --- Smart scheduling slots (Phase 2) ---


@router.get("/clients/{client_id}/posting-slots", response_model=list[PostingSlotOut])
def list_posting_slots(
    client: Client = Depends(require_client),
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
):
    return db.scalars(
        select(PostingSlot).where(PostingSlot.client_id == client.id)
        .order_by(PostingSlot.weekday, PostingSlot.hour, PostingSlot.minute)
    ).all()


@router.post("/clients/{client_id}/posting-slots", response_model=PostingSlotOut)
def create_posting_slot(
    body: PostingSlotIn,
    client: Client = Depends(require_client),
    db: Session = Depends(get_db),
    actor: User = Depends(require_capability(Capability.schedule)),
):
    if not (0 <= body.weekday <= 6 and 0 <= body.hour <= 23 and 0 <= body.minute <= 59):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Invalid weekday/time.")
    slot = PostingSlot(
        client_id=client.id, weekday=body.weekday, hour=body.hour,
        minute=body.minute, platform=body.platform or "",
    )
    db.add(slot)
    db.commit()
    db.refresh(slot)
    return slot


@router.delete("/posting-slots/{slot_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_posting_slot(
    slot_id: str,
    db: Session = Depends(get_db),
    actor: User = Depends(require_capability(Capability.schedule)),
):
    slot = db.get(PostingSlot, slot_id)
    if slot is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Slot not found")
    client = db.get(Client, slot.client_id)
    if client is not None:
        assert_client_access(actor, client)
    db.delete(slot)
    db.commit()


@router.post("/clients/{client_id}/fill-slots", response_model=FillSlotsResponse)
def fill_slots(
    body: FillSlotsRequest,
    client: Client = Depends(require_client),
    db: Session = Depends(get_db),
    actor: User = Depends(require_capability(Capability.schedule)),
):
    """Drop approved, unscheduled posts into the client's upcoming open slots."""
    result = slots_service.fill_slots(db, client, actor.id, tz_name=body.timezone)
    audit.record(db, actor, "slots.fill", "client", client.id, result)
    return FillSlotsResponse(**result)
