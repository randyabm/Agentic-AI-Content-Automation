import { useEffect, useState } from "react";
import type { Client } from "../types";
import { getBlobUrl } from "../lib/blobCache";
import { cn } from "@/lib/utils";

/** Fetch a protected image endpoint as an object URL (cached at module level). */
export function useProtectedImage(path: string, enabled: boolean) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    if (!enabled) {
      setSrc(null);
      return;
    }
    let active = true;
    getBlobUrl(path).then((url) => {
      if (active) setSrc(url || null);
    });
    return () => {
      active = false;
    };
  }, [path, enabled]);
  return src;
}

/** Round brand avatar — the client's profile photo, falling back to its initial. */
export function ClientAvatar({ client, large, className }: { client: Client; large?: boolean; className?: string }) {
  const avatarVersion = client.avatar_object_key || "";
  const path = avatarVersion ? `/clients/${client.id}/avatar?v=${avatarVersion}` : "";
  const src = useProtectedImage(path, !!avatarVersion);
  const baseCls = cn(
    "inline-flex items-center justify-center overflow-hidden rounded-full border-2 border-border bg-gradient-to-br from-indigo-500 to-violet-500 font-semibold text-white",
    large ? "size-[132px] border-[3px] text-5xl" : "size-11",
    className,
  );
  if (src) return <img src={src} alt="" className={baseCls} loading="lazy" />;
  return (
    <div className={cn(baseCls, "placeholder")}>
      {(client.company_name[0] ?? "?").toUpperCase()}
    </div>
  );
}
