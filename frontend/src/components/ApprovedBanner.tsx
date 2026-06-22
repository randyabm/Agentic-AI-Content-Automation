interface ApprovedBannerProps {
  reviewerName: string;
  reviewedAt: string;
  quote: string;
}

export function ApprovedBanner({ reviewerName, reviewedAt, quote }: ApprovedBannerProps) {
  const date = reviewedAt ? new Date(reviewedAt).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "";
  return (
    <div className="mb-lg p-md bg-green-50 border border-green-200 rounded-xl flex items-start gap-4">
      <div className="w-10 h-10 rounded-full bg-green-100 flex items-center justify-center flex-shrink-0 text-green-600">
        <span className="material-symbols-outlined">verified_user</span>
      </div>
      <div>
        <h3 className="font-bold text-green-800" style={{ fontSize: "0.95rem" }}>
          Approved by {reviewerName}{date ? ` on ${date}` : ""}
        </h3>
        {quote && <p className="text-green-700 opacity-90" style={{ fontSize: "0.85rem" }}>"{quote}"</p>}
      </div>
    </div>
  );
}
