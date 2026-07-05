import { cn } from "@/lib/utils";
import type { CampaignApprovalStatus } from "../types";

const STYLES: Record<string, { cls: string; label: string; pulse?: boolean }> = {
  draft: { cls: "bg-muted text-muted-foreground", label: "Draft" },
  pending_review: { cls: "bg-amber-100 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300", label: "Pending Approval", pulse: true },
  approved: { cls: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300", label: "Approved" },
  rejected: { cls: "bg-red-100 text-red-700 dark:bg-red-950/50 dark:text-red-300", label: "Rejected" },
  changes_requested: { cls: "bg-amber-100 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300", label: "Changes Requested" },
};

/** Pill-shaped campaign approval status badge (DESIGN.md: light bg, dark same-hue text). */
export function ApprovalBadge({
  status,
  className,
}: {
  status: CampaignApprovalStatus | string;
  className?: string;
}) {
  const s = STYLES[status] ?? STYLES.draft;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-bold",
        s.cls,
        className,
      )}
    >
      {s.pulse && <span className="size-2 animate-pulse rounded-full bg-current" />}
      {s.label}
    </span>
  );
}
