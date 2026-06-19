"""Publishing orchestration.

Routes publish/schedule calls to either the Zernio middleman or the direct
platform APIs, depending on the `social_publishing_mode` setting.
"""
from __future__ import annotations

from datetime import datetime

from sqlalchemy.orm import Session

from app.models.campaign import CampaignElement, Post, PostImage
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


def _image_key(img: PostImage) -> str:
    return img.composited_object_key or img.base_object_key or ""


class PublishError(Exception):
    pass


def _resolve_content(db: Session, post: Post) -> tuple[str, PostImage | None, str]:
    """Compose text + pick the image rendition; raise if there's nothing to send."""
    text = compose_text(post)
    image = resolve_image(db, post)
    image_key = _image_key(image) if image else ""
    if not text and not image_key:
        raise PublishError("Nothing to publish — the post has no copy and no image.")
    return text, image, image_key


def publish_post(
    db: Session,
    post: Post,
    channel: SocialAccount,
    actor_id: str,
) -> ScheduledPost:
    """Publish `post` to `channel` immediately via Zernio, recording a ScheduledPost."""
    text, image, image_key = _resolve_content(db, post)

    sp = ScheduledPost(
        post_id=post.id,
        social_account_id=channel.id,
        post_image_id=image.id if image else None,
        scheduled_at=None,
        status=PublishStatus.publishing,
        created_by=actor_id,
    )
    db.add(sp)
    db.flush()
    _dispatch(db, sp, channel, text, image_key)
    db.commit()
    return sp


def schedule_post(
    db: Session,
    post: Post,
    channel: SocialAccount,
    actor_id: str,
    scheduled_at: datetime,
    timezone: str = "UTC",
) -> ScheduledPost:
    """Record a future-dated publish. We hold it locally (status `scheduled`) and
    the Celery Beat sweep (`publish_due_posts`) hands it to Zernio when due — this
    lets us re-check approval and mint a fresh signed media URL at send time, and
    makes cancel/reschedule a pure local operation."""
    _, image, _ = _resolve_content(db, post)  # validate there's something to send

    sp = ScheduledPost(
        post_id=post.id,
        social_account_id=channel.id,
        post_image_id=image.id if image else None,
        scheduled_at=scheduled_at,
        timezone=timezone or "UTC",
        status=PublishStatus.scheduled,
        created_by=actor_id,
    )
    db.add(sp)
    db.commit()
    return sp


def send_scheduled_post(db: Session, sp: ScheduledPost, post: Post, channel: SocialAccount) -> ScheduledPost:
    """Push an already-recorded scheduled post to Zernio (called by the due sweep)."""
    text, _, image_key = _resolve_content(db, post)
    sp.status = PublishStatus.publishing
    sp.error = ""
    db.commit()
    _dispatch(db, sp, channel, text, image_key)
    db.commit()
    return sp


def _dispatch(db: Session, sp: ScheduledPost, channel: SocialAccount, text: str, image_key: str) -> None:
    """Route the publish call to the active connector and record the result on sp."""
    mode = get_publishing_mode(db)
    if mode == "direct":
        _dispatch_direct(db, sp, channel, text, image_key)
    else:
        _dispatch_zernio(db, sp, channel, text, image_key)


def _dispatch_direct(
    db: Session, sp: ScheduledPost, channel: SocialAccount, text: str, image_key: str
) -> None:
    from app.services.direct_social import DirectSocialError
    image_url = public_media_url(image_key) if image_key else ""
    try:
        post_id = direct_publish(db, channel, text, image_url)
        sp.external_post_id = post_id
        sp.published_url = ""
        sp.status = PublishStatus.published
    except DirectSocialError as exc:
        sp.status = PublishStatus.failed
        sp.error = str(exc)


def _dispatch_zernio(
    db: Session, sp: ScheduledPost, channel: SocialAccount, text: str, image_key: str
) -> None:
    """Build the Zernio payload (immediate publish) and apply the result to sp."""
    payload: dict = {
        "content": text,
        "platforms": [{"platform": channel.platform, "accountId": channel.zernio_account_id}],
        "publishNow": True,
    }
    if image_key:
        payload["mediaItems"] = [{"type": "image", "url": public_media_url(image_key)}]

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
