import { AlertTriangle, Clock3, Unplug } from "lucide-react";

/** Why a scheduled post won't publish on its own (ScheduledPost.blocked_reason). */
const SPEC: Record<string, { label: string; className: string; Icon: typeof Clock3 }> = {
  waiting_approval: {
    label: "Awaiting approval",
    className: "bg-amber-100 text-amber-800 border-amber-300",
    Icon: Clock3,
  },
  needs_channel: {
    label: "No channel connected",
    className: "bg-orange-100 text-orange-800 border-orange-300",
    Icon: Unplug,
  },
  overdue: {
    label: "Overdue — not sent",
    className: "bg-red-100 text-red-800 border-red-300",
    Icon: AlertTriangle,
  },
};

export const BLOCKED_REASON_HINTS: Record<string, string> = {
  waiting_approval: "This post is scheduled but won't publish until it's approved.",
  needs_channel: "This post is scheduled but has no connected channel to publish to.",
  overdue: "The scheduled time passed but the post was not sent.",
};

export default function BlockedReasonBadge({ reason, className = "" }: { reason?: string; className?: string }) {
  if (!reason || !(reason in SPEC)) return null;
  const { label, className: cls, Icon } = SPEC[reason];
  return (
    <span
      title={BLOCKED_REASON_HINTS[reason]}
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-bold ${cls} ${className}`}
    >
      <Icon size={11} />
      {label}
    </span>
  );
}
