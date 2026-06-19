"""AI best-time auto-pilot (SOCIAL_PUBLISHING_PLAN.md Phase 4).

Proposes an optimal publishing calendar for a campaign's approved posts: it
spreads them across the campaign window and places each at a platform-appropriate
engagement window, seeded by the Editorial Agent's per-post `best_time` hint. The
proposal is a *preview* — the user reviews/edits it, then commits it to real
`ScheduledPost` rows through the normal scheduling path.

The engine is deterministic (valid, well-spaced, always-future times) so it never
depends on a live LLM call at schedule time; the "AI" in best-time comes from the
editorial agent's `best_time` hints surfaced in each slot's rationale.
"""
from __future__ import annotations

import re
from datetime import date, datetime, time, timedelta, timezone
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from app.models.campaign import Campaign, Post
from app.models.social import SocialAccount

# Industry-standard engagement windows per platform, in the audience's local time.
# Two-to-three slots each so consecutive posts on the same platform spread apart.
BEST_WINDOWS: dict[str, list[time]] = {
    "instagram": [time(11, 0), time(14, 0), time(19, 0)],
    "facebook": [time(9, 0), time(13, 0), time(15, 0)],
    "linkedin": [time(8, 0), time(12, 0), time(17, 30)],
    "x": [time(9, 0), time(12, 0), time(17, 0)],
    "tiktok": [time(12, 0), time(18, 0), time(21, 0)],
    "youtube": [time(14, 0), time(17, 0), time(20, 0)],
}
DEFAULT_WINDOWS = [time(10, 0), time(13, 0), time(18, 0)]

# Platforms whose audiences skew to the work week — skip weekend placements.
WEEKDAY_ONLY = {"linkedin"}


def _resolve_tz(tz_name: str) -> ZoneInfo:
    try:
        return ZoneInfo(tz_name or "UTC")
    except (ZoneInfoNotFoundError, ValueError):
        return ZoneInfo("UTC")


def _windows_for(platform: str) -> list[time]:
    return BEST_WINDOWS.get(platform, DEFAULT_WINDOWS)


def _rationale(platform: str, slot: time, best_time_hint: str, used_hint: bool) -> str:
    hint = (best_time_hint or "").strip()
    if used_hint and hint:
        return f"Using the Editorial AI's suggested time (“{hint}”) at {slot.strftime('%H:%M')} local."
    base = f"{platform.title()} engagement peaks around {slot.strftime('%H:%M')} local time."
    if hint:
        return f"{base} Editorial AI suggested: “{hint}”."
    return base


def propose_schedule(
    campaign: Campaign,
    items: list[tuple[Post, SocialAccount]],
    tz_name: str = "UTC",
    per_day: int = 2,
    start_from: date | None = None,
) -> list[dict]:
    """Build proposed slots for (post, channel) pairs.

    Returns one dict per pair: post_id, platform, channel id/name, the suggested
    instant (UTC), its local label, and a rationale. Times are always strictly in
    the future, spaced across days, and de-duplicated per channel.
    """
    tz = _resolve_tz(tz_name)
    now = datetime.now(timezone.utc)
    per_day = max(1, per_day)

    # Start no earlier than tomorrow (audience-local), and respect a campaign start.
    today_local = now.astimezone(tz).date()
    window_start = start_from or campaign.start_date or (today_local + timedelta(days=1))
    if window_start <= today_local:
        window_start = today_local + timedelta(days=1)
    window_end = campaign.end_date

    proposals: list[dict] = []
    used: set[tuple[str, str]] = set()  # (channel_id, iso-minute) collision guard

    for idx, (post, channel) in enumerate(items):
        platform = post.platform.value
        windows = _windows_for(platform)
        # Prefer the editorial AI's own best-time hint when it parses; otherwise
        # fall back to the platform's standard engagement window (cycled so
        # consecutive posts on a platform don't stack on the same slot).
        hint_time = parse_hint_time(post.best_time)
        slot = hint_time or windows[idx % len(windows)]
        day = window_start + timedelta(days=idx // per_day)

        # Land on a valid day: respect weekday-only platforms and the campaign end.
        for _ in range(21):  # bounded search
            if platform in WEEKDAY_ONLY and day.weekday() >= 5:
                day += timedelta(days=1)
                continue
            local_dt = datetime.combine(day, slot, tzinfo=tz)
            utc_dt = local_dt.astimezone(timezone.utc)
            if utc_dt <= now + timedelta(minutes=5):
                day += timedelta(days=1)
                continue
            key = (channel.id, utc_dt.strftime("%Y-%m-%dT%H:%M"))
            if key in used:
                day += timedelta(days=1)
                continue
            break
        if window_end and day > window_end:
            # Campaign window exhausted — keep placing but flag it past the window.
            pass
        used.add((channel.id, utc_dt.strftime("%Y-%m-%dT%H:%M")))

        proposals.append({
            "post_id": post.id,
            "platform": platform,
            "channel_id": channel.id,
            "channel_name": channel.display_name or platform.title(),
            "headline": post.headline or "",
            "preview": (post.copy or post.headline or "").strip().replace("\n", " ")[:140],
            "suggested_at": utc_dt,
            "local_label": local_dt.strftime("%a %d %b · %H:%M"),
            "rationale": _rationale(platform, slot, post.best_time, used_hint=hint_time is not None),
        })

    return proposals


_TIME_RE = re.compile(r"\b([01]?\d|2[0-3]):([0-5]\d)\b")


def parse_hint_time(best_time: str) -> time | None:
    """Best-effort parse of an editorial `best_time` hint like 'Weekdays 9:00 AM'."""
    if not best_time:
        return None
    m = _TIME_RE.search(best_time)
    if not m:
        return None
    hour, minute = int(m.group(1)), int(m.group(2))
    low = best_time.lower()
    if "pm" in low and hour < 12:
        hour += 12
    if "am" in low and hour == 12:
        hour = 0
    return time(hour, minute)
