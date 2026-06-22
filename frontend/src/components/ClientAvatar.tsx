import { useEffect, useState } from "react";
import type { Client } from "../types";
import { getBlobUrl } from "../lib/blobCache";

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
export function ClientAvatar({ client, large }: { client: Client; large?: boolean }) {
  const avatarVersion = client.avatar_object_key || "";
  const path = avatarVersion ? `/clients/${client.id}/avatar?v=${avatarVersion}` : "";
  const src = useProtectedImage(path, !!avatarVersion);
  const cls = `client-avatar${large ? " lg" : ""}`;
  if (src) return <img src={src} alt="" className={cls} loading="lazy" />;
  return (
    <div className={`${cls} placeholder`}>
      {(client.company_name[0] ?? "?").toUpperCase()}
    </div>
  );
}
