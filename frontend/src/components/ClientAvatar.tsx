import { useEffect, useState } from "react";
import type { Client } from "../types";

/** Fetch a protected image endpoint as an object URL (with auth header, revoked on cleanup). */
export function useProtectedImage(path: string, enabled: boolean) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    if (!enabled) {
      setSrc(null);
      return;
    }
    let revoked: string | null = null;
    const apiUrl = import.meta.env.VITE_API_URL ?? "http://localhost:8000";
    fetch(`${apiUrl}${path}`, {
      headers: { Authorization: `Bearer ${localStorage.getItem("access_token")}` },
    })
      .then((r) => (r.ok ? r.blob() : null))
      .then((blob) => {
        if (blob) {
          revoked = URL.createObjectURL(blob);
          setSrc(revoked);
        }
      });
    return () => {
      if (revoked) URL.revokeObjectURL(revoked);
    };
  }, [path, enabled]);
  return src;
}

/** Round brand avatar — the client's profile photo, falling back to its initial. */
export function ClientAvatar({ client, large }: { client: Client; large?: boolean }) {
  const src = useProtectedImage(`/clients/${client.id}/avatar`, !!client.avatar_object_key);
  const cls = `client-avatar${large ? " lg" : ""}`;
  if (src) return <img src={src} alt="" className={cls} />;
  return (
    <div className={`${cls} placeholder`}>
      {(client.company_name[0] ?? "?").toUpperCase()}
    </div>
  );
}
