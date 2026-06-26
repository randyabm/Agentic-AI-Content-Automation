import { Image as ImageIcon, Video as VideoIcon } from "lucide-react";
import { cn } from "@/lib/utils";

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
    <div
      aria-busy={loading}
      className={cn(
        "absolute inset-0 h-full w-full overflow-hidden bg-surface-alt",
        loading &&
          "after:absolute after:inset-0 after:animate-pulse after:bg-gradient-to-r after:from-transparent after:via-white/40 after:to-transparent",
      )}
    >
      <div className="absolute inset-0 z-[1] flex flex-col items-center justify-center gap-1.5 p-2 text-center text-muted-foreground">
        <Icon size={22} className="opacity-50" />
        <span className="text-[0.8rem]">{label}</span>
      </div>
    </div>
  );
}
