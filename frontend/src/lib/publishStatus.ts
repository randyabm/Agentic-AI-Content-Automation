/**
 * Publish status helpers — single source of truth for label, badge variant,
 * bar color, and friendly error messages used across the calendar.
 *
 * Mirrors the backend `DirectSocialError.code` taxonomy and the
 * `publishstatus` enum (plus the two new values added in migration 007:
 * `retrying` and `throttled`).
 */
import type { PublishErrorCode, PublishStatus } from "@/types";

export const PUBLISH_STATUS_LABEL: Record<PublishStatus, string> = {
  draft: "Draft",
  scheduled: "Scheduled",
  publishing: "Publishing…",
  published: "Published",
  partial: "Partially published",
  failed: "Failed",
  retrying: "Retrying…",
  throttled: "Throttled",
};

/** shadcn Badge `variant` for each status. */
export const PUBLISH_STATUS_VARIANT: Record<PublishStatus, "default" | "secondary" | "outline" | "destructive"> = {
  draft: "outline",
  scheduled: "outline",
  publishing: "outline",
  published: "default",
  partial: "secondary",
  failed: "destructive",
  retrying: "outline",
  throttled: "outline",
};

/** Tailwind class for the per-item colored bar in the calendar month / week view. */
export const PUBLISH_STATUS_BAR: Record<PublishStatus, string> = {
  draft: "bg-stone-400",
  scheduled: "bg-amber-400",
  publishing: "bg-amber-400",
  published: "bg-emerald-500",
  partial: "bg-amber-500",
  failed: "bg-red-500",
  retrying: "bg-orange-500",
  throttled: "bg-orange-300",
};

/** Friendly, end-user error messages keyed by `error_code`. */
export const FRIENDLY_PUBLISH_ERROR: Record<PublishErrorCode, string> = {
  "": "",
  rate_limited:
    "The platform is rate-limiting us right now. We'll retry automatically in a few minutes.",
  auth_expired:
    "The connection to this platform has expired. Reconnect the channel in Channels settings.",
  spam_blocked:
    "The platform temporarily blocked this account for spam-like activity. Wait and retry, or check the channel's status.",
  transient:
    "The platform had a temporary hiccup. We'll retry automatically with backoff.",
  permanent:
    "The platform rejected this post (the content may not be valid for this channel).",
  duplicate:
    "The same content was already scheduled for this channel in the last 24 hours.",
  daily_limit_reached:
    "We've hit the daily posting limit for this channel. The post will be retried later.",
  min_gap_not_reached:
    "Posts on this channel need a few minutes of space between them. We'll try again shortly.",
};

export function statusLabel(status: PublishStatus): string {
  return PUBLISH_STATUS_LABEL[status] ?? status;
}

export function statusVariant(
  status: PublishStatus,
): "default" | "secondary" | "outline" | "destructive" {
  return PUBLISH_STATUS_VARIANT[status] ?? "outline";
}

export function statusBar(status: PublishStatus): string {
  return PUBLISH_STATUS_BAR[status] ?? "bg-stone-400";
}

export function friendlyPublishError(code: string | null | undefined, fallback = ""): string {
  if (!code) return fallback;
  const msg = FRIENDLY_PUBLISH_ERROR[code as PublishErrorCode];
  return msg ?? fallback;
}

export function nextAttemptNote(nextAttemptAt: string | null | undefined): string {
  if (!nextAttemptAt) return "";
  const t = new Date(nextAttemptAt);
  if (Number.isNaN(t.getTime())) return "";
  const now = new Date();
  const sameDay =
    t.getFullYear() === now.getFullYear() &&
    t.getMonth() === now.getMonth() &&
    t.getDate() === now.getDate();
  const time = t.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  return sameDay ? `Reintentará hoy a las ${time}` : `Reintentará el ${t.toLocaleDateString()} a las ${time}`;
}
