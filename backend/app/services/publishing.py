"""Publishing orchestration.

Routes publish/schedule calls to either the Zernio middleman or the direct
platform APIs, depending on the `social_publishing_mode` setting.
"""
from __future__ import annotations

from datetime import datetime

from sqlalchemy.orm import Session

from app.models.campaign import CampaignElement, ElementType, Post, PostImage, PostVideo, VideoStatus
from app.models.social import PublishStatus, ScheduledPost, SocialAccount
from app.services import zernio
from app.services.direct_social import get_publishing_mode
from app.services.direct_social import publish as direct_publish
from app.services.media_links import public_media_url


def compose_text(post: Post) -> str:
    parts: list[str] = []
    for value in (post.headline, post.copy, post.cta):
        if value and value.strip():
            parts.append(value.strip())
    tags = post.hashtags or []
    if tags:
        parts.append(" ".join(str(t) if str(t).startswith("#") else f"#{t}" for t in tags))
    return "\n\n".join(parts)


def resolve_image(db: Session, post: Post) -> PostImage | None:
    """The image rendition to publish for this post's platform — the one matching
    the platform's aspect ratio (composited if available), else the first slot."""
    if not post.element_id:
        return None
    element = db.get(CampaignElement, post.element_id)
    if element is None or not element.images:
        return None
    ratio = (element.platform_ratios or {}).get(post.platform.value)
    images = sorted(element.images, key=lambda i: (i.slot_index, i.aspect_ratio))
    for img in images:
        if ratio and img.aspect_ratio == ratio:
            return img
    return images[0]


def resolve_carousel(db: Session, post: Post) -> list[PostImage]:
    """All slides for a carousel element ordered by slot_index, one per slot at
    the platform's aspect ratio (falls back to first available for each slot)."""
    if not post.element_id:
        return []
    element = db.get(CampaignElement, post.element_id)
    if element is None or not element.images:
        return []
    ratio = (element.platform_ratios or {}).get(post.platform.value)
    slots: dict[int, PostImage] = {}
    for img in sorted(element.images, key=lambda i: (i.slot_index, i.aspect_ratio)):
        slot = img.slot_index
        if slot not in slots:
            slots[slot] = img
        elif ratio and img.aspect_ratio == ratio:
            slots[slot] = img
    return [slots[k] for k in sorted(slots.keys())]


def resolve_video(db: Session, post: Post) -> PostVideo | None:
    """The ready video rendition for this post's platform aspect ratio, if any."""
    if not post.element_id:
        return None
    element = db.get(CampaignElement, post.element_id)
    if element is None or not element.videos:
        return None
    ready = [v for v in element.videos if v.status == VideoStatus.ready and v.base_object_key]
    if not ready:
        return None
    ratio = (element.platform_ratios or {}).get(post.platform.value)
    for vid in ready:
        if ratio and vid.aspect_ratio == ratio:
            return vid
    return ready[0]


def _image_key(img: PostImage) -> str:
    return img.composited_object_key or img.base_object_key or ""


class PublishError(Exception):
    pass


def _resolve_content(
    db: Session, post: Post
) -> tuple[str, list[PostImage], list[str], PostVideo | None, str]:
    """Compose text + pick image(s)/video rendition; raise if there's nothing to send.

    Returns (text, images, image_keys, video, video_key).
    `images` / `image_keys` are lists — multiple items for carousels, one for
    single-image posts, empty for video/text-only.
    """
    text = compose_text(post)
    element = db.get(CampaignElement, post.element_id) if post.element_id else None

    if element and element.element_type == ElementType.carousel:
        images = resolve_carousel(db, post)
    else:
        img = resolve_image(db, post)
        images = [img] if img else []

    image_keys = [k for img in images if (k := _image_key(img))]

    video = resolve_video(db, post) if not image_keys else None
    video_key = video.base_object_key if video else ""

    if not text and not image_keys and not video_key:
        raise PublishError("Nothing to publish — the post has no copy, no image, and no ready video.")

    return text, images, image_keys, video, video_key


def publish_post(
    db: Session,
    post: Post,
    channel: SocialAccount,
    actor_id: str,
) -> ScheduledPost:
    """Publish `post` to `channel` immediately, recording a ScheduledPost."""
    text, images, image_keys, video, video_key = _resolve_content(db, post)

    sp = ScheduledPost(
        post_id=post.id,
        social_account_id=channel.id,
        post_image_id=images[0].id if images else None,
        post_video_id=video.id if video else None,
        scheduled_at=None,
        status=PublishStatus.publishing,
        created_by=actor_id,
    )
    db.add(sp)
    # Commit the "publishing" state up front so a reload mid-publish (video
    # uploads can take a while) shows progress instead of nothing, and so a
    # failure is still recorded even though _dispatch re-raises.
    db.commit()
    try:
        _dispatch(db, sp, channel, text, image_keys, video_key)
    finally:
        db.commit()
    return sp


def schedule_post(
    db: Session,
    post: Post,
    channel: SocialAccount | None,
    actor_id: str,
    scheduled_at: datetime,
    timezone: str = "UTC",
) -> ScheduledPost:
    """Record a future-dated publish. We hold it locally (status `scheduled`) and
    the Celery Beat sweep (`publish_due_posts`) hands it to Zernio when due — this
    lets us re-check approval and mint a fresh signed media URL at send time, and
    makes cancel/reschedule a pure local operation.

    `channel` may be None: that records a *planned* schedule for an approved post
    whose client has no connected channel yet. The due sweep skips planned posts
    (it never auto-publishes them) until a channel is connected."""
    _, images, _, video, _ = _resolve_content(db, post)  # validate there's something to send

    sp = ScheduledPost(
        post_id=post.id,
        social_account_id=channel.id if channel else None,
        post_image_id=images[0].id if images else None,
        post_video_id=video.id if video else None,
        scheduled_at=scheduled_at,
        timezone=timezone or "UTC",
        status=PublishStatus.scheduled,
        created_by=actor_id,
    )
    db.add(sp)
    db.commit()
    return sp


def send_scheduled_post(db: Session, sp: ScheduledPost, post: Post, channel: SocialAccount) -> ScheduledPost:
    """Push an already-recorded scheduled post to the connector (called by the due sweep)."""
    text, _, image_keys, _, video_key = _resolve_content(db, post)
    sp.status = PublishStatus.publishing
    sp.error = ""
    db.commit()
    _dispatch(db, sp, channel, text, image_keys, video_key)
    db.commit()
    return sp


def _dispatch(
    db: Session, sp: ScheduledPost, channel: SocialAccount,
    text: str, image_keys: list[str], video_key: str = "",
) -> None:
    """Route the publish call to the active connector and record the result on sp."""
    mode = get_publishing_mode(db)
    if mode == "direct":
        _dispatch_direct(db, sp, channel, text, image_keys, video_key)
    else:
        _dispatch_zernio(db, sp, channel, text, image_keys, video_key)


def _dispatch_direct(
    db: Session, sp: ScheduledPost, channel: SocialAccount,
    text: str, image_keys: list[str], video_key: str = "",
) -> None:
    from app.services.direct_social import DirectSocialError
    image_urls = [public_media_url(k) for k in image_keys if k]
    video_url = public_media_url(video_key) if video_key else ""
    try:
        post_id, published_url = direct_publish(db, channel, text, image_urls, video_url)
        sp.external_post_id = post_id
        sp.published_url = published_url
        sp.status = PublishStatus.published
    except DirectSocialError as exc:
        sp.status = PublishStatus.failed
        sp.error = str(exc)
        raise PublishError(str(exc)) from exc


def _dispatch_zernio(
    db: Session, sp: ScheduledPost, channel: SocialAccount,
    text: str, image_keys: list[str], video_key: str = "",
) -> None:
    """Build the Zernio payload and apply the result to sp."""
    payload: dict = {
        "content": text,
        "platforms": [{"platform": channel.platform, "accountId": channel.zernio_account_id}],
        "publishNow": True,
    }
    if image_keys:
        payload["mediaItems"] = [{"type": "image", "url": public_media_url(k)} for k in image_keys]
    elif video_key:
        payload["mediaItems"] = [{"type": "video", "url": public_media_url(video_key)}]

    try:
        result = zernio.create_post(db, payload)
    except zernio.ZernioError as exc:
        sp.status = PublishStatus.failed
        sp.error = str(exc)
        return

    _apply_result(sp, result, scheduled=False)


def _apply_result(sp: ScheduledPost, result: dict, scheduled: bool) -> None:
    platforms = result.get("platforms") or []
    first = platforms[0] if platforms else {}
    sp.zernio_post_id = result.get("_id", "") or sp.zernio_post_id
    sp.published_url = first.get("platformPostUrl") or first.get("publishedUrl") or ""
    status = (result.get("status") or first.get("status") or "").lower()
    if status == "failed":
        sp.status = PublishStatus.failed
        sp.error = first.get("error") or "Publishing failed"
    elif status == "partial":
        sp.status = PublishStatus.partial
    elif status == "scheduled" or (scheduled and status != "published"):
        sp.status = PublishStatus.scheduled
    else:
        sp.status = PublishStatus.published


def update_from_zernio_status(db: Session, zernio_post_id: str, result: dict) -> ScheduledPost | None:
    """Apply a fresh Zernio post payload (e.g. from a webhook) to our record."""
    from sqlalchemy import select

    sp = db.scalar(select(ScheduledPost).where(ScheduledPost.zernio_post_id == zernio_post_id))
    if sp is None:
        return None
    _apply_result(sp, result, scheduled=sp.scheduled_at is not None)
    db.commit()
    return sp
