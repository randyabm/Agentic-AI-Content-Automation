import {
  SiFacebook,
  SiInstagram,
  SiPinterest,
  SiTiktok,
  SiX,
  SiYoutube,
} from "@icons-pack/react-simple-icons";
import { Globe } from "lucide-react";

type IconCmp = (props: { size?: number; color?: string }) => JSX.Element;

// LinkedIn was removed from Simple Icons for trademark reasons, so we inline its
// official brand glyph to keep the platform set complete.
function LinkedInIcon({ size = 14, color = "#0A66C2" }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill={color} aria-hidden="true">
      <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 01-2.063-2.065 2.064 2.064 0 112.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z" />
    </svg>
  );
}

const PLATFORMS: Record<string, { Icon: IconCmp; color: string; label: string }> = {
  facebook: { Icon: SiFacebook as IconCmp, color: "#1877F2", label: "Facebook" },
  instagram: { Icon: SiInstagram as IconCmp, color: "#E4405F", label: "Instagram" },
  linkedin: { Icon: LinkedInIcon, color: "#0A66C2", label: "LinkedIn" },
  x: { Icon: SiX as IconCmp, color: "#1c1917", label: "X" },
  tiktok: { Icon: SiTiktok as IconCmp, color: "#1c1917", label: "TikTok" },
  youtube: { Icon: SiYoutube as IconCmp, color: "#FF0000", label: "YouTube" },
  pinterest: { Icon: SiPinterest as IconCmp, color: "#BD081C", label: "Pinterest" },
};

export function platformLabel(platform: string): string {
  return PLATFORMS[platform]?.label ?? platform;
}

/** Best-effort detection of the social platform from a profile URL. */
export function platformFromUrl(url: string): string | null {
  const u = url.toLowerCase();
  if (u.includes("linkedin.")) return "linkedin";
  if (u.includes("facebook.") || u.includes("fb.com")) return "facebook";
  if (u.includes("instagram.")) return "instagram";
  if (u.includes("tiktok.")) return "tiktok";
  if (u.includes("youtube.") || u.includes("youtu.be")) return "youtube";
  if (u.includes("pinterest.")) return "pinterest";
  if (u.includes("twitter.") || u.includes("x.com")) return "x";
  return null;
}

export function PlatformIcon({
  platform,
  size = 14,
  color,
}: {
  platform: string;
  size?: number;
  color?: string;
}) {
  const entry = PLATFORMS[platform];
  if (!entry) return <Globe size={size} color={color ?? "currentColor"} />;
  const { Icon } = entry;
  return <Icon size={size} color={color ?? entry.color} />;
}
