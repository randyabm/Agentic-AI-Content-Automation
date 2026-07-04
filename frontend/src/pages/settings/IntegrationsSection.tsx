import { useEffect, useState } from "react";
import { api } from "../../api";
import type { Setting } from "../../types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { Alert, SOCIAL_APP_PLATFORMS, type SocialAppStatus } from "./shared";

export function IntegrationsSection() {
  const [mode, setMode] = useState<"zernio" | "direct" | "mock">("zernio");
  const [modeMsg, setModeMsg] = useState("");
  const [modeError, setModeError] = useState("");
  const [, setAllSettings] = useState<Setting[]>([]);

  const [zernioStatus, setZernioStatus] = useState<{ has_key: boolean; api_key_hint: string } | null>(null);
  const [zernioKey, setZernioKey] = useState("");
  const [zernioMsg, setZernioMsg] = useState("");
  const [zernioError, setZernioError] = useState("");
  const [zernioBusy, setZernioBusy] = useState("");

  const [socialApps, setSocialApps] = useState<SocialAppStatus[]>([]);
  const [appCreds, setAppCreds] = useState<Record<string, { app_id: string; app_secret: string }>>({});
  const [directMsg, setDirectMsg] = useState("");
  const [directError, setDirectError] = useState("");
  const [urlSettings, setUrlSettings] = useState({ app_public_url: "", app_frontend_url: "" });
  const [urlMsg, setUrlMsg] = useState("");
  const [urlError, setUrlError] = useState("");

  const [oauthSettings, setOauthSettings] = useState({
    facebook_oauth_scopes: "",
    instagram_oauth_scopes: "",
    instagram_oauth_url: "",
  });
  const [oauthMsg, setOauthMsg] = useState("");
  const [oauthError, setOauthError] = useState("");

  useEffect(() => {
    api<Setting[]>("/settings").then((s) => {
      setAllSettings(s);
      const m = s.find((x) => x.key === "social_publishing_mode");
      if (m?.value === "direct") setMode("direct");
      else if (m?.value === "mock") setMode("mock");
      const pub = s.find((x) => x.key === "app_public_url");
      const fe = s.find((x) => x.key === "app_frontend_url");
      setUrlSettings({
        app_public_url: pub?.value ?? "",
        app_frontend_url: fe?.value ?? "",
      });
      setOauthSettings({
        facebook_oauth_scopes: s.find((x) => x.key === "facebook_oauth_scopes")?.value ?? "",
        instagram_oauth_scopes: s.find((x) => x.key === "instagram_oauth_scopes")?.value ?? "",
        instagram_oauth_url: s.find((x) => x.key === "instagram_oauth_url")?.value ?? "",
      });
    }).catch(() => {});

    api<{ has_key: boolean; api_key_hint: string }>("/integrations/zernio").then(setZernioStatus).catch(() => {});
    api<SocialAppStatus[]>("/integrations/social-apps").then(setSocialApps).catch(() => {});
  }, []);

  async function saveMode(newMode: "zernio" | "direct" | "mock") {
    setModeMsg("");
    setModeError("");
    try {
      const updated = await api<Setting[]>("/settings", {
        method: "PUT",
        body: { values: { social_publishing_mode: newMode } },
      });
      setAllSettings(updated);
      setMode(newMode);
      setModeMsg("Mode saved.");
    } catch (e) {
      setModeError(e instanceof Error ? e.message : "Could not save mode");
    }
  }

  async function saveZernioKey() {
    setZernioBusy("save");
    setZernioError("");
    setZernioMsg("");
    try {
      const res = await api<{ has_key: boolean; api_key_hint: string }>("/integrations/zernio", {
        method: "PUT",
        body: { api_key: zernioKey },
      });
      setZernioStatus(res);
      setZernioKey("");
      setZernioMsg("Saved.");
    } catch (e) {
      setZernioError(e instanceof Error ? e.message : "Could not save key");
    } finally {
      setZernioBusy("");
    }
  }

  async function testZernio() {
    setZernioBusy("test");
    setZernioError("");
    setZernioMsg("");
    try {
      const res = await api<{ ok: boolean; profiles: number }>("/integrations/zernio/test", { method: "POST" });
      setZernioMsg(`Connected — Zernio reachable (${res.profiles} profile${res.profiles === 1 ? "" : "s"}).`);
    } catch (e) {
      setZernioError(e instanceof Error ? e.message : "Connectivity test failed");
    } finally {
      setZernioBusy("");
    }
  }

  async function saveSocialApp(provider: string) {
    const platform = provider.replace("oauth_", "");
    const creds = appCreds[provider] ?? { app_id: "", app_secret: "" };
    setDirectError("");
    setDirectMsg("");
    try {
      const updated = await api<SocialAppStatus[]>(`/integrations/social-apps/${platform}`, {
        method: "PUT",
        body: creds,
      });
      setSocialApps(updated);
      setAppCreds((prev) => ({ ...prev, [provider]: { app_id: "", app_secret: "" } }));
      setDirectMsg(`${platform} credentials saved.`);
    } catch (e) {
      setDirectError(e instanceof Error ? e.message : "Could not save credentials");
    }
  }

  async function saveUrls() {
    setUrlMsg("");
    setUrlError("");
    try {
      await api<Setting[]>("/settings", {
        method: "PUT",
        body: { values: urlSettings },
      });
      setUrlMsg("URLs saved.");
    } catch (e) {
      setUrlError(e instanceof Error ? e.message : "Could not save URLs");
    }
  }

  async function saveOauthSettings() {
    setOauthMsg("");
    setOauthError("");
    try {
      await api<Setting[]>("/settings", {
        method: "PUT",
        body: { values: oauthSettings },
      });
      setOauthMsg("OAuth settings saved.");
    } catch (e) {
      setOauthError(e instanceof Error ? e.message : "Could not save OAuth settings");
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader><CardTitle>Social Publishing Connector</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Choose how the platform connects client social accounts and publishes content.
            Zernio is a third-party middleman; Direct uses each platform's API directly;
            Mock is a local simulator for development and previewing the publish flow.
          </p>
          <div className="space-y-1.5">
            <Label htmlFor="ss-mode">Active connector</Label>
            <select
              id="ss-mode"
              value={mode}
              onChange={(e) => {
                const v = e.target.value as "zernio" | "direct" | "mock";
                setMode(v);
                saveMode(v);
              }}
              className="flex h-10 w-full max-w-md rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            >
              <option value="zernio">Zernio (social publishing middleman)</option>
              <option value="direct">Direct Platform APIs</option>
              <option value="mock">Mock (local simulator)</option>
            </select>
          </div>
          {modeError && <Alert kind="error">{modeError}</Alert>}
          {modeMsg && <Alert kind="success">{modeMsg}</Alert>}
        </CardContent>
      </Card>

      <Card className={cn(mode !== "zernio" && "opacity-60")}>
        <CardHeader className="flex flex-row items-center gap-2 space-y-0">
          <CardTitle>Zernio — Social Publishing</CardTitle>
          {mode !== "zernio" && <Badge>inactive</Badge>}
        </CardHeader>
        <CardContent className="space-y-3">
          {mode === "mock" && (
            <p className="text-sm text-muted-foreground">Mock mode is on — Zernio is bypassed at publish time.</p>
          )}
          <p className="text-sm text-muted-foreground">
            One app-wide key powers connecting client social accounts and publishing across all
            organizations. Stored encrypted; only ever shown masked.
          </p>
          <div className="flex items-center gap-2">
            <Badge variant={zernioStatus?.has_key ? "success" : "secondary"}>
              {zernioStatus?.has_key ? `Key set: ${zernioStatus.api_key_hint}` : "No key set"}
            </Badge>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ss-zernio-key">API key</Label>
            <Input
              id="ss-zernio-key"
              type="password"
              placeholder={zernioStatus?.has_key ? "Enter a new key to replace" : "sk_…"}
              value={zernioKey}
              onChange={(e) => setZernioKey(e.target.value)}
            />
          </div>
          {zernioError && <Alert kind="error">{zernioError}</Alert>}
          {zernioMsg && <Alert kind="success">{zernioMsg}</Alert>}
          <div className="flex gap-2">
            <Button onClick={saveZernioKey} disabled={!zernioKey || !!zernioBusy}>
              {zernioBusy === "save" ? "Saving…" : "Save key"}
            </Button>
            <Button variant="ghost" onClick={testZernio} disabled={!zernioStatus?.has_key || !!zernioBusy}>
              {zernioBusy === "test" ? "Testing…" : "Test connection"}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card className={cn(mode !== "direct" && "opacity-60")}>
        <CardHeader className="flex flex-row items-center gap-2 space-y-0">
          <CardTitle>Direct Platform APIs</CardTitle>
          {mode !== "direct" && <Badge>inactive</Badge>}
        </CardHeader>
        <CardContent className="space-y-5">
          {mode === "mock" && (
            <p className="text-sm text-muted-foreground">Mock mode is on — Direct APIs are bypassed at publish time.</p>
          )}
          <p className="text-sm text-muted-foreground">
            Create an app in each platform's developer console, paste the credentials below.
            Users authorize your app directly on each platform — no third-party middleman.
          </p>

          <div className="space-y-3">
            <h3 className="mt-0">Callback URLs</h3>
            <p className="text-sm text-muted-foreground">
              Register these as allowed redirect URIs in each platform's developer console:
            </p>
            <div className="space-y-1 font-mono text-xs">
              {["facebook", "instagram", "twitter", "linkedin"].map((p) => (
                <div key={p}>
                  {urlSettings.app_public_url || "http://localhost:8000"}/auth/{p}/callback
                </div>
              ))}
            </div>
            <div className="mt-3 grid grid-cols-1 gap-x-4 gap-y-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="ss-pub-url">Backend public URL</Label>
                <Input id="ss-pub-url" value={urlSettings.app_public_url} onChange={(e) => setUrlSettings((u) => ({ ...u, app_public_url: e.target.value }))} placeholder="https://yourplatform.com" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="ss-fe-url">Frontend URL</Label>
                <Input id="ss-fe-url" value={urlSettings.app_frontend_url} onChange={(e) => setUrlSettings((u) => ({ ...u, app_frontend_url: e.target.value }))} placeholder="https://yourplatform.com" />
              </div>
            </div>
            {urlError && <Alert kind="error">{urlError}</Alert>}
            {urlMsg && <Alert kind="success">{urlMsg}</Alert>}
            <div className="flex gap-2">
              <Button onClick={saveUrls}>Save URLs</Button>
            </div>
          </div>

          <div className="space-y-3">
            <h3 className="mt-0">OAuth App Credentials</h3>
            {directError && <Alert kind="error">{directError}</Alert>}
            {directMsg && <Alert kind="success">{directMsg}</Alert>}

            {SOCIAL_APP_PLATFORMS.map(({ provider, label, idLabel, secretLabel }) => {
              const current = socialApps.find((a) => a.provider === provider);
              const editing = appCreds[provider] ?? { app_id: "", app_secret: "" };
              const configured = current?.has_app_id && current?.has_app_secret;
              return (
                <div key={provider} className={cn("rounded-xl border border-border bg-surface p-4", configured && "border-teal-600 bg-teal-50")}>
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <strong>{label}</strong>
                    {configured ? (
                      <Badge variant="success">configured</Badge>
                    ) : (
                      <Badge variant="destructive">not set</Badge>
                    )}
                  </div>
                  {current?.has_app_id && (
                    <div className="font-mono text-xs text-muted-foreground">{idLabel}: {current.app_id_hint}</div>
                  )}
                  <div className="mt-2 grid grid-cols-1 gap-x-4 gap-y-3 sm:grid-cols-2">
                    <div className="space-y-1.5">
                      <Label htmlFor={`${provider}-id`}>{idLabel}</Label>
                      <Input id={`${provider}-id`} type="password" placeholder={current?.has_app_id ? "Replace…" : "Paste…"} value={editing.app_id} onChange={(e) => setAppCreds((prev) => ({ ...prev, [provider]: { ...editing, app_id: e.target.value } }))} />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor={`${provider}-secret`}>{secretLabel}</Label>
                      <Input id={`${provider}-secret`} type="password" placeholder={current?.has_app_secret ? "Replace…" : "Paste…"} value={editing.app_secret} onChange={(e) => setAppCreds((prev) => ({ ...prev, [provider]: { ...editing, app_secret: e.target.value } }))} />
                    </div>
                  </div>
                  <div className="mt-3">
                    <Button size="sm" disabled={!editing.app_id && !editing.app_secret} onClick={() => saveSocialApp(provider)}>
                      Save
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="space-y-3">
            <h3 className="mt-6">OAuth Advanced Settings</h3>
            <p className="text-sm text-muted-foreground">
              Configure the authorization URL and permission scopes sent to each platform during the connect flow.
              Changes take effect on the next "Connect account" click.
            </p>
            <div className="flex flex-col gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="ss-fb-scopes">Facebook — OAuth scopes</Label>
                <Input id="ss-fb-scopes" value={oauthSettings.facebook_oauth_scopes} onChange={(e) => setOauthSettings((o) => ({ ...o, facebook_oauth_scopes: e.target.value }))} placeholder="pages_manage_posts,pages_read_engagement,pages_show_list" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="ss-ig-url">Instagram — OAuth authorization URL</Label>
                <Input id="ss-ig-url" value={oauthSettings.instagram_oauth_url} onChange={(e) => setOauthSettings((o) => ({ ...o, instagram_oauth_url: e.target.value }))} placeholder="https://api.instagram.com/oauth/authorize" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="ss-ig-scopes">Instagram — OAuth scopes</Label>
                <Input id="ss-ig-scopes" value={oauthSettings.instagram_oauth_scopes} onChange={(e) => setOauthSettings((o) => ({ ...o, instagram_oauth_scopes: e.target.value }))} placeholder="instagram_business_basic,instagram_business_content_publish" />
              </div>
            </div>
            {oauthError && <Alert kind="error">{oauthError}</Alert>}
            {oauthMsg && <Alert kind="success">{oauthMsg}</Alert>}
            <div className="mt-2">
              <Button onClick={saveOauthSettings}>Save OAuth settings</Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
