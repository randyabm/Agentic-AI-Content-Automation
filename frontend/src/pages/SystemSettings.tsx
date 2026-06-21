import { useEffect, useState } from "react";
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

// Per-domain provider options. The model ID is auto-fetched per provider; the
// API key is resolved centrally from the matching Provider credential.
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
      <div className="page-header">
        <h1>System Settings</h1>
      </div>
      <div className="tabs">
        {TABS.map((t) => (
          <button
            key={t.key}
            className={`tab ${tab === t.key ? "tab-active" : ""}`}
            onClick={() => setTab(t.key)}
          >
            {t.label}
          </button>
        ))}
      </div>
      {tab === "providers" && <ProvidersSection />}
      {tab === "llm" && <LLMConfigSection />}
      {tab === "image" && <ImageModelSection />}
      {tab === "video" && <VideoModelSection />}
      {tab === "sources" && <ArticleSources />}
      {tab === "integrations" && <IntegrationsSection />}
      {tab === "global" && <GlobalSettingsSection />}
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

/** Integrations tab: toggle between Zernio middleman and direct platform APIs. */
function IntegrationsSection() {
  // Publishing mode (from settings table)
  const [mode, setMode] = useState<"zernio" | "direct">("zernio");
  const [modeMsg, setModeMsg] = useState("");
  const [modeError, setModeError] = useState("");
  const [allSettings, setAllSettings] = useState<Setting[]>([]);

  // Zernio key
  const [zernioStatus, setZernioStatus] = useState<{ has_key: boolean; api_key_hint: string } | null>(null);
  const [zernioKey, setZernioKey] = useState("");
  const [zernioMsg, setZernioMsg] = useState("");
  const [zernioError, setZernioError] = useState("");
  const [zernioBusy, setZernioBusy] = useState("");

  // Direct: OAuth app credentials + URL settings
  const [socialApps, setSocialApps] = useState<SocialAppStatus[]>([]);
  const [appCreds, setAppCreds] = useState<Record<string, { app_id: string; app_secret: string }>>({});
  const [directMsg, setDirectMsg] = useState("");
  const [directError, setDirectError] = useState("");
  const [urlSettings, setUrlSettings] = useState({ app_public_url: "", app_frontend_url: "" });
  const [urlMsg, setUrlMsg] = useState("");
  const [urlError, setUrlError] = useState("");

  // OAuth advanced settings (scopes + Instagram URL)
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

  async function saveMode(newMode: "zernio" | "direct") {
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
    // provider = 'oauth_facebook' | 'oauth_twitter' | 'oauth_linkedin'
    // extract the platform key: facebook | twitter | linkedin
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
    <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      {/* --- Mode selector --- */}
      <div className="card">
        <h2 style={{ marginTop: 0 }}>Social Publishing Connector</h2>
        <p className="muted">
          Choose how the platform connects client social accounts and publishes content.
          Zernio is a third-party middleman; Direct uses each platform's API directly.
        </p>
        <label>
          Active connector
          <select
            value={mode}
            onChange={(e) => {
              const v = e.target.value as "zernio" | "direct";
              setMode(v);
              saveMode(v);
            }}
          >
            <option value="zernio">Zernio (social publishing middleman)</option>
            <option value="direct">Direct Platform APIs</option>
          </select>
        </label>
        {modeError && <div className="alert alert-error">{modeError}</div>}
        {modeMsg && <div className="alert alert-success">{modeMsg}</div>}
      </div>

      {/* --- Zernio section (always shown so admin can keep it configured) --- */}
      <div className="card" style={{ opacity: mode === "zernio" ? 1 : 0.6 }}>
        <h2 style={{ marginTop: 0 }}>
          Zernio — Social Publishing
          {mode !== "zernio" && <span className="tag" style={{ marginLeft: 8 }}>inactive</span>}
        </h2>
        <p className="muted">
          One app-wide key powers connecting client social accounts and publishing across all
          organizations. Stored encrypted; only ever shown masked.
        </p>
        <div className="form-row" style={{ alignItems: "center", gap: 8 }}>
          <span className="tag">{zernioStatus?.has_key ? `Key set: ${zernioStatus.api_key_hint}` : "No key set"}</span>
        </div>
        <label>
          API key
          <input
            type="password"
            placeholder={zernioStatus?.has_key ? "Enter a new key to replace" : "sk_…"}
            value={zernioKey}
            onChange={(e) => setZernioKey(e.target.value)}
          />
        </label>
        {zernioError && <div className="alert alert-error">{zernioError}</div>}
        {zernioMsg && <div className="alert alert-success">{zernioMsg}</div>}
        <div className="form-actions">
          <button className="btn btn-primary" onClick={saveZernioKey} disabled={!zernioKey || !!zernioBusy}>
            {zernioBusy === "save" ? "Saving…" : "Save key"}
          </button>
          <button className="btn btn-ghost" onClick={testZernio} disabled={!zernioStatus?.has_key || !!zernioBusy}>
            {zernioBusy === "test" ? "Testing…" : "Test connection"}
          </button>
        </div>
      </div>

      {/* --- Direct API section --- */}
      <div className="card" style={{ opacity: mode === "direct" ? 1 : 0.6 }}>
        <h2 style={{ marginTop: 0 }}>
          Direct Platform APIs
          {mode !== "direct" && <span className="tag" style={{ marginLeft: 8 }}>inactive</span>}
        </h2>
        <p className="muted">
          Create an app in each platform's developer console, paste the credentials below.
          Users authorize your app directly on each platform — no third-party middleman.
        </p>

        {/* URL settings */}
        <div style={{ marginBottom: 20 }}>
          <h3 style={{ marginTop: 0 }}>Callback URLs</h3>
          <p className="muted small">
            Register these as allowed redirect URIs in each platform's developer console:
          </p>
          {["facebook", "instagram", "twitter", "linkedin"].map((p) => (
            <div key={p} className="mono small" style={{ marginBottom: 4 }}>
              {urlSettings.app_public_url || "http://localhost:8000"}/auth/{p}/callback
            </div>
          ))}
          <div className="form-grid" style={{ marginTop: 12 }}>
            <label>
              Backend public URL
              <input
                value={urlSettings.app_public_url}
                onChange={(e) => setUrlSettings((u) => ({ ...u, app_public_url: e.target.value }))}
                placeholder="https://yourplatform.com"
              />
            </label>
            <label>
              Frontend URL
              <input
                value={urlSettings.app_frontend_url}
                onChange={(e) => setUrlSettings((u) => ({ ...u, app_frontend_url: e.target.value }))}
                placeholder="https://yourplatform.com"
              />
            </label>
          </div>
          {urlError && <div className="alert alert-error">{urlError}</div>}
          {urlMsg && <div className="alert alert-success">{urlMsg}</div>}
          <div className="form-actions">
            <button className="btn btn-primary" onClick={saveUrls}>Save URLs</button>
          </div>
        </div>

        {/* Per-platform OAuth app credentials */}
        <h3 style={{ marginTop: 0 }}>OAuth App Credentials</h3>
        {directError && <div className="alert alert-error">{directError}</div>}
        {directMsg && <div className="alert alert-success">{directMsg}</div>}

        {SOCIAL_APP_PLATFORMS.map(({ provider, label, idLabel, secretLabel }) => {
          const current = socialApps.find((a) => a.provider === provider);
          const editing = appCreds[provider] ?? { app_id: "", app_secret: "" };
          return (
            <div key={provider} className="provider-card" style={{ marginBottom: 16 }}>
              <div className="provider-card-head">
                <strong>{label}</strong>
                {current?.has_app_id && current?.has_app_secret ? (
                  <span className="tag tag-green">configured</span>
                ) : (
                  <span className="tag tag-red">not set</span>
                )}
              </div>
              {current?.has_app_id && (
                <div className="mono small muted">{idLabel}: {current.app_id_hint}</div>
              )}
              <div className="form-grid" style={{ marginTop: 8 }}>
                <label>
                  {idLabel}
                  <input
                    type="password"
                    placeholder={current?.has_app_id ? "Replace…" : "Paste…"}
                    value={editing.app_id}
                    onChange={(e) =>
                      setAppCreds((prev) => ({ ...prev, [provider]: { ...editing, app_id: e.target.value } }))
                    }
                  />
                </label>
                <label>
                  {secretLabel}
                  <input
                    type="password"
                    placeholder={current?.has_app_secret ? "Replace…" : "Paste…"}
                    value={editing.app_secret}
                    onChange={(e) =>
                      setAppCreds((prev) => ({ ...prev, [provider]: { ...editing, app_secret: e.target.value } }))
                    }
                  />
                </label>
              </div>
              <div className="form-actions">
                <button
                  className="btn btn-primary small"
                  disabled={!editing.app_id && !editing.app_secret}
                  onClick={() => saveSocialApp(provider)}
                >
                  Save
                </button>
              </div>
            </div>
          );
        })}

        {/* OAuth Advanced Settings */}
        <h3 style={{ marginTop: 24 }}>OAuth Advanced Settings</h3>
        <p className="muted small">
          Configure the authorization URL and permission scopes sent to each platform during the connect flow.
          Changes take effect on the next "Connect account" click.
        </p>
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <label>
            Facebook — OAuth scopes
            <input
              value={oauthSettings.facebook_oauth_scopes}
              onChange={(e) => setOauthSettings((o) => ({ ...o, facebook_oauth_scopes: e.target.value }))}
              placeholder="pages_manage_posts,pages_read_engagement,pages_show_list"
            />
          </label>
          <label>
            Instagram — OAuth authorization URL
            <input
              value={oauthSettings.instagram_oauth_url}
              onChange={(e) => setOauthSettings((o) => ({ ...o, instagram_oauth_url: e.target.value }))}
              placeholder="https://api.instagram.com/oauth/authorize"
            />
          </label>
          <label>
            Instagram — OAuth scopes
            <input
              value={oauthSettings.instagram_oauth_scopes}
              onChange={(e) => setOauthSettings((o) => ({ ...o, instagram_oauth_scopes: e.target.value }))}
              placeholder="instagram_business_basic,instagram_business_content_publish"
            />
          </label>
        </div>
        {oauthError && <div className="alert alert-error">{oauthError}</div>}
        {oauthMsg && <div className="alert alert-success">{oauthMsg}</div>}
        <div className="form-actions" style={{ marginTop: 8 }}>
          <button className="btn btn-primary" onClick={saveOauthSettings}>Save OAuth settings</button>
        </div>
      </div>
    </div>
  );
}

/** A model picker that auto-fetches available model IDs for the chosen provider,
 *  with a manual-entry fallback for providers without a usable list endpoint. */
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
      <div>
        <input
          placeholder="Type the model ID"
          value={value}
          onChange={(e) => {
            onChange(e.target.value);
            onModelName?.(e.target.value);
          }}
        />
        {models.length > 0 && (
          <button type="button" className="btn btn-ghost small" onClick={() => setManual(false)}>
            Pick from list
          </button>
        )}
        {err && <div className="small muted">{err} — enter the model ID manually.</div>}
      </div>
    );
  }

  return (
    <div>
      <select
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          const found = models.find((m) => m.id === e.target.value);
          onModelName?.(found?.name || e.target.value);
        }}
      >
        <option value="">{loading ? "Loading models…" : "— select a model —"}</option>
        {value && !models.some((m) => m.id === value) && <option value={value}>{value}</option>}
        {models.map((m) => (
          <option key={m.id} value={m.id}>
            {m.name}
          </option>
        ))}
      </select>
      <button type="button" className="btn btn-ghost small" onClick={() => setManual(true)}>
        Enter manually
      </button>
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
    <div className="card">
      <h2>Providers &amp; keys</h2>
      <p className="muted">
        Set each provider's API key once. Every LLM function and image/video model that uses the
        provider shares this key — no need to paste it again per function.
      </p>
      {error && <div className="alert alert-error">{error}</div>}
      {notice && <div className="alert alert-success">{notice}</div>}
      <div className="provider-grid">
        {creds.map((c) => (
          <div key={c.provider} className={`provider-card ${c.has_key ? "has-key" : ""}`}>
            <div className="provider-card-head">
              <strong>{c.label}</strong>
              {c.has_key ? (
                <span className="tag tag-green">key set</span>
              ) : (
                <span className="tag tag-red">no key</span>
              )}
            </div>
            <div className="platform-chips">
              {c.kinds.map((k) => (
                <span key={k} className="chip">
                  {k}
                </span>
              ))}
            </div>
            {c.has_key && <div className="mono small muted">{c.api_key_hint}</div>}
            <div className="provider-key-row">
              <input
                type="password"
                placeholder={c.has_key ? "Replace key…" : "Paste API key…"}
                value={keys[c.provider] ?? ""}
                onChange={(e) => setKeys((prev) => ({ ...prev, [c.provider]: e.target.value }))}
              />
              <button
                className="btn btn-primary small"
                disabled={!keys[c.provider]}
                onClick={() => save(c.provider)}
              >
                Save
              </button>
            </div>
            {c.has_key && (
              <button
                className="btn btn-ghost small"
                style={{ color: "var(--danger, #dc2626)", marginTop: "0.25rem" }}
                onClick={() => removeKey(c.provider, c.label)}
              >
                Remove key
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
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
    <div className="card">
      <h2>LLM functions</h2>
      <p className="muted">
        Pick a provider and model per function (PRD §9.1). The API key comes from the provider you
        set under <strong>Providers &amp; Keys</strong>.
      </p>
      {error && <div className="alert alert-error">{error}</div>}
      <table className="table">
        <thead>
          <tr>
            <th>Function</th>
            <th>Provider</th>
            <th>Model</th>
            <th>Temp</th>
            <th>Active</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {configs.map((c) => (
            <tr key={c.id}>
              <td>{c.function.replaceAll("_", " ")}</td>
              <td>{c.provider}</td>
              <td className="mono">{c.model_name}</td>
              <td>{c.temperature}</td>
              <td>{c.is_active ? "✓" : "✗"}</td>
              <td>
                <button className="btn btn-ghost" onClick={() => setEditing({ ...c })}>
                  Edit
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {editing && (
        <div className="edit-panel">
          <h3>Edit: {editing.function.replaceAll("_", " ")}</h3>
          <div className="form-grid">
            <label>
              Provider
              <select
                value={editing.provider}
                onChange={(e) => setEditing({ ...editing, provider: e.target.value, model_name: "" })}
              >
                {LLM_PROVIDERS.map((p) => (
                  <option key={p.value} value={p.value}>
                    {p.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Model
              <ModelSelect
                provider={editing.provider}
                kind="text"
                value={editing.model_name}
                onChange={(id) => setEditing({ ...editing, model_name: id })}
              />
            </label>
            <label>
              Temperature (0–2)
              <input
                type="number"
                step="0.1"
                min="0"
                max="2"
                value={editing.temperature}
                onChange={(e) => setEditing({ ...editing, temperature: Number(e.target.value) })}
              />
            </label>
            <label>
              Max tokens
              <input
                type="number"
                min="1"
                max="64000"
                value={editing.max_tokens}
                onChange={(e) => setEditing({ ...editing, max_tokens: Number(e.target.value) })}
              />
            </label>
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={editing.is_active}
                onChange={(e) => setEditing({ ...editing, is_active: e.target.checked })}
              />
              Active
            </label>
          </div>
          <label>
            Base system prompt
            <TextareaZoom
              label="Base system prompt"
              rows={4}
              value={editing.system_prompt}
              onChange={(v) => setEditing({ ...editing, system_prompt: v })}
            />
          </label>
          <div className="form-actions">
            <button className="btn btn-primary" onClick={save}>
              Save
            </button>
            <button className="btn btn-ghost" onClick={() => setEditing(null)}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
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
    <div className="card">
      <div className="card-header">
        <h2>Image generation models</h2>
        <button className="btn btn-primary" onClick={() => (showForm ? resetForm() : setShowForm(true))}>
          {showForm ? "Cancel" : "+ Add model"}
        </button>
      </div>
      <p className="muted">
        Admin-curated list. Keys come from <strong>Providers &amp; Keys</strong>; model IDs are fetched
        automatically per provider.
      </p>
      {error && <div className="alert alert-error">{error}</div>}

      {showForm && (
        <form className="model-form" onSubmit={submit}>
          <div className="form-grid">
            <label>
              Provider
              <select
                value={form.provider}
                onChange={(e) => setForm({ ...form, provider: e.target.value, model_name: "" })}
              >
                {IMAGE_PROVIDERS.map((p) => (
                  <option key={p.value} value={p.value}>
                    {p.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Model
              <ModelSelect
                provider={form.provider}
                kind="image"
                value={form.model_name}
                onChange={(id) => setForm((f) => ({ ...f, model_name: id }))}
                onModelName={(name) => setForm((f) => (f.display_name ? f : { ...f, display_name: name }))}
              />
            </label>
            <label>
              Display name
              <input
                value={form.display_name}
                onChange={(e) => setForm({ ...form, display_name: e.target.value })}
                required
              />
            </label>
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={form.is_default}
                onChange={(e) => setForm({ ...form, is_default: e.target.checked })}
              />
              Default
            </label>
          </div>
          <div className="form-actions">
            <button className="btn btn-primary" disabled={!form.model_name}>
              {editId ? "Save changes" : "Add"}
            </button>
            <button type="button" className="btn btn-ghost" onClick={resetForm}>
              Cancel
            </button>
          </div>
        </form>
      )}

      <table className="table">
        <thead>
          <tr>
            <th>Name</th>
            <th>Provider</th>
            <th>Model ID</th>
            <th>Default</th>
            <th>Active</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {models.map((m) => (
            <tr key={m.id}>
              <td>{m.display_name}</td>
              <td>{m.provider}</td>
              <td className="mono">{m.model_name}</td>
              <td>
                {m.is_default ? (
                  <span className="tag tag-green">default</span>
                ) : (
                  <button className="btn btn-ghost small" onClick={() => patch(m.id, { is_default: true })}>
                    Make default
                  </button>
                )}
              </td>
              <td>
                <button className="btn btn-ghost small" onClick={() => patch(m.id, { is_active: !m.is_active })}>
                  {m.is_active ? "✓ active" : "✗ inactive"}
                </button>
              </td>
              <td className="row-actions">
                <button className="btn btn-ghost small" onClick={() => startEdit(m)}>
                  Edit
                </button>
                <button className="btn btn-ghost small danger" onClick={() => remove(m.id)}>
                  Delete
                </button>
              </td>
            </tr>
          ))}
          {models.length === 0 && (
            <tr>
              <td colSpan={6} className="muted">
                No image models yet. Add one to enable image generation.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
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
    <div className="card">
      <div className="card-header">
        <h2>Video generation models</h2>
        <button className="btn btn-primary" onClick={() => (showForm ? resetForm() : setShowForm(true))}>
          {showForm ? "Cancel" : "+ Add model"}
        </button>
      </div>
      <p className="muted">
        Admin-curated list. Each provider (Google Veo / OpenAI Sora / fal.ai / Replicate / Magnific) uses its key
        from <strong>Providers &amp; Keys</strong>. Magnific offers a model dropdown. fal.ai and Replicate need the model ID entered manually.
      </p>
      {error && <div className="alert alert-error">{error}</div>}

      {showForm && (
        <form className="model-form" onSubmit={submit}>
          <div className="form-grid">
            <label>
              Provider
              <select
                value={form.provider}
                onChange={(e) => setForm({ ...form, provider: e.target.value, model_name: "" })}
              >
                {VIDEO_PROVIDERS.map((p) => (
                  <option key={p.value} value={p.value}>
                    {p.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Model
              <ModelSelect
                provider={form.provider}
                kind="video"
                value={form.model_name}
                onChange={(id) => setForm((f) => ({ ...f, model_name: id }))}
                onModelName={(name) => setForm((f) => (f.display_name ? f : { ...f, display_name: name }))}
              />
            </label>
            <label>
              Display name
              <input
                value={form.display_name}
                onChange={(e) => setForm({ ...form, display_name: e.target.value })}
                required
              />
            </label>
            <label>
              Max secs
              <input
                type="number"
                min={1}
                max={60}
                value={form.max_duration_seconds}
                onChange={(e) => setForm({ ...form, max_duration_seconds: Number(e.target.value) })}
              />
            </label>
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={form.is_default}
                onChange={(e) => setForm({ ...form, is_default: e.target.checked })}
              />
              Default
            </label>
          </div>
          <div className="form-actions">
            <button className="btn btn-primary" disabled={!form.model_name}>
              {editId ? "Save changes" : "Add"}
            </button>
            <button type="button" className="btn btn-ghost" onClick={resetForm}>
              Cancel
            </button>
          </div>
        </form>
      )}

      <table className="table">
        <thead>
          <tr>
            <th>Name</th>
            <th>Provider</th>
            <th>Model ID</th>
            <th>Max secs</th>
            <th>Default</th>
            <th>Active</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {models.map((m) => (
            <tr key={m.id}>
              <td>{m.display_name}</td>
              <td>{m.provider}</td>
              <td className="mono">{m.model_name}</td>
              <td>{m.max_duration_seconds}</td>
              <td>
                {m.is_default ? (
                  <span className="tag tag-green">default</span>
                ) : (
                  <button className="btn btn-ghost small" onClick={() => patch(m.id, { is_default: true })}>
                    Make default
                  </button>
                )}
              </td>
              <td>
                <button className="btn btn-ghost small" onClick={() => patch(m.id, { is_active: !m.is_active })}>
                  {m.is_active ? "✓ active" : "✗ inactive"}
                </button>
              </td>
              <td className="row-actions">
                <button className="btn btn-ghost small" onClick={() => startEdit(m)}>
                  Edit
                </button>
                <button className="btn btn-ghost small danger" onClick={() => remove(m.id)}>
                  Delete
                </button>
              </td>
            </tr>
          ))}
          {models.length === 0 && (
            <tr>
              <td colSpan={7} className="muted">
                No video models yet. Add one to enable video generation.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

// Controls for settings whose values are constrained to a fixed set of
// options or a type — avoids free-text typing for things that should be picked.
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

// Friendly label + plain-language help for each setting. The label is shown as
// the row title; the raw key is kept as a small mono hint for reference.
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

// Ordered, sensible groupings shown as distinct boxed sub-sections on the
// Global tab. Each group carries an accent colour so they're easy to tell apart.
const SETTING_GROUPS: { title: string; description: string; accent: string; keys: string[] }[] = [
  {
    title: "Language & localization",
    description: "Default languages for the interface and the content the AI produces.",
    accent: "#2563EB", // info blue
    keys: ["default_ui_language", "default_content_language"],
  },
  {
    title: "Interface & developer tools",
    description: "Controls which sections of the UI are visible and which developer tools are exposed.",
    accent: "#7C3AED", // violet
    keys: ["show_article_library", "dev_mode", "show_onboarding_panel"],
  },
  {
    title: "Client onboarding",
    description: "What happens automatically when a new client is created.",
    accent: "#4338CA", // primary indigo
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
    accent: "#0F766E", // tertiary teal
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
    accent: "#D97706", // secondary amber
    keys: ["competitor_crawl_max_depth", "competitor_crawl_max_pages"],
  },
];

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
        <select value={val} onChange={(e) => setEdited({ ...edited, [s.key]: e.target.value })}>
          {SELECT_OPTIONS[s.key].map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      );
    }
    if (BOOLEAN_SETTINGS.has(s.key)) {
      return (
        <label className="checkbox">
          <input
            type="checkbox"
            checked={val === "true"}
            onChange={(e) => setEdited({ ...edited, [s.key]: e.target.checked ? "true" : "false" })}
          />
          <span className="muted small">{val === "true" ? "Enabled" : "Disabled"}</span>
        </label>
      );
    }
    if (NUMBER_SETTINGS.has(s.key)) {
      return (
        <input
          type="number"
          min={0}
          value={val}
          onChange={(e) => setEdited({ ...edited, [s.key]: e.target.value })}
        />
      );
    }
    return <input value={val} onChange={(e) => setEdited({ ...edited, [s.key]: e.target.value })} />;
  }

  function renderRows(items: Setting[]) {
    return items.map((s) => {
      const meta = SETTING_META[s.key];
      return (
        <tr key={s.key}>
          <td>
            <strong>{meta?.label ?? s.key}</strong>
            <div className="muted small mono">{s.key}</div>
            <div className="muted small">{meta?.help ?? s.description}</div>
          </td>
          <td>{renderControl(s)}</td>
        </tr>
      );
    });
  }

  return (
    <div className="card">
      <h2>Global settings</h2>
      {error && <div className="alert alert-error">{error}</div>}
      {notice && <div className="alert alert-success">{notice}</div>}

      {SETTING_GROUPS.map((g) => {
        const items = g.keys.map((k) => byKey.get(k)).filter((s): s is Setting => !!s);
        if (items.length === 0) return null;
        return (
          <div
            key={g.title}
            className="settings-group"
            style={{ ["--group-accent" as string]: g.accent }}
          >
            <div className="settings-group-head">
              <h3>{g.title}</h3>
              <div className="muted small">{g.description}</div>
            </div>
            <table className="table">
              <tbody>{renderRows(items)}</tbody>
            </table>
          </div>
        );
      })}

      {ungrouped.length > 0 && (
        <div className="settings-group" style={{ ["--group-accent" as string]: "#78716C" }}>
          <div className="settings-group-head">
            <h3>Other</h3>
          </div>
          <table className="table">
            <tbody>{renderRows(ungrouped)}</tbody>
          </table>
        </div>
      )}

      <div className="form-actions">
        <button className="btn btn-primary" onClick={save} disabled={Object.keys(edited).length === 0}>
          Save changes
        </button>
      </div>
    </div>
  );
}
