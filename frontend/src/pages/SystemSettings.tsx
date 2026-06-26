import { useEffect, useState } from "react";
import { Plus, X } from "lucide-react";
import { api } from "../api";
import { ArticleSources } from "../components/ArticleSources";
import { TextareaZoom } from "../components/TextareaZoom";
import { useConfirm } from "@/components/ui/dialogs";
import type {
  ImageModel,
  LLMConfig,
  ProviderCredential,
  ProviderModel,
  Setting,
  VideoModel,
} from "../types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";

type TabKey = "providers" | "llm" | "image" | "video" | "sources" | "integrations" | "global";

const TABS: { key: TabKey; label: string }[] = [
  { key: "providers", label: "Providers & Keys" },
  { key: "llm", label: "LLM Functions" },
  { key: "image", label: "Image Models" },
  { key: "video", label: "Video Models" },
  { key: "sources", label: "Article Sources" },
  { key: "integrations", label: "Integrations" },
  { key: "global", label: "Global" },
];

const LLM_PROVIDERS = [
  { value: "anthropic", label: "Anthropic (Claude)" },
  { value: "openai", label: "OpenAI" },
  { value: "openrouter", label: "OpenRouter" },
];
const IMAGE_PROVIDERS = [
  { value: "openrouter", label: "OpenRouter" },
  { value: "openai", label: "OpenAI" },
  { value: "magnific", label: "Magnific" },
];
const VIDEO_PROVIDERS = [
  { value: "google_veo", label: "Google Veo (Gemini API)" },
  { value: "openai_sora", label: "OpenAI Sora" },
  { value: "fal", label: "fal.ai" },
  { value: "replicate", label: "Replicate" },
  { value: "magnific", label: "Magnific" },
];

export default function SystemSettings() {
  const [tab, setTab] = useState<TabKey>("providers");
  return (
    <div>
      <div className="mb-5"><h1>System Settings</h1></div>
      <Tabs value={tab} onValueChange={(v) => setTab(v as TabKey)}>
        <TabsList>
          {TABS.map((t) => (
            <TabsTrigger key={t.key} value={t.key}>{t.label}</TabsTrigger>
          ))}
        </TabsList>
        <TabsContent value="providers" className="mt-5"><ProvidersSection /></TabsContent>
        <TabsContent value="llm" className="mt-5"><LLMConfigSection /></TabsContent>
        <TabsContent value="image" className="mt-5"><ImageModelSection /></TabsContent>
        <TabsContent value="video" className="mt-5"><VideoModelSection /></TabsContent>
        <TabsContent value="sources" className="mt-5"><ArticleSources /></TabsContent>
        <TabsContent value="integrations" className="mt-5"><IntegrationsSection /></TabsContent>
        <TabsContent value="global" className="mt-5"><GlobalSettingsSection /></TabsContent>
      </Tabs>
    </div>
  );
}

type SocialAppStatus = {
  provider: string;
  label: string;
  has_app_id: boolean;
  has_app_secret: boolean;
  app_id_hint: string;
};

const SOCIAL_APP_PLATFORMS: { provider: string; label: string; idLabel: string; secretLabel: string }[] = [
  { provider: "oauth_facebook", label: "Facebook", idLabel: "App ID", secretLabel: "App Secret" },
  { provider: "oauth_instagram", label: "Instagram", idLabel: "App ID", secretLabel: "App Secret" },
  { provider: "oauth_twitter", label: "Twitter / X", idLabel: "Client ID", secretLabel: "Client Secret" },
  { provider: "oauth_linkedin", label: "LinkedIn", idLabel: "Client ID", secretLabel: "Client Secret" },
];

function IntegrationsSection() {
  const [mode, setMode] = useState<"zernio" | "direct" | "mock">("zernio");
  const [modeMsg, setModeMsg] = useState("");
  const [modeError, setModeError] = useState("");
  const [allSettings, setAllSettings] = useState<Setting[]>([]);

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

function ModelSelect({
  provider,
  kind,
  value,
  onChange,
  onModelName,
}: {
  provider: string;
  kind: "text" | "image" | "video";
  value: string;
  onChange: (id: string) => void;
  onModelName?: (name: string) => void;
}) {
  const [models, setModels] = useState<ProviderModel[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const [manual, setManual] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setErr("");
    api<ProviderModel[]>(`/providers/${provider}/models?kind=${kind}`)
      .then((m) => {
        if (cancelled) return;
        setModels(m);
        setManual(m.length === 0);
      })
      .catch((e) => {
        if (cancelled) return;
        setModels([]);
        setManual(true);
        setErr(e instanceof Error ? e.message : "Could not load models");
      })
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [provider, kind]);

  if (manual) {
    return (
      <div className="space-y-1.5">
        <Input
          placeholder="Type the model ID"
          value={value}
          onChange={(e) => {
            onChange(e.target.value);
            onModelName?.(e.target.value);
          }}
        />
        {models.length > 0 && (
          <Button type="button" variant="ghost" size="sm" onClick={() => setManual(false)}>
            Pick from list
          </Button>
        )}
        {err && <div className="text-xs text-muted-foreground">{err} — enter the model ID manually.</div>}
      </div>
    );
  }

  return (
    <div className="space-y-1.5">
      <select
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          const found = models.find((m) => m.id === e.target.value);
          onModelName?.(found?.name || e.target.value);
        }}
        className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
      >
        <option value="">{loading ? "Loading models…" : "— select a model —"}</option>
        {value && !models.some((m) => m.id === value) && <option value={value}>{value}</option>}
        {models.map((m) => (<option key={m.id} value={m.id}>{m.name}</option>))}
      </select>
      <Button type="button" variant="ghost" size="sm" onClick={() => setManual(true)}>
        Enter manually
      </Button>
    </div>
  );
}

function ProvidersSection() {
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
                c.has_key && "border-teal-600 bg-teal-50",
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
                  <span key={k} className="inline-flex items-center gap-1 rounded-full border border-indigo-200 bg-indigo-50 px-2 py-0.5 text-[0.7rem] font-medium capitalize text-indigo-700">
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
                <Button variant="ghost" size="sm" className="mt-1 text-red-600 hover:bg-red-50" onClick={() => removeKey(c.provider, c.label)}>
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

function LLMConfigSection() {
  const [configs, setConfigs] = useState<LLMConfig[]>([]);
  const [editing, setEditing] = useState<LLMConfig | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    api<LLMConfig[]>("/llm-configs").then(setConfigs).catch((e) => setError(e.message));
  }, []);

  async function save() {
    if (!editing) return;
    setError("");
    try {
      const updated = await api<LLMConfig>(`/llm-configs/${editing.id}`, {
        method: "PATCH",
        body: {
          provider: editing.provider,
          model_name: editing.model_name,
          temperature: editing.temperature,
          max_tokens: editing.max_tokens,
          system_prompt: editing.system_prompt,
          is_active: editing.is_active,
        },
      });
      setConfigs((prev) => prev.map((c) => (c.id === updated.id ? updated : c)));
      setEditing(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    }
  }

  return (
    <Card>
      <CardHeader><CardTitle>LLM functions</CardTitle></CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">
          Pick a provider and model per function (PRD §9.1). The API key comes from the provider you
          set under <strong>Providers &amp; Keys</strong>.
        </p>
        {error && <Alert kind="error">{error}</Alert>}
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-border bg-surface-alt text-left text-xs font-medium uppercase tracking-wider text-muted-foreground">
              <th className="px-4 py-2.5">Function</th>
              <th className="px-4 py-2.5">Provider</th>
              <th className="px-4 py-2.5">Model</th>
              <th className="px-4 py-2.5">Temp</th>
              <th className="px-4 py-2.5">Active</th>
              <th className="px-4 py-2.5"></th>
            </tr>
          </thead>
          <tbody>
            {configs.map((c) => (
              <tr key={c.id} className="border-b border-border last:border-0">
                <td className="px-4 py-2.5">{c.function.replaceAll("_", " ")}</td>
                <td className="px-4 py-2.5">{c.provider}</td>
                <td className="px-4 py-2.5 font-mono">{c.model_name}</td>
                <td className="px-4 py-2.5">{c.temperature}</td>
                <td className="px-4 py-2.5">{c.is_active ? "✓" : "✗"}</td>
                <td className="px-4 py-2.5">
                  <Button variant="ghost" size="sm" onClick={() => setEditing({ ...c })}>Edit</Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {editing && (
          <div className="mt-4 border-t border-border pt-4">
            <h3 className="mb-3">Edit: {editing.function.replaceAll("_", " ")}</h3>
            <div className="grid grid-cols-1 gap-x-4 gap-y-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="llm-provider">Provider</Label>
                <select
                  id="llm-provider"
                  value={editing.provider}
                  onChange={(e) => setEditing({ ...editing, provider: e.target.value, model_name: "" })}
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                >
                  {LLM_PROVIDERS.map((p) => (<option key={p.value} value={p.value}>{p.label}</option>))}
                </select>
              </div>
              <div className="space-y-1.5">
                <Label>Model</Label>
                <ModelSelect
                  provider={editing.provider}
                  kind="text"
                  value={editing.model_name}
                  onChange={(id) => setEditing({ ...editing, model_name: id })}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="llm-temp">Temperature (0–2)</Label>
                <Input id="llm-temp" type="number" step="0.1" min="0" max="2" value={editing.temperature} onChange={(e) => setEditing({ ...editing, temperature: Number(e.target.value) })} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="llm-tokens">Max tokens</Label>
                <Input id="llm-tokens" type="number" min="1" max="64000" value={editing.max_tokens} onChange={(e) => setEditing({ ...editing, max_tokens: Number(e.target.value) })} />
              </div>
              <label className="flex flex-row items-center gap-2 text-sm">
                <input type="checkbox" checked={editing.is_active} onChange={(e) => setEditing({ ...editing, is_active: e.target.checked })} className="size-4 accent-primary" />
                Active
              </label>
            </div>
            <div className="mt-3 space-y-1.5">
              <Label>Base system prompt</Label>
              <TextareaZoom label="Base system prompt" rows={4} value={editing.system_prompt} onChange={(v) => setEditing({ ...editing, system_prompt: v })} />
            </div>
            <div className="mt-3 flex gap-2">
              <Button onClick={save}>Save</Button>
              <Button variant="ghost" onClick={() => setEditing(null)}>Cancel</Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

const EMPTY_IMAGE_FORM = { display_name: "", provider: "openrouter", model_name: "", is_default: false };

function ImageModelSection() {
  const confirm = useConfirm();
  const [models, setModels] = useState<ImageModel[]>([]);
  const [form, setForm] = useState<typeof EMPTY_IMAGE_FORM>(EMPTY_IMAGE_FORM);
  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    api<ImageModel[]>("/image-models").then(setModels).catch((e) => setError(e.message));
  }, []);

  function applyDefault(list: ImageModel[], saved: ImageModel): ImageModel[] {
    return list.map((m) => (m.id === saved.id ? saved : saved.is_default ? { ...m, is_default: false } : m));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    try {
      if (editId) {
        const updated = await api<ImageModel>(`/image-models/${editId}`, { method: "PATCH", body: form });
        setModels((prev) => applyDefault(prev, updated));
      } else {
        const created = await api<ImageModel>("/image-models", { method: "POST", body: form });
        setModels((prev) => [...applyDefault(prev, created).filter((m) => m.id !== created.id), created]);
      }
      resetForm();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save model");
    }
  }

  function resetForm() {
    setForm(EMPTY_IMAGE_FORM);
    setShowForm(false);
    setEditId(null);
  }

  function startEdit(m: ImageModel) {
    setForm({ display_name: m.display_name, provider: m.provider, model_name: m.model_name, is_default: m.is_default });
    setEditId(m.id);
    setShowForm(true);
  }

  async function patch(id: string, body: Record<string, unknown>) {
    try {
      const updated = await api<ImageModel>(`/image-models/${id}`, { method: "PATCH", body });
      setModels((prev) => applyDefault(prev, updated));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Update failed");
    }
  }

  async function remove(id: string) {
    const ok = await confirm({
      title: "Remove image model",
      description: "Remove this image model from the list?",
      confirmLabel: "Remove",
      destructive: true,
    });
    if (!ok) return;
    try {
      await api(`/image-models/${id}`, { method: "DELETE" });
      setModels((prev) => prev.filter((m) => m.id !== id));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Delete failed");
    }
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <CardTitle>Image generation models</CardTitle>
        <Button onClick={() => (showForm ? resetForm() : setShowForm(true))}>
          {showForm ? <><X size={14} /> Cancel</> : <><Plus size={14} /> Add model</>}
        </Button>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">
          Admin-curated list. Keys come from <strong>Providers &amp; Keys</strong>; model IDs are fetched
          automatically per provider.
        </p>
        {error && <Alert kind="error">{error}</Alert>}

        {showForm && (
          <form onSubmit={submit} className="mb-4 rounded-xl border border-border bg-surface-alt p-4">
            <div className="grid grid-cols-[repeat(auto-fit,minmax(200px,1fr))] gap-x-4 gap-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="img-prov">Provider</Label>
                <select
                  id="img-prov"
                  value={form.provider}
                  onChange={(e) => setForm({ ...form, provider: e.target.value, model_name: "" })}
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                >
                  {IMAGE_PROVIDERS.map((p) => (<option key={p.value} value={p.value}>{p.label}</option>))}
                </select>
              </div>
              <div className="space-y-1.5">
                <Label>Model</Label>
                <ModelSelect
                  provider={form.provider}
                  kind="image"
                  value={form.model_name}
                  onChange={(id) => setForm((f) => ({ ...f, model_name: id }))}
                  onModelName={(name) => setForm((f) => (f.display_name ? f : { ...f, display_name: name }))}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="img-name">Display name</Label>
                <Input id="img-name" value={form.display_name} onChange={(e) => setForm({ ...form, display_name: e.target.value })} required />
              </div>
              <label className="flex flex-row items-center gap-2 text-sm">
                <input type="checkbox" checked={form.is_default} onChange={(e) => setForm({ ...form, is_default: e.target.checked })} className="size-4 accent-primary" />
                Default
              </label>
            </div>
            <div className="mt-3 flex gap-2">
              <Button type="submit" disabled={!form.model_name}>
                {editId ? "Save changes" : "Add"}
              </Button>
              <Button type="button" variant="ghost" onClick={resetForm}>Cancel</Button>
            </div>
          </form>
        )}

        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-border bg-surface-alt text-left text-xs font-medium uppercase tracking-wider text-muted-foreground">
              <th className="px-4 py-2.5">Name</th>
              <th className="px-4 py-2.5">Provider</th>
              <th className="px-4 py-2.5">Model ID</th>
              <th className="px-4 py-2.5">Default</th>
              <th className="px-4 py-2.5">Active</th>
              <th className="px-4 py-2.5"></th>
            </tr>
          </thead>
          <tbody>
            {models.map((m) => (
              <tr key={m.id} className="border-b border-border last:border-0">
                <td className="px-4 py-2.5">{m.display_name}</td>
                <td className="px-4 py-2.5">{m.provider}</td>
                <td className="px-4 py-2.5 font-mono">{m.model_name}</td>
                <td className="px-4 py-2.5">
                  {m.is_default ? (
                    <Badge variant="success">default</Badge>
                  ) : (
                    <Button variant="ghost" size="sm" onClick={() => patch(m.id, { is_default: true })}>
                      Make default
                    </Button>
                  )}
                </td>
                <td className="px-4 py-2.5">
                  <Button variant="ghost" size="sm" onClick={() => patch(m.id, { is_active: !m.is_active })}>
                    {m.is_active ? "✓ active" : "✗ inactive"}
                  </Button>
                </td>
                <td className="px-4 py-2.5">
                  <div className="flex gap-1">
                    <Button variant="ghost" size="sm" onClick={() => startEdit(m)}>Edit</Button>
                    <Button variant="ghost" size="sm" className="text-red-600 hover:bg-red-50" onClick={() => remove(m.id)}>Delete</Button>
                  </div>
                </td>
              </tr>
            ))}
            {models.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-2.5 text-muted-foreground">
                  No image models yet. Add one to enable image generation.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </CardContent>
    </Card>
  );
}

const EMPTY_VIDEO_FORM = {
  display_name: "",
  provider: "google_veo",
  model_name: "",
  max_duration_seconds: 8,
  is_default: false,
};

function VideoModelSection() {
  const confirm = useConfirm();
  const [models, setModels] = useState<VideoModel[]>([]);
  const [form, setForm] = useState<typeof EMPTY_VIDEO_FORM>(EMPTY_VIDEO_FORM);
  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    api<VideoModel[]>("/video-models").then(setModels).catch((e) => setError(e.message));
  }, []);

  function applyDefault(list: VideoModel[], saved: VideoModel): VideoModel[] {
    return list.map((m) => (m.id === saved.id ? saved : saved.is_default ? { ...m, is_default: false } : m));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    try {
      if (editId) {
        const updated = await api<VideoModel>(`/video-models/${editId}`, { method: "PATCH", body: form });
        setModels((prev) => applyDefault(prev, updated));
      } else {
        const created = await api<VideoModel>("/video-models", { method: "POST", body: form });
        setModels((prev) => [...applyDefault(prev, created).filter((m) => m.id !== created.id), created]);
      }
      resetForm();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save model");
    }
  }

  function resetForm() {
    setForm(EMPTY_VIDEO_FORM);
    setShowForm(false);
    setEditId(null);
  }

  function startEdit(m: VideoModel) {
    setForm({
      display_name: m.display_name,
      provider: m.provider,
      model_name: m.model_name,
      max_duration_seconds: m.max_duration_seconds,
      is_default: m.is_default,
    });
    setEditId(m.id);
    setShowForm(true);
  }

  async function patch(id: string, body: Record<string, unknown>) {
    try {
      const updated = await api<VideoModel>(`/video-models/${id}`, { method: "PATCH", body });
      setModels((prev) => applyDefault(prev, updated));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Update failed");
    }
  }

  async function remove(id: string) {
    const ok = await confirm({
      title: "Remove video model",
      description: "Remove this video model from the list?",
      confirmLabel: "Remove",
      destructive: true,
    });
    if (!ok) return;
    try {
      await api(`/video-models/${id}`, { method: "DELETE" });
      setModels((prev) => prev.filter((m) => m.id !== id));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Delete failed");
    }
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <CardTitle>Video generation models</CardTitle>
        <Button onClick={() => (showForm ? resetForm() : setShowForm(true))}>
          {showForm ? <><X size={14} /> Cancel</> : <><Plus size={14} /> Add model</>}
        </Button>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">
          Admin-curated list. Each provider (Google Veo / OpenAI Sora / fal.ai / Replicate / Magnific) uses its key
          from <strong>Providers &amp; Keys</strong>. Magnific offers a model dropdown. fal.ai and Replicate need the model ID entered manually.
        </p>
        {error && <Alert kind="error">{error}</Alert>}

        {showForm && (
          <form onSubmit={submit} className="mb-4 rounded-xl border border-border bg-surface-alt p-4">
            <div className="grid grid-cols-[repeat(auto-fit,minmax(200px,1fr))] gap-x-4 gap-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="vid-prov">Provider</Label>
                <select
                  id="vid-prov"
                  value={form.provider}
                  onChange={(e) => setForm({ ...form, provider: e.target.value, model_name: "" })}
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                >
                  {VIDEO_PROVIDERS.map((p) => (<option key={p.value} value={p.value}>{p.label}</option>))}
                </select>
              </div>
              <div className="space-y-1.5">
                <Label>Model</Label>
                <ModelSelect
                  provider={form.provider}
                  kind="video"
                  value={form.model_name}
                  onChange={(id) => setForm((f) => ({ ...f, model_name: id }))}
                  onModelName={(name) => setForm((f) => (f.display_name ? f : { ...f, display_name: name }))}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="vid-name">Display name</Label>
                <Input id="vid-name" value={form.display_name} onChange={(e) => setForm({ ...form, display_name: e.target.value })} required />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="vid-secs">Max secs</Label>
                <Input id="vid-secs" type="number" min={1} max={60} value={form.max_duration_seconds} onChange={(e) => setForm({ ...form, max_duration_seconds: Number(e.target.value) })} />
              </div>
              <label className="flex flex-row items-center gap-2 text-sm">
                <input type="checkbox" checked={form.is_default} onChange={(e) => setForm({ ...form, is_default: e.target.checked })} className="size-4 accent-primary" />
                Default
              </label>
            </div>
            <div className="mt-3 flex gap-2">
              <Button type="submit" disabled={!form.model_name}>
                {editId ? "Save changes" : "Add"}
              </Button>
              <Button type="button" variant="ghost" onClick={resetForm}>Cancel</Button>
            </div>
          </form>
        )}

        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-border bg-surface-alt text-left text-xs font-medium uppercase tracking-wider text-muted-foreground">
              <th className="px-4 py-2.5">Name</th>
              <th className="px-4 py-2.5">Provider</th>
              <th className="px-4 py-2.5">Model ID</th>
              <th className="px-4 py-2.5">Max secs</th>
              <th className="px-4 py-2.5">Default</th>
              <th className="px-4 py-2.5">Active</th>
              <th className="px-4 py-2.5"></th>
            </tr>
          </thead>
          <tbody>
            {models.map((m) => (
              <tr key={m.id} className="border-b border-border last:border-0">
                <td className="px-4 py-2.5">{m.display_name}</td>
                <td className="px-4 py-2.5">{m.provider}</td>
                <td className="px-4 py-2.5 font-mono">{m.model_name}</td>
                <td className="px-4 py-2.5">{m.max_duration_seconds}</td>
                <td className="px-4 py-2.5">
                  {m.is_default ? (
                    <Badge variant="success">default</Badge>
                  ) : (
                    <Button variant="ghost" size="sm" onClick={() => patch(m.id, { is_default: true })}>
                      Make default
                    </Button>
                  )}
                </td>
                <td className="px-4 py-2.5">
                  <Button variant="ghost" size="sm" onClick={() => patch(m.id, { is_active: !m.is_active })}>
                    {m.is_active ? "✓ active" : "✗ inactive"}
                  </Button>
                </td>
                <td className="px-4 py-2.5">
                  <div className="flex gap-1">
                    <Button variant="ghost" size="sm" onClick={() => startEdit(m)}>Edit</Button>
                    <Button variant="ghost" size="sm" className="text-red-600 hover:bg-red-50" onClick={() => remove(m.id)}>Delete</Button>
                  </div>
                </td>
              </tr>
            ))}
            {models.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-2.5 text-muted-foreground">
                  No video models yet. Add one to enable video generation.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </CardContent>
    </Card>
  );
}

const SELECT_OPTIONS: Record<string, { value: string; label: string }[]> = {
  social_publishing_mode: [
    { value: "zernio", label: "Zernio (social publishing middleman)" },
    { value: "direct", label: "Direct Platform APIs" },
  ],
  default_ui_language: [
    { value: "en", label: "English" },
    { value: "es", label: "Spanish" },
  ],
  default_content_language: [
    { value: "en", label: "English" },
    { value: "es", label: "Spanish" },
  ],
  onboarding_competitor_depth: [
    { value: "analyze", label: "Analyze (identify + full analysis)" },
    { value: "identify", label: "Identify (list only)" },
  ],
  onboarding_competitor_type: [
    { value: "direct", label: "Direct" },
    { value: "indirect", label: "Indirect" },
  ],
  onboarding_competitor_scope: [
    { value: "local", label: "Local" },
    { value: "national", label: "National" },
    { value: "international", label: "International" },
  ],
};

const BOOLEAN_SETTINGS = new Set(["onboarding_auto_run", "show_onboarding_panel", "dev_mode", "show_article_library"]);

const NUMBER_SETTINGS = new Set([
  "default_competitor_count",
  "default_article_count",
  "crawler_max_depth",
  "crawler_max_pages",
  "crawler_timeout_seconds",
  "crawler_concurrency",
  "competitor_crawl_max_depth",
  "competitor_crawl_max_pages",
]);

const SETTING_META: Record<string, { label: string; help: string }> = {
  default_ui_language: {
    label: "Interface language",
    help: "Language used for the platform's own menus, labels and buttons.",
  },
  default_content_language: {
    label: "Content language",
    help: "Default language the AI writes campaigns, posts and articles in. Can be overridden per client.",
  },
  onboarding_auto_run: {
    label: "Auto-run onboarding",
    help: "When ON, creating a client immediately kicks off the full pipeline (crawl site, import articles, research competitors). When OFF, you start each step manually.",
  },
  show_onboarding_panel: {
    label: "Show onboarding panel",
    help: "When ON, the Onboarding card is visible on every client detail page. Keep OFF in production — it's mainly useful during testing and debugging.",
  },
  dev_mode: {
    label: "Developer mode",
    help: "When ON, shows admin action buttons (Analyze Website, Import Articles) on the client detail page. Keep OFF for end-user-facing environments.",
  },
  show_article_library: {
    label: "Show Article Library",
    help: "When ON, the Article Library link appears in the left sidebar. Turn OFF to hide the global library and direct article access through individual client pages.",
  },
  default_article_count: {
    label: "Articles to import",
    help: "How many articles onboarding pulls in from the client's site as a baseline content library.",
  },
  default_competitor_count: {
    label: "Competitors to research",
    help: "How many competitors the AI tries to identify and analyze for a new client.",
  },
  onboarding_competitor_depth: {
    label: "Competitor depth",
    help: "“Analyze” identifies competitors and runs a full crawl + analysis of each (slower, richer). “Identify” only produces the list.",
  },
  onboarding_competitor_type: {
    label: "Competitor type",
    help: "“Direct” = rivals offering the same product/service. “Indirect” = different offering competing for the same audience or need.",
  },
  onboarding_competitor_scope: {
    label: "Competitor scope",
    help: "Geographic reach when searching for competitors: same city/region (local), country-wide (national), or worldwide (international).",
  },
  crawler_max_depth: {
    label: "Max crawl depth",
    help: "How many link levels deep to follow from the homepage. Higher = more coverage but slower.",
  },
  crawler_max_pages: {
    label: "Max pages per site",
    help: "Hard cap on the number of pages fetched from a single site, so a large site can't run forever.",
  },
  crawler_concurrency: {
    label: "Parallel requests",
    help: "How many pages are fetched at the same time per depth level. Higher = faster, but more load on the target site.",
  },
  crawler_timeout_seconds: {
    label: "Page timeout (seconds)",
    help: "How long to wait for a single page to respond before giving up and moving on.",
  },
  crawler_excluded_paths: {
    label: "Excluded URL paths",
    help: "Comma-separated regex patterns; any URL path matching one is skipped (e.g. /cart, /login, \\?.*).",
  },
  crawler_user_agent: {
    label: "Crawler User-Agent",
    help: "The User-Agent header the crawler sends. Identifies our bot to the sites it visits.",
  },
  competitor_crawl_max_depth: {
    label: "Competitor crawl depth",
    help: "Link depth used specifically when crawling competitor sites — kept shallow so analysis stays fast.",
  },
  competitor_crawl_max_pages: {
    label: "Competitor max pages",
    help: "Page cap when crawling a competitor site. Intentionally small to keep competitor analysis quick.",
  },
};

const SETTING_GROUPS: { title: string; description: string; accent: string; keys: string[] }[] = [
  {
    title: "Language & localization",
    description: "Default languages for the interface and the content the AI produces.",
    accent: "#2563EB",
    keys: ["default_ui_language", "default_content_language"],
  },
  {
    title: "Interface & developer tools",
    description: "Controls which sections of the UI are visible and which developer tools are exposed.",
    accent: "#7C3AED",
    keys: ["show_article_library", "dev_mode", "show_onboarding_panel"],
  },
  {
    title: "Client onboarding",
    description: "What happens automatically when a new client is created.",
    accent: "#4338CA",
    keys: [
      "onboarding_auto_run",
      "default_article_count",
      "default_competitor_count",
      "onboarding_competitor_depth",
      "onboarding_competitor_type",
      "onboarding_competitor_scope",
    ],
  },
  {
    title: "Site crawler",
    description: "How the crawler explores a client's own website.",
    accent: "#0F766E",
    keys: [
      "crawler_max_depth",
      "crawler_max_pages",
      "crawler_concurrency",
      "crawler_timeout_seconds",
      "crawler_excluded_paths",
      "crawler_user_agent",
    ],
  },
  {
    title: "Competitor crawler",
    description: "A lighter crawl used when analyzing competitor sites — kept small to stay fast.",
    accent: "#D97706",
    keys: ["competitor_crawl_max_depth", "competitor_crawl_max_pages"],
  },
];

function SettingsGroup({ title, description, accent, children }: { title: string; description: string; accent: string; children: React.ReactNode }) {
  return (
    <div
      className="mt-6 overflow-hidden rounded-lg border border-border border-l-4 bg-surface shadow-sm first:mt-4"
      style={{ borderLeftColor: accent }}
    >
      <div
        className="border-b border-border px-4 py-3"
        style={{ backgroundColor: `color-mix(in srgb, ${accent} 8%, var(--surface))` }}
      >
        <h3 className="m-0" style={{ color: accent }}>{title}</h3>
        {description && <div className="mt-0.5 text-sm text-muted-foreground">{description}</div>}
      </div>
      {children}
    </div>
  );
}

function GlobalSettingsSection() {
  const [settings, setSettings] = useState<Setting[]>([]);
  const [edited, setEdited] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    api<Setting[]>("/settings").then(setSettings).catch((e) => setError(e.message));
  }, []);

  async function save() {
    setError("");
    setNotice("");
    try {
      const updated = await api<Setting[]>("/settings", { method: "PUT", body: { values: edited } });
      setSettings(updated);
      setEdited({});
      setNotice("Settings saved.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    }
  }

  const byKey = new Map(settings.map((s) => [s.key, s]));
  const grouped = new Set(SETTING_GROUPS.flatMap((g) => g.keys));
  const ungrouped = settings.filter((s) => !grouped.has(s.key));

  function renderControl(s: Setting) {
    const val = edited[s.key] ?? s.value;
    if (SELECT_OPTIONS[s.key]) {
      return (
        <select
          value={val}
          onChange={(e) => setEdited({ ...edited, [s.key]: e.target.value })}
          className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
        >
          {SELECT_OPTIONS[s.key].map((o) => (<option key={o.value} value={o.value}>{o.label}</option>))}
        </select>
      );
    }
    if (BOOLEAN_SETTINGS.has(s.key)) {
      return (
        <label className="flex flex-row items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={val === "true"}
            onChange={(e) => setEdited({ ...edited, [s.key]: e.target.checked ? "true" : "false" })}
            className="size-4 accent-primary"
          />
          <span className="text-sm text-muted-foreground">{val === "true" ? "Enabled" : "Disabled"}</span>
        </label>
      );
    }
    if (NUMBER_SETTINGS.has(s.key)) {
      return (
        <Input
          type="number"
          min={0}
          value={val}
          onChange={(e) => setEdited({ ...edited, [s.key]: e.target.value })}
        />
      );
    }
    return <Input value={val} onChange={(e) => setEdited({ ...edited, [s.key]: e.target.value })} />;
  }

  function renderRows(items: Setting[]) {
    return items.map((s) => {
      const meta = SETTING_META[s.key];
      return (
        <tr key={s.key} className="border-b border-border last:border-0">
          <td className="px-4 py-3 align-top">
            <strong>{meta?.label ?? s.key}</strong>
            <div className="font-mono text-xs text-muted-foreground">{s.key}</div>
            <div className="mt-0.5 text-sm text-muted-foreground">{meta?.help ?? s.description}</div>
          </td>
          <td className="px-4 py-3 align-middle">{renderControl(s)}</td>
        </tr>
      );
    });
  }

  return (
    <Card>
      <CardHeader><CardTitle>Global settings</CardTitle></CardHeader>
      <CardContent className="space-y-4">
        {error && <Alert kind="error">{error}</Alert>}
        {notice && <Alert kind="success">{notice}</Alert>}

        {SETTING_GROUPS.map((g) => {
          const items = g.keys.map((k) => byKey.get(k)).filter((s): s is Setting => !!s);
          if (items.length === 0) return null;
          return (
            <SettingsGroup key={g.title} title={g.title} description={g.description} accent={g.accent}>
              <table className="w-full border-collapse text-sm">
                <tbody>{renderRows(items)}</tbody>
              </table>
            </SettingsGroup>
          );
        })}

        {ungrouped.length > 0 && (
          <SettingsGroup title="Other" description="" accent="#78716C">
            <table className="w-full border-collapse text-sm">
              <tbody>{renderRows(ungrouped)}</tbody>
            </table>
          </SettingsGroup>
        )}

        <PublishingLimitsEditor />

        <div className="flex">
          <Button onClick={save} disabled={Object.keys(edited).length === 0}>
            Save changes
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function PublishingLimitsEditor() {
  const PLATFORMS = [
    { key: "instagram", label: "Instagram" },
    { key: "facebook", label: "Facebook" },
    { key: "linkedin", label: "LinkedIn" },
    { key: "x", label: "X (Twitter)" },
  ];

  const [limits, setLimits] = useState<Record<string, { per_day: number; min_gap_min: number }>>({});
  const [edited, setEdited] = useState<Record<string, { per_day: number; min_gap_min: number }>>({});
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api<{ limits: Record<string, { per_day: number; min_gap_min: number }> }>(
      "/settings/publishing-limits",
    )
      .then((r) => {
        setLimits(r.limits);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load limits"))
      .finally(() => setLoading(false));
  }, []);

  function currentValue(platform: string): { per_day: number; min_gap_min: number } {
    if (edited[platform]) return edited[platform];
    return limits[platform] ?? limits._default ?? { per_day: 20, min_gap_min: 10 };
  }

  function setField(platform: string, field: "per_day" | "min_gap_min", value: number) {
    const next = { ...currentValue(platform), [field]: value };
    setEdited((prev) => ({ ...prev, [platform]: next }));
  }

  async function save() {
    setError("");
    setNotice("");
    setSaving(true);
    try {
      const res = await api<{ limits: Record<string, { per_day: number; min_gap_min: number }> }>(
        "/settings/publishing-limits",
        { method: "PUT", body: { limits: edited } },
      );
      setLimits(res.limits);
      setEdited({});
      setNotice("Publishing limits updated.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  function reset() {
    setEdited({});
  }

  const dirty = Object.keys(edited).length > 0;

  return (
    <SettingsGroup title="Publishing limits" description="Throttle the publish queue per account so we never burst a platform. per_day is the max posts/24h rolling window; min_gap_min is the minimum minutes between consecutive posts on the same account. Empty cells fall back to the safe default." accent="#0F766E">
      <div className="p-4">
        {error && <Alert kind="error">{error}</Alert>}
        {notice && <Alert kind="success">{notice}</Alert>}
        {loading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : (
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-border bg-surface-alt text-left text-xs font-medium uppercase tracking-wider text-muted-foreground">
                <th className="px-4 py-2.5">Platform</th>
                <th className="px-4 py-2.5">Posts per day (per account)</th>
                <th className="px-4 py-2.5">Minimum gap (minutes)</th>
              </tr>
            </thead>
            <tbody>
              {PLATFORMS.map((p) => {
                const v = currentValue(p.key);
                return (
                  <tr key={p.key} className="border-b border-border last:border-0">
                    <td className="px-4 py-2.5"><strong>{p.label}</strong></td>
                    <td className="px-4 py-2.5">
                      <Input
                        type="number"
                        min={1}
                        value={v.per_day}
                        onChange={(e) => setField(p.key, "per_day", Math.max(1, Number(e.target.value) || 0))}
                        className="w-24"
                      />
                    </td>
                    <td className="px-4 py-2.5">
                      <Input
                        type="number"
                        min={0}
                        value={v.min_gap_min}
                        onChange={(e) => setField(p.key, "min_gap_min", Math.max(0, Number(e.target.value) || 0))}
                        className="w-24"
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
        <div className="mt-3 flex gap-2">
          <Button variant="ghost" onClick={reset} disabled={!dirty || saving}>Reset</Button>
          <Button onClick={save} disabled={!dirty || saving}>
            {saving ? "Saving…" : "Save limits"}
          </Button>
        </div>
      </div>
    </SettingsGroup>
  );
}

function Alert({ kind, children }: { kind: "error" | "success"; children: React.ReactNode }) {
  if (kind === "error") {
    return <div className="rounded-lg border-l-4 border-red-600 bg-red-50 p-3 text-sm text-red-700">{children}</div>;
  }
  return <div className="rounded-lg border-l-4 border-emerald-600 bg-emerald-50 p-3 text-sm text-emerald-700">{children}</div>;
}
