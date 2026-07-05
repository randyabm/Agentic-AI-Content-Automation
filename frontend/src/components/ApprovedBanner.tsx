interface ApprovedBannerProps {
  reviewerName: string;
  reviewedAt: string;
  quote: string;
}

export function ApprovedBanner({ reviewerName, reviewedAt, quote }: ApprovedBannerProps) {
  const date = reviewedAt ? new Date(reviewedAt).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "";
  return (
    <div className="mb-6 flex items-start gap-4 rounded-xl border border-emerald-200 bg-emerald-50 p-4 dark:border-emerald-900 dark:bg-emerald-950/30">
      <div className="flex size-10 flex-shrink-0 items-center justify-center rounded-full bg-emerald-100 text-emerald-600 dark:bg-emerald-900/50 dark:text-emerald-300">
        <span className="material-symbols-outlined">verified_user</span>
      </div>
      <div>
        <h3 className="text-sm font-bold text-emerald-800 dark:text-emerald-200">
          Approved by {reviewerName}
          {date ? ` on ${date}` : ""}
        </h3>
        {quote && <p className="text-sm text-emerald-700/90 dark:text-emerald-300/90">"{quote}"</p>}
      </div>
    </div>
  );
}
