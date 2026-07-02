"""Publishing orchestration.

Routes publish/schedule calls to either the Zernio middleman, the direct
platform APIs, or a mock dispatcher — depending on the `social_publishing_mode`
setting. Owns the retry/backoff state machine and the content fingerprint used
for duplicate detection (see PLAN_publishing_safeguards.md).
"""
from __future__ import annotations

import hashlib
import json
import random
from datetime import datetime, timedelta, timezone

from sqlalchemy.orm import Session

from app.models.campaign import CampaignElement, ElementType, Platform, Post, PostImage, PostVideo, VideoStatus
from app.models.social import ChannelStatus, PublishStatus, ScheduledPost, SocialAccount
from app.services import zernio
from app.services.direct_social import DirectSocialError, get_publishing_mode
from app.services.direct_social import publish as direct_publish
from app.services.media_links import public_media_url
from app.services.platforms import compose_post_text, fit_post_fields
from app.services.publishing_limits import backoff_for, limit_for


def _platform_enum(platform: str | None) -> Platform | None:
    key = "x" if platform == "twitter" else platform
    try:
        return Platform(key) if key else None
    except ValueError:
        return None


def compose_text(post: Post, platform: str | None = None) -> str:
    """Join headline/copy/CTA/hashtags into the outgoing text.

    When `platform` is given, the fields are fitted to that platform's char
    limit first (X rejects >280 weighted chars with an opaque 403 "You are not
    permitted to perform this action"): hashtags are dropped first, then the
    copy/CTA/headline are truncated on a word boundary with an ellipsis.
    Generation already fits posts at the source (campaign_gen); this is the
    publish-time safety net for hand-edited or legacy posts.
    """
    headline, copy, cta = post.headline or "", post.copy or "", post.cta or ""
    tags = list(post.hashtags or [])
    p = _platform_enum(platform)
    if p is not None:
        headline, copy, cta, tags = fit_post_fields(p, headline, copy, cta, tags)
    return compose_post_text(headline, copy, cta, tags)


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


def content_fingerprint(text: str, image_keys: list[str], video_key: str) -> str:
    """Stable sha256 over the publishable content.

    The text is normalized (whitespace collapsed) and the media keys are sorted
    so re-ordering slides / re-using the same image in different slots doesn't
    change the hash. Returns a hex digest suitable for `content_hash`.
    """
    norm_text = " ".join((text or "").split()).strip().lower()
    media = sorted(filter(None, [*image_keys, video_key]))
    payload = json.dumps({"t": norm_text, "m": media}, separators=(",", ":"), sort_keys=True)
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


class PublishError(Exception):
    pass


def _append_attempt(sp: ScheduledPost, status: str, error_code: str, error: str) -> None:
    """Append one row to attempt_history. `status` is a free-form string
    (e.g. 'published', 'failed', 'retrying') so the worker can log stages
    that don't map to PublishStatus (like a per-tick 'throttled' skip)."""
    history = list(sp.attempt_history or [])
    history.append({
        "at": datetime.now(timezone.utc).isoformat(),
        "status": status,
        "error_code": error_code,
        "error": error[:500],
    })
    # Cap to 50 entries — older ones roll off; this row is more for debugging
    # the last few attempts than a long-term audit log.
    sp.attempt_history = history[-50:]


def _schedule_retry(db: Session, sp: ScheduledPost, error_code: str, error: str, retry_after_s: int | None = None) -> None:
    """Bump retry_count and defer the next attempt. Stays in 'retrying' state
    so the due sweep picks it up again when next_attempt_at <= now."""
    sp.retry_count = (sp.retry_count or 0) + 1
    sp.error_code = error_code
    sp.error = error
    sp.last_attempt_at = datetime.now(timezone.utc)
    _append_attempt(sp, "retrying", error_code, error)
    if sp.retry_count > sp.max_retries:
        sp.status = PublishStatus.failed
        sp.next_attempt_at = None
    else:
        wait_min = backoff_for(sp.retry_count)
        if retry_after_s is not None and retry_after_s > 0:
            # Honour the platform's Retry-After hint when present, with a
            # sensible minimum (15s) so we don't spin on a misbehaving server.
            wait_min = max(1, -(-retry_after_s // 60))  # ceil(seconds / 60)
        sp.status = PublishStatus.retrying
        sp.next_attempt_at = datetime.now(timezone.utc) + timedelta(minutes=wait_min)


def _mark_failed(sp: ScheduledPost, error_code: str, error: str) -> None:
    sp.status = PublishStatus.failed
    sp.error_code = error_code
    sp.error = error
    sp.last_attempt_at = datetime.now(timezone.utc)
    _append_attempt(sp, "failed", error_code, error)


def _mark_published(sp: ScheduledPost) -> None:
    sp.status = PublishStatus.published
    sp.error_code = ""
    sp.error = ""
    sp.retry_count = 0
    sp.next_attempt_at = None
    sp.last_attempt_at = datetime.now(timezone.utc)
    _append_attempt(sp, "published", "", "")


def _mark_channel_expired(db: Session, channel: SocialAccount) -> None:
    """Best-effort downgrade — happens on auth_expired so the UI surfaces it."""
    try:
        channel.status = ChannelStatus.expired
        db.commit()
    except Exception:
        db.rollback()


def _resolve_content(
    db: Session, post: Post, platform: str | None = None
) -> tuple[str, list[PostImage], list[str], PostVideo | None, str]:
    """Compose text + pick image(s)/video rendition; raise if there's nothing to send.

    Returns (text, images, image_keys, video, video_key).
    `images` / `image_keys` are lists — multiple items for carousels, one for
    single-image posts, empty for video/text-only. `platform` (the target
    channel's platform) fits the text to that platform's char limit.
    """
    text = compose_text(post, platform)
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
    text, images, image_keys, video, video_key = _resolve_content(db, post, channel.platform)
    fingerprint = content_fingerprint(text, image_keys, video_key)

    sp = ScheduledPost(
        post_id=post.id,
        social_account_id=channel.id,
        post_image_id=images[0].id if images else None,
        post_video_id=video.id if video else None,
        scheduled_at=None,
        status=PublishStatus.publishing,
        created_by=actor_id,
        content_hash=fingerprint,
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
    tz_name: str = "UTC",
    force: bool = False,
) -> ScheduledPost:
    """Record a future-dated publish. We hold it locally (status `scheduled`) and
    the Celery Beat sweep (`publish_due_posts`) hands it to Zernio when due — this
    lets us re-check approval and mint a fresh signed media URL at send time, and
    makes cancel/reschedule a pure local operation.

    `channel` may be None: that records a *planned* schedule for an approved post
    whose client has no connected channel yet. The due sweep skips planned posts
    (it never auto-publishes them) until a channel is connected.

    Duplicate detection: if a `ScheduledPost` already exists for the same
    account with the same `content_hash` in the last 24h, raises a DuplicatePost
    error (HTTP 409 upstream). Pass `force=True` to override — the user
    explicitly confirmed they want the duplicate anyway.
    """
    text, images, image_keys, video, video_key = _resolve_content(
        db, post, channel.platform if channel else None
    )  # validate there's something to send
    fingerprint = content_fingerprint(text, image_keys, video_key)

    if channel is not None and not force:
        from sqlalchemy import select

        cutoff = datetime.now(timezone.utc) - timedelta(hours=24)
        dup = db.scalar(
            select(ScheduledPost).where(
                ScheduledPost.social_account_id == channel.id,
                ScheduledPost.content_hash == fingerprint,
                ScheduledPost.content_hash != "",
                ScheduledPost.created_at >= cutoff,
            )
        )
        if dup is not None:
            raise DuplicatePost(
                f"The same content was scheduled for this channel in the last 24 hours "
                f"(scheduled post {dup.id}, status={dup.status.value})."
            )

    sp = ScheduledPost(
        post_id=post.id,
        social_account_id=channel.id if channel else None,
        post_image_id=images[0].id if images else None,
        post_video_id=video.id if video else None,
        scheduled_at=scheduled_at,
        timezone=tz_name or "UTC",
        status=PublishStatus.scheduled,
        created_by=actor_id,
        content_hash=fingerprint,
    )
    db.add(sp)
    db.commit()
    return sp


class DuplicatePost(Exception):
    """Raised by schedule_post when the same content_hash was scheduled for
    the same account in the last 24h. The API layer translates this to a 409."""


def send_scheduled_post(db: Session, sp: ScheduledPost, post: Post, channel: SocialAccount) -> ScheduledPost:
    """Push an already-recorded scheduled post to the connector (called by the due sweep).

    Honours the throttling policy from publishing_limits: enforces per-day and
    min-gap limits, marking the post as `throttled` (deferred) when either
    threshold is reached instead of failing it.
    """
    text, _, image_keys, _, video_key = _resolve_content(db, post, channel.platform)

    # Throttle gates (per account). The check uses the account's own limits;
    # if the gate is closed we defer rather than burn through retries.
    limits = limit_for(db, channel.platform)
    now = datetime.now(timezone.utc)

    from app.services.publishing_limits import count_published_last_24h, last_published_at

    if sp.retry_count == 0:  # fresh attempts only — retries already throttled by their own backoff
        used = count_published_last_24h(db, channel.id)
        if used >= limits["per_day"]:
            sp.status = PublishStatus.throttled
            sp.error_code = "daily_limit_reached"
            sp.error = (
                f"Daily limit reached for {channel.platform} ({used}/{limits['per_day']}). "
                "Will retry later."
            )
            sp.next_attempt_at = now + timedelta(hours=12)
            sp.last_attempt_at = now
            _append_attempt(sp, "throttled", "daily_limit_reached", sp.error)
            db.commit()
            return sp

        last = last_published_at(db, channel.id)
        if last is not None:
            gap = (now - last).total_seconds() / 60
            if gap < limits["min_gap_min"]:
                sp.status = PublishStatus.throttled
                sp.error_code = "min_gap_not_reached"
                sp.error = (
                    f"Minimum gap not reached for {channel.platform} "
                    f"({gap:.1f} min < {limits['min_gap_min']} min). Will retry next tick."
                )
                # Try again on the next sweep once the gap is satisfied.
                sp.next_attempt_at = last + timedelta(minutes=limits["min_gap_min"])
                sp.last_attempt_at = now
                _append_attempt(sp, "throttled", "min_gap_not_reached", sp.error)
                db.commit()
                return sp

    sp.status = PublishStatus.publishing
    sp.error = ""
    sp.error_code = ""
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
    elif mode == "mock":
        _dispatch_mock(db, sp, channel, text, image_keys, video_key)
    else:
        _dispatch_zernio(db, sp, channel, text, image_keys, video_key)


def _dispatch_direct(
    db: Session, sp: ScheduledPost, channel: SocialAccount,
    text: str, image_keys: list[str], video_key: str = "",
) -> None:
    image_urls = [public_media_url(k) for k in image_keys if k]
    video_url = public_media_url(video_key) if video_key else ""
    try:
        post_id, published_url = direct_publish(db, channel, text, image_urls, video_url)
    except DirectSocialError as exc:
        # Translate the error into the schedule row's next state per the taxonomy.
        if exc.code in ("transient", "rate_limited"):
            _schedule_retry(db, sp, exc.code, str(exc), retry_after_s=exc.retry_after)
            if sp.status == PublishStatus.failed:
                raise PublishError(str(exc)) from exc
            return
        if exc.code == "auth_expired":
            _mark_failed(sp, exc.code, str(exc))
            _mark_channel_expired(db, channel)
            raise PublishError(str(exc)) from exc
        if exc.code == "spam_blocked":
            _mark_failed(sp, exc.code, str(exc))
            # Mark channel as error so admins see the block in the UI; recoverable
            # by the user re-authorising or waiting for Meta to lift the block.
            try:
                channel.status = ChannelStatus.error
                channel.error = str(exc)
                db.commit()
            except Exception:
                db.rollback()
            raise PublishError(str(exc)) from exc
        # permanent (default)
        _mark_failed(sp, exc.code or "permanent", str(exc))
        raise PublishError(str(exc)) from exc

    sp.external_post_id = post_id
    sp.published_url = published_url
    _mark_published(sp)


def _dispatch_mock(
    db: Session, sp: ScheduledPost, channel: SocialAccount,
    text: str, image_keys: list[str], video_key: str = "",
) -> None:
    """Mock dispatcher: simulates a platform call without any network IO.

    Outcome distribution (deliberately biased towards "interesting" states so
    the UI's retry / throttled / failed paths get exercised in dev):
        70%  → success
        15%  → rate_limited  (will be retried with backoff)
        15%  → transient     (will be retried with backoff)
    Used when `social_publishing_mode = 'mock'` (System Settings → Global).
    """
    roll = random.random()
    if roll < 0.70:
        # Fabricate a stable-looking post id.
        fake_id = "mock_" + (sp.id or "")[:8] or f"mock_{int(datetime.now(timezone.utc).timestamp())}"
        sp.external_post_id = fake_id
        sp.published_url = f"https://example.com/mock/{channel.platform}/{fake_id}"
        _mark_published(sp)
        return
    if roll < 0.85:
        msg = f"Mock: simulated rate limit on {channel.platform}."
        _schedule_retry(db, sp, "rate_limited", msg, retry_after_s=30)
        if sp.status == PublishStatus.failed:
            raise PublishError(msg)
        return
    msg = f"Mock: simulated transient error on {channel.platform}."
    _schedule_retry(db, sp, "transient", msg)
    if sp.status == PublishStatus.failed:
        raise PublishError(msg)


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
        # Zernio errors don't carry a taxonomy; treat as transient so we retry.
        # The connector wrapper could be upgraded later to parse HTTP 429 etc.
        _schedule_retry(db, sp, "transient", str(exc))
        if sp.status == PublishStatus.failed:
            return
        return

    # If the connector actually came back with a result, prefer its verdict.
    platforms = result.get("platforms") or []
    first = platforms[0] if platforms else {}
    if (result.get("status") or first.get("status") or "").lower() == "failed":
        _mark_failed(sp, "permanent", first.get("error") or "Publishing failed")
        return

    sp.zernio_post_id = result.get("_id", "") or sp.zernio_post_id
    sp.published_url = first.get("platformPostUrl") or first.get("publishedUrl") or sp.published_url
    _mark_published(sp)


def _apply_result(sp: ScheduledPost, result: dict, scheduled: bool) -> None:
    """Apply a Zernio post payload (initial response or webhook) to sp.

    Routes through the same `_mark_published` / `_mark_failed` helpers used
    by the dispatchers so last_attempt_at / attempt_history stay consistent
    across both paths (initial send and webhook callbacks).
    """
    platforms = result.get("platforms") or []
    first = platforms[0] if platforms else {}
    sp.zernio_post_id = result.get("_id", "") or sp.zernio_post_id
    sp.published_url = first.get("platformPostUrl") or first.get("publishedUrl") or ""
    status = (result.get("status") or first.get("status") or "").lower()
    if status == "failed":
        _mark_failed(sp, "permanent", first.get("error") or "Publishing failed")
    elif status == "partial":
        # Zernio's "partial" = some platforms ok, some failed. We don't have a
        # dedicated state for that anymore (it was dropped in migration 008),
        # so we record it as a published post with the warning attached.
        _mark_published(sp)
        sp.error = first.get("error") or "Partial publish (some platforms may have failed)"
    elif status == "scheduled" or (scheduled and status != "published"):
        sp.status = PublishStatus.scheduled
    else:
        _mark_published(sp)


def update_from_zernio_status(db: Session, zernio_post_id: str, result: dict) -> ScheduledPost | None:
    """Apply a fresh Zernio post payload (e.g. from a webhook) to our record."""
    from sqlalchemy import select

    sp = db.scalar(select(ScheduledPost).where(ScheduledPost.zernio_post_id == zernio_post_id))
    if sp is None:
        return None
    _apply_result(sp, result, scheduled=sp.scheduled_at is not None)
    db.commit()
    return sp
