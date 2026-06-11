import { useEffect, useState } from "react";
import { api } from "../api";
import { ArticleSources } from "../components/ArticleSources";
import type { ImageModel, LLMConfig, Setting, VideoModel } from "../types";

export default function SystemSettings() {
  return (
    <div>
      <div className="page-header">
        <h1>System Settings</h1>
      </div>
      <LLMConfigSection />
      <ImageModelSection />
      <VideoModelSection />
      <ArticleSources />
      <GlobalSettingsSection />
    </div>
  );
}

function LLMConfigSection() {
  const [configs, setConfigs] = useState<LLMConfig[]>([]);
  const [editing, setEditing] = useState<LLMConfig | null>(null);
  const [apiKey, setApiKey] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    api<LLMConfig[]>("/llm-configs").then(setConfigs).catch((e) => setError(e.message));
  }, []);

  async function save() {
    if (!editing) return;
    setError("");
    try {
      const body: Record<string, unknown> = {
        provider: editing.provider,
        model_name: editing.model_name,
        temperature: editing.temperature,
        max_tokens: editing.max_tokens,
        system_prompt: editing.system_prompt,
        is_active: editing.is_active,
      };
      if (apiKey) body.api_key = apiKey;
      const updated = await api<LLMConfig>(`/llm-configs/${editing.id}`, { method: "PATCH", body });
      setConfigs((prev) => prev.map((c) => (c.id === updated.id ? updated : c)));
      setEditing(null);
      setApiKey("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    }
  }

  return (
    <div className="card">
      <h2>LLM functions</h2>
      <p className="muted">A different model can be configured per function (PRD §9.1).</p>
      {error && <div className="alert alert-error">{error}</div>}
      <table className="table">
        <thead>
          <tr>
            <th>Function</th>
            <th>Provider</th>
            <th>Model</th>
            <th>API key</th>
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
              <td>{c.model_name}</td>
              <td className="mono">{c.api_key_hint || <span className="tag tag-red">missing</span>}</td>
              <td>{c.temperature}</td>
              <td>{c.is_active ? "✓" : "✗"}</td>
              <td>
                <button className="btn btn-ghost" onClick={() => { setEditing({ ...c }); setApiKey(""); }}>
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
              <select value={editing.provider} onChange={(e) => setEditing({ ...editing, provider: e.target.value })}>
                <option value="anthropic">Anthropic</option>
                <option value="openai">OpenAI</option>
                <option value="openrouter">OpenRouter</option>
              </select>
            </label>
            <label>
              Model name
              <input value={editing.model_name} onChange={(e) => setEditing({ ...editing, model_name: e.target.value })} />
            </label>
            <label>
              API key (leave blank to keep current)
              <input type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder={editing.api_key_hint} />
            </label>
            <label>
              Temperature (0–2)
              <input type="number" step="0.1" min="0" max="2" value={editing.temperature}
                onChange={(e) => setEditing({ ...editing, temperature: Number(e.target.value) })} />
            </label>
            <label>
              Max tokens
              <input type="number" min="1" max="64000" value={editing.max_tokens}
                onChange={(e) => setEditing({ ...editing, max_tokens: Number(e.target.value) })} />
            </label>
            <label className="checkbox-label">
              <input type="checkbox" checked={editing.is_active}
                onChange={(e) => setEditing({ ...editing, is_active: e.target.checked })} />
              Active
            </label>
          </div>
          <label>
            Base system prompt
            <textarea rows={4} value={editing.system_prompt}
              onChange={(e) => setEditing({ ...editing, system_prompt: e.target.value })} />
          </label>
          <div className="form-actions">
            <button className="btn btn-primary" onClick={save}>Save</button>
            <button className="btn btn-ghost" onClick={() => setEditing(null)}>Cancel</button>
          </div>
        </div>
      )}
    </div>
  );
}

function ImageModelSection() {
  const [models, setModels] = useState<ImageModel[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({
    display_name: "",
    provider: "openrouter",
    model_name: "",
    api_key: "",
    is_default: false,
  });
  const [error, setError] = useState("");

  useEffect(() => {
    api<ImageModel[]>("/image-models").then(setModels).catch((e) => setError(e.message));
  }, []);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    try {
      const created = await api<ImageModel>("/image-models", {
        method: "POST",
        body: { ...form, api_key: form.api_key || undefined },
      });
      setModels((prev) =>
        [...prev.map((m) => (created.is_default ? { ...m, is_default: false } : m)), created],
      );
      setForm({ display_name: "", provider: "openrouter", model_name: "", api_key: "", is_default: false });
      setShowForm(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not add model");
    }
  }

  async function patch(id: string, body: Record<string, unknown>) {
    setError("");
    try {
      const updated = await api<ImageModel>(`/image-models/${id}`, { method: "PATCH", body });
      setModels((prev) =>
        prev.map((m) => (m.id === id ? updated : updated.is_default ? { ...m, is_default: false } : m)),
      );
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

  function setKey(id: string) {
    const key = window.prompt("Paste the API key for this image model (stored encrypted):");
    if (key) patch(id, { api_key: key });
  }

  return (
    <div className="card">
      <div className="card-header">
        <h2>Image generation models</h2>
        <button className="btn btn-primary" onClick={() => setShowForm((v) => !v)}>
          {showForm ? "Cancel" : "+ Add model"}
        </button>
      </div>
      <p className="muted">
        Admin-curated list. Users will choose one of these models when generating campaign images.
      </p>
      {error && <div className="alert alert-error">{error}</div>}

      {showForm && (
        <form className="form-inline" onSubmit={create}>
          <label>
            Display name
            <input value={form.display_name} onChange={(e) => setForm({ ...form, display_name: e.target.value })} required />
          </label>
          <label>
            Provider
            <select value={form.provider} onChange={(e) => setForm({ ...form, provider: e.target.value })}>
              <option value="openrouter">OpenRouter</option>
              <option value="openai">OpenAI</option>
            </select>
          </label>
          <label>
            Model ID
            <input
              placeholder={form.provider === "openai" ? "gpt-image-1" : "google/gemini-2.5-flash-image"}
              value={form.model_name}
              onChange={(e) => setForm({ ...form, model_name: e.target.value })} required />
          </label>
          <label>
            API key (optional, uses provider default)
            <input type="password" value={form.api_key} onChange={(e) => setForm({ ...form, api_key: e.target.value })} />
          </label>
          <label className="checkbox-label">
            <input type="checkbox" checked={form.is_default}
              onChange={(e) => setForm({ ...form, is_default: e.target.checked })} />
            Default
          </label>
          <button className="btn btn-primary">Add</button>
        </form>
      )}

      <table className="table">
        <thead>
          <tr>
            <th>Name</th>
            <th>Provider</th>
            <th>Model ID</th>
            <th>API key</th>
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
                {m.api_key_hint ? (
                  <span className="mono">{m.api_key_hint}</span>
                ) : (
                  <span className="tag tag-red">missing</span>
                )}{" "}
                <button className="btn btn-ghost" onClick={() => setKey(m.id)}>Set</button>
              </td>
              <td>
                {m.is_default ? (
                  <span className="tag tag-green">default</span>
                ) : (
                  <button className="btn btn-ghost" onClick={() => patch(m.id, { is_default: true })}>
                    Make default
                  </button>
                )}
              </td>
              <td>
                <button className="btn btn-ghost" onClick={() => patch(m.id, { is_active: !m.is_active })}>
                  {m.is_active ? "✓ active" : "✗ inactive"}
                </button>
              </td>
              <td>
                <button className="btn btn-ghost danger" onClick={() => remove(m.id)}>
                  Delete
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function VideoModelSection() {
  const [models, setModels] = useState<VideoModel[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({
    display_name: "",
    provider: "google_veo",
    model_name: "",
    api_key: "",
    max_duration_seconds: 8,
    is_default: false,
  });
  const [error, setError] = useState("");

  useEffect(() => {
    api<VideoModel[]>("/video-models").then(setModels).catch((e) => setError(e.message));
  }, []);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    try {
      const created = await api<VideoModel>("/video-models", {
        method: "POST",
        body: { ...form, api_key: form.api_key || undefined },
      });
      setModels((prev) =>
        [...prev.map((m) => (created.is_default ? { ...m, is_default: false } : m)), created],
      );
      setForm({ display_name: "", provider: "google_veo", model_name: "", api_key: "", max_duration_seconds: 8, is_default: false });
      setShowForm(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not add model");
    }
  }

  async function patch(id: string, body: Record<string, unknown>) {
    setError("");
    try {
      const updated = await api<VideoModel>(`/video-models/${id}`, { method: "PATCH", body });
      setModels((prev) =>
        prev.map((m) => (m.id === id ? updated : updated.is_default ? { ...m, is_default: false } : m)),
      );
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

  function setKey(id: string) {
    const key = window.prompt("Paste the API key for this video model (stored encrypted):");
    if (key) patch(id, { api_key: key });
  }

  return (
    <div className="card">
      <div className="card-header">
        <h2>Video generation models</h2>
        <button className="btn btn-primary" onClick={() => setShowForm((v) => !v)}>
          {showForm ? "Cancel" : "+ Add model"}
        </button>
      </div>
      <p className="muted">
        Admin-curated list. OpenRouter does not offer video, so each model targets its own provider
        (Google Veo / OpenAI Sora / fal.ai / Replicate) with its own API key.
      </p>
      {error && <div className="alert alert-error">{error}</div>}

      {showForm && (
        <form className="form-inline" onSubmit={create}>
          <label>
            Display name
            <input value={form.display_name} onChange={(e) => setForm({ ...form, display_name: e.target.value })} required />
          </label>
          <label>
            Provider
            <select value={form.provider} onChange={(e) => setForm({ ...form, provider: e.target.value })}>
              <option value="google_veo">Google Veo (Gemini API)</option>
              <option value="openai_sora">OpenAI Sora</option>
              <option value="fal">fal.ai</option>
              <option value="replicate">Replicate</option>
            </select>
          </label>
          <label>
            Model ID
            <input placeholder="veo-3.1-fast-generate-preview" value={form.model_name}
              onChange={(e) => setForm({ ...form, model_name: e.target.value })} required />
          </label>
          <label>
            API key
            <input type="password" value={form.api_key} onChange={(e) => setForm({ ...form, api_key: e.target.value })} />
          </label>
          <label>
            Max secs
            <input type="number" min={1} max={60} value={form.max_duration_seconds}
              onChange={(e) => setForm({ ...form, max_duration_seconds: Number(e.target.value) })} />
          </label>
          <label className="checkbox-label">
            <input type="checkbox" checked={form.is_default}
              onChange={(e) => setForm({ ...form, is_default: e.target.checked })} />
            Default
          </label>
          <button className="btn btn-primary">Add</button>
        </form>
      )}

      <table className="table">
        <thead>
          <tr>
            <th>Name</th>
            <th>Provider</th>
            <th>Model ID</th>
            <th>API key</th>
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
                {m.api_key_hint ? (
                  <span className="mono">{m.api_key_hint}</span>
                ) : (
                  <span className="tag tag-red">missing</span>
                )}{" "}
                <button className="btn btn-ghost" onClick={() => setKey(m.id)}>Set</button>
              </td>
              <td>
                {m.is_default ? (
                  <span className="tag tag-green">default</span>
                ) : (
                  <button className="btn btn-ghost" onClick={() => patch(m.id, { is_default: true })}>
                    Make default
                  </button>
                )}
              </td>
              <td>
                <button className="btn btn-ghost" onClick={() => patch(m.id, { is_active: !m.is_active })}>
                  {m.is_active ? "✓ active" : "✗ inactive"}
                </button>
              </td>
              <td>
                <button className="btn btn-ghost danger" onClick={() => remove(m.id)}>Delete</button>
              </td>
            </tr>
          ))}
          {models.length === 0 && (
            <tr><td colSpan={7} className="muted">No video models yet. Add one to enable video generation.</td></tr>
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
