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

from app.api.deps import assert_client_access, get_current_user, require_client, require_editor, require_reviewer
from app.db.session import get_db
from app.models.campaign import ApprovalStatus, Campaign, Post
from app.models.client import Client
from app.models.social import PublishStatus, ScheduledPost, SocialAccount
from app.models.user import User
from app.schemas.social import CalendarItemOut, RescheduleRequest, ReviewQueueItem, ScheduleablePostOut, ScheduledPostOut
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
        approval_status=post.approval_status.value if post.approval_status else "",
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
    db: Session = Depends(get_db),
    actor: User = Depends(get_current_user),
):
    """Approved posts that have no ScheduledPost yet — ready to be dragged onto
    the calendar to be scheduled. Only posts with a connected channel are returned."""
    from app.models.social import ChannelStatus

    if actor.org_id is None:
        return []
    # Subquery: post_ids that already have a ScheduledPost
    scheduled_post_ids = select(ScheduledPost.post_id).scalar_subquery()
    rows = db.execute(
        select(Post, Campaign, Client)
        .join(Campaign, Campaign.id == Post.campaign_id)
        .join(Client, Client.id == Campaign.client_id)
        .where(
            Client.org_id == actor.org_id,
            Post.approval_status == ApprovalStatus.approved,
            ~Post.id.in_(scheduled_post_ids),
        )
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
        key = f"{client.id}|{post.platform.value}"
        ch = channels.get(key)
        if ch is None:
            continue  # no connected channel — can't schedule
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
                channel_id=ch.id,
                channel_name=ch.display_name,
                best_time=post.best_time or "",
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
