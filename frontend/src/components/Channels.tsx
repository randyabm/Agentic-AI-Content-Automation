import { useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import { api } from "../api";
import type { Client, SocialAccount } from "../types";
import { PlatformIcon, platformLabel } from "./PlatformIcon";

const CONNECTABLE_ZERNIO = ["facebook", "instagram", "linkedin", "x", "tiktok", "youtube"];
const CONNECTABLE_DIRECT = ["facebook", "instagram", "twitter", "linkedin"];

const STATUS_TAG: Record<string, string> = {
  connected: "tag-green",
  expired: "tag-amber",
  revoked: "tag-red",
  error: "tag-red",
  disconnected: "tag-red",
};

export function Channels({ client, canEdit }: { client: Client; canEdit: boolean }) {
  const [channels, setChannels] = useState<SocialAccount[]>([]);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [mode, setMode] = useState<"zernio" | "direct">("zernio");

  async function load() {
    try {
      setChannels(await api<SocialAccount[]>(`/clients/${client.id}/channels`));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load channels");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // Read the publishing mode setting so we can show the right UI copy
    api<{ key: string; value: string }[]>("/settings")
      .then((settings) => {
        const m = settings.find((s) => s.key === "social_publishing_mode");
        if (m?.value === "direct") setMode("direct");
      })
      .catch(() => {});
  }, [client.id]);

  // Listen for postMessage from the OAuth callback tab (direct mode)
  useEffect(() => {
    function onMessage(e: MessageEvent) {
      if (
        e.origin === window.location.origin &&
        e.data?.type === "oauth_connected" &&
        e.data?.client_id === client.id
      ) {
        load();
      }
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [client.id]);

  async function sync() {
    setBusy("sync");
    setError("");
    try {
      setChannels(await api<SocialAccount[]>(`/clients/${client.id}/channels/sync`, { method: "POST" }));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Sync failed");
    } finally {
      setBusy("");
    }
  }

  async function connect(platform: string) {
    setBusy(platform);
    setError("");
    try {
      const res = await api<{ connect_url: string }>(
        `/clients/${client.id}/channels/connect/${platform}`,
        { method: "POST" },
      );
      window.open(res.connect_url, "_blank", "width=600,height=700,popup");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not start connection");
    } finally {
      setBusy("");
    }
  }

  async function verify(id: string) {
    setBusy(id);
    try {
      const updated = await api<SocialAccount>(`/clients/${client.id}/channels/${id}/verify`, { method: "POST" });
      setChannels((prev) => prev.map((c) => (c.id === id ? updated : c)));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Verify failed");
    } finally {
      setBusy("");
    }
  }

  async function disconnect(id: string) {
    if (!window.confirm("Remove this channel? You can reconnect it later.")) return;
    setBusy(id);
    try {
      await api(`/clients/${client.id}/channels/${id}`, { method: "DELETE" });
      setChannels((prev) => prev.filter((c) => c.id !== id));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Disconnect failed");
    } finally {
      setBusy("");
    }
  }

  const connectableList = mode === "direct" ? CONNECTABLE_DIRECT : CONNECTABLE_ZERNIO;

  return (
    <div className="channels">
      <div className="page-header">
        <div>
          <h2 style={{ margin: 0 }}>Connected channels</h2>
          <p className="muted">
            {mode === "direct"
              ? "Connect this client's social accounts directly via each platform's API."
              : "Link this client's social accounts through Zernio, then publish and schedule to them."}
          </p>
        </div>
        <button className="btn btn-ghost" onClick={sync} disabled={!!busy}>
          <RefreshCw size={14} /> {busy === "sync" ? "Syncing…" : "Sync"}
        </button>
      </div>

      {error && <div className="alert alert-error">{error}</div>}

      {canEdit && (
        <div className="card">
          <strong className="small">Connect a new account</strong>
          <p className="muted small">
            {mode === "direct"
              ? "Opens the platform's authorization page in a new tab. After you approve, this list refreshes automatically."
              : "Opens Zernio's secure login in a new tab. After you authorize, come back and click Sync."}
          </p>
          <div className="platform-chips" style={{ gap: 8, flexWrap: "wrap" }}>
            {connectableList.map((p) => (
              <button key={p} className="btn btn-ghost" disabled={!!busy} onClick={() => connect(p)}>
                <PlatformIcon platform={p} size={14} /> {busy === p ? "Opening…" : platformLabel(p)}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="card">
        {loading ? (
          <p className="muted">Loading…</p>
        ) : channels.length === 0 ? (
          <p className="muted">No channels connected yet.</p>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Account</th>
                <th>Status</th>
                <th>Token expires</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {channels.map((c) => (
                <tr key={c.id}>
                  <td>
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                      <PlatformIcon platform={c.platform} size={16} />
                      <span>
                        <strong>{c.display_name || platformLabel(c.platform)}</strong>
                        {c.username && <span className="muted small"> @{c.username}</span>}
                      </span>
                    </span>
                  </td>
                  <td>
                    <span className={`tag ${STATUS_TAG[c.status] ?? ""}`}>{c.status}</span>
                  </td>
                  <td className="muted small">
                    {c.token_expires_at ? new Date(c.token_expires_at).toLocaleDateString() : "—"}
                  </td>
                  <td>
                    {canEdit && (
                      <>
                        <button className="btn btn-ghost" disabled={!!busy} onClick={() => verify(c.id)}>
                          Verify
                        </button>
                        <button className="btn btn-ghost" disabled={!!busy} onClick={() => disconnect(c.id)}>
                          Remove
                        </button>
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
