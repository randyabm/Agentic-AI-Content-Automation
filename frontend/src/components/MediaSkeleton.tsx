import { Image as ImageIcon, Video as VideoIcon } from "lucide-react";

/**
 * Placeholder for a media box that has no image/video yet.
 * - `loading` (the asset is actually generating) → animated shimmer.
 * - otherwise → a calm static skeleton, so we never imply work that isn't
 *   happening.
 */
export function MediaSkeleton({
  loading = false,
  label,
  kind = "image",
}: {
  loading?: boolean;
  label: string;
  kind?: "image" | "video";
}) {
  const Icon = kind === "video" ? VideoIcon : ImageIcon;
  return (
    <div className={`media-skeleton ${loading ? "is-loading" : ""}`} aria-busy={loading}>
      <div className="media-skeleton-content">
        <Icon size={22} className="media-skeleton-icon" />
        <span className="media-skeleton-label">{label}</span>
      </div>
    </div>
  );
}
