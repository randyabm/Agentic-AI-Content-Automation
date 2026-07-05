import { useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { api } from "../api";
import type { Client, SocialAccount } from "../types";
import { PlatformIcon, platformLabel } from "./PlatformIcon";
import { useConfirm } from "@/components/ui/dialogs";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

const CONNECTABLE_ZERNIO = ["facebook", "instagram", "linkedin", "x", "tiktok", "youtube"];
const CONNECTABLE_DIRECT = ["facebook", "instagram", "x", "linkedin"];

const STATUS_VARIANT: Record<string, "success" | "warning" | "destructive"> = {
  connected: "success",
  expired: "warning",
  revoked: "destructive",
  error: "destructive",
  disconnected: "destructive",
};

export function Channels({ client, canEdit }: { client: Client; canEdit: boolean }) {
  const confirm = useConfirm();
  const [channels, setChannels] = useState<SocialAccount[]>([]);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [mode, setMode] = useState<"zernio" | "direct" | "mock">("zernio");

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
    api<{ key: string; value: string }[]>("/settings")
      .then((settings) => {
        const m = settings.find((s) => s.key === "social_publishing_mode");
        if (m?.value === "direct") setMode("direct");
        else if (m?.value === "mock") setMode("mock");
      })
      .catch(() => {});
  }, [client.id]);

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
      if (mode === "mock" || !res.connect_url) {
        toast.success("Mock channel created");
        await load();
        return;
      }
      window.open(res.connect_url, "_blank", "width=560,height=660,popup");
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
    const ok = await confirm({
      title: "Remove channel",
      description: "You can reconnect it later from the integrations settings.",
      confirmLabel: "Remove",
      destructive: true,
    });
    if (!ok) return;
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
    <div className="space-y-4">
      <div className="mb-5 flex items-start justify-between gap-4">
        <div>
          <h2 className="m-0">Connected channels</h2>
          <p className="text-sm text-muted-foreground">
            {mode === "direct"
              ? "Connect this client's social accounts directly via each platform's API."
              : mode === "mock"
                ? "Mock mode is on — connecting a platform creates a fake channel that simulates publish outcomes locally (no real platform call)."
                : "Link this client's social accounts through Zernio, then publish and schedule to them."}
          </p>
        </div>
        <Button variant="ghost" onClick={sync} disabled={!!busy}>
          <RefreshCw size={14} /> {busy === "sync" ? "Syncing…" : "Sync"}
        </Button>
      </div>

      {error && (
        <div className="rounded-lg border-l-4 border-red-600 bg-red-50 p-3 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300">{error}</div>
      )}

      {canEdit && (
        <Card>
          <CardContent className="space-y-2 py-5">
            <strong className="text-sm font-semibold">Connect a new account</strong>
            <p className="text-sm text-muted-foreground">
              {mode === "direct"
                ? "Opens the platform's authorization page in a popup. After you approve, this list refreshes automatically."
                : mode === "mock"
                  ? "Creates a fake channel instantly — no OAuth or popup. Useful for previewing the publish flow without burning real API quota."
                  : "Opens Zernio's secure login in a new tab. After you authorize, come back and click Sync."}
            </p>
            <div className="flex flex-wrap gap-2">
              {connectableList.map((p) => (
                <Button key={p} variant="ghost" disabled={!!busy} onClick={() => connect(p)}>
                  <PlatformIcon platform={p} size={14} /> {busy === p ? "Opening…" : platformLabel(p)}
                </Button>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader><CardTitle>Active connections</CardTitle></CardHeader>
        <CardContent className="p-0">
          {loading ? (
            <p className="p-5 text-sm text-muted-foreground">Loading…</p>
          ) : channels.length === 0 ? (
            <p className="p-5 text-sm text-muted-foreground">No channels connected yet.</p>
          ) : (
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b border-border bg-surface-alt text-left text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  <th className="px-4 py-2.5">Account</th>
                  <th className="px-4 py-2.5">Status</th>
                  <th className="px-4 py-2.5">Token expires</th>
                  <th className="px-4 py-2.5"></th>
                </tr>
              </thead>
              <tbody>
                {channels.map((c) => (
                  <tr key={c.id} className="border-b border-border last:border-0">
                    <td className="px-4 py-2.5">
                      <span className="inline-flex items-center gap-2">
                        <PlatformIcon platform={c.platform} size={16} />
                        <span>
                          <strong>{c.display_name || platformLabel(c.platform)}</strong>
                          {c.username && <span className="text-sm text-muted-foreground"> @{c.username}</span>}
                        </span>
                      </span>
                    </td>
                    <td className="px-4 py-2.5">
                      <Badge variant={STATUS_VARIANT[c.status] ?? "secondary"}>{c.status}</Badge>
                    </td>
                    <td className="px-4 py-2.5 text-sm text-muted-foreground">
                      {c.token_expires_at ? new Date(c.token_expires_at).toLocaleDateString() : "—"}
                    </td>
                    <td className="px-4 py-2.5">
                      {canEdit && (
                        <div className="flex gap-1">
                          <Button variant="ghost" size="sm" disabled={!!busy} onClick={() => verify(c.id)}>
                            Verify
                          </Button>
                          <Button variant="ghost" size="sm" disabled={!!busy} onClick={() => disconnect(c.id)}>
                            Remove
                          </Button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
