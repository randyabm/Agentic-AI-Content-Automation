import { useEffect, useState } from "react";
import { api } from "../../api";
import { useConfirm } from "@/components/ui/dialogs";
import type { ProviderCredential } from "../../types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { Alert } from "./shared";

export function ProvidersSection() {
  const confirm = useConfirm();
  const [creds, setCreds] = useState<ProviderCredential[]>([]);
  const [keys, setKeys] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    api<ProviderCredential[]>("/provider-credentials").then(setCreds).catch((e) => setError(e.message));
  }, []);

  async function save(provider: string) {
    setError("");
    setNotice("");
    try {
      const updated = await api<ProviderCredential>(`/provider-credentials/${provider}`, {
        method: "PUT",
        body: { api_key: keys[provider] ?? "" },
      });
      setCreds((prev) => prev.map((c) => (c.provider === provider ? updated : c)));
      setKeys((prev) => ({ ...prev, [provider]: "" }));
      setNotice(`${updated.label} key saved.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    }
  }

  async function removeKey(provider: string, label: string) {
    const ok = await confirm({
      title: "Remove API key",
      description: `Remove the API key for ${label}? Models using this provider will stop working.`,
      confirmLabel: "Remove",
      destructive: true,
    });
    if (!ok) return;
    setError("");
    setNotice("");
    try {
      await api(`/provider-credentials/${provider}`, { method: "DELETE" });
      setCreds((prev) => prev.map((c) => c.provider === provider ? { ...c, has_key: false, api_key_hint: "" } : c));
      setNotice(`${label} key removed.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Remove failed");
    }
  }

  return (
    <Card>
      <CardHeader><CardTitle>Providers &amp; keys</CardTitle></CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">
          Set each provider's API key once. Every LLM function and image/video model that uses the
          provider shares this key — no need to paste it again per function.
        </p>
        {error && <Alert kind="error">{error}</Alert>}
        {notice && <Alert kind="success">{notice}</Alert>}
        <div className="mt-4 grid grid-cols-[repeat(auto-fill,minmax(280px,1fr))] gap-4">
          {creds.map((c) => (
            <div
              key={c.provider}
              className={cn(
                "flex flex-col gap-2 rounded-xl border border-border bg-surface p-4",
                c.has_key && "border-teal-600 bg-teal-50 dark:border-teal-500 dark:bg-teal-950/40",
              )}
            >
              <div className="flex items-center justify-between gap-2">
                <strong>{c.label}</strong>
                {c.has_key ? (
                  <Badge variant="success">key set</Badge>
                ) : (
                  <Badge variant="destructive">no key</Badge>
                )}
              </div>
              <div className="flex flex-wrap gap-1">
                {c.kinds.map((k) => (
                  <span key={k} className="inline-flex items-center gap-1 rounded-full border border-indigo-200 bg-indigo-50 px-2 py-0.5 text-[0.7rem] font-medium capitalize text-indigo-700 dark:border-indigo-800 dark:bg-indigo-950/50 dark:text-indigo-300">
                    {k}
                  </span>
                ))}
              </div>
              {c.has_key && <div className="font-mono text-xs text-muted-foreground">{c.api_key_hint}</div>}
              <div className="flex items-center gap-1.5">
                <Input
                  type="password"
                  placeholder={c.has_key ? "Replace key…" : "Paste API key…"}
                  value={keys[c.provider] ?? ""}
                  onChange={(e) => setKeys((prev) => ({ ...prev, [c.provider]: e.target.value }))}
                  className="min-w-0 flex-1"
                />
                <Button size="sm" disabled={!keys[c.provider]} onClick={() => save(c.provider)}>
                  Save
                </Button>
              </div>
              {c.has_key && (
                <Button variant="ghost" size="sm" className="mt-1 text-red-600 hover:bg-red-50 dark:hover:bg-red-950/40" onClick={() => removeKey(c.provider, c.label)}>
                  Remove key
                </Button>
              )}
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
