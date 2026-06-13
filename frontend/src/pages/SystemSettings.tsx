import { useEffect, useState } from "react";
import { api } from "../api";
import { ArticleSources } from "../components/ArticleSources";
import type {
  ImageModel,
  LLMConfig,
  ProviderCredential,
  ProviderModel,
  Setting,
  VideoModel,
} from "../types";

type TabKey = "providers" | "llm" | "image" | "video" | "sources" | "global";

const TABS: { key: TabKey; label: string }[] = [
  { key: "providers", label: "Providers & Keys" },
  { key: "llm", label: "LLM Functions" },
  { key: "image", label: "Image Models" },
  { key: "video", label: "Video Models" },
  { key: "sources", label: "Article Sources" },
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
];
const VIDEO_PROVIDERS = [
  { value: "google_veo", label: "Google Veo (Gemini API)" },
  { value: "openai_sora", label: "OpenAI Sora" },
  { value: "fal", label: "fal.ai" },
  { value: "replicate", label: "Replicate" },
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
      {tab === "global" && <GlobalSettingsSection />}
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
            <textarea
              rows={4}
              value={editing.system_prompt}
              onChange={(e) => setEditing({ ...editing, system_prompt: e.target.value })}
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
    if (!window.confirm("Remove this image model from the list?")) return;
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
    if (!window.confirm("Remove this video model from the list?")) return;
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
        Admin-curated list. Each provider (Google Veo / OpenAI Sora / fal.ai / Replicate) uses its key
        from <strong>Providers &amp; Keys</strong>. fal.ai and Replicate need the model ID entered manually.
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

  return (
    <div className="card">
      <h2>Global settings</h2>
      {error && <div className="alert alert-error">{error}</div>}
      {notice && <div className="alert alert-success">{notice}</div>}
      <table className="table">
        <tbody>
          {settings.map((s) => (
            <tr key={s.key}>
              <td>
                <strong>{s.key}</strong>
                <div className="muted small">{s.description}</div>
              </td>
              <td>
                <input
                  value={edited[s.key] ?? s.value}
                  onChange={(e) => setEdited({ ...edited, [s.key]: e.target.value })}
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="form-actions">
        <button className="btn btn-primary" onClick={save} disabled={Object.keys(edited).length === 0}>
          Save changes
        </button>
      </div>
    </div>
  );
}
