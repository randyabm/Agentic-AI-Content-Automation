import { useEffect, useState } from "react";
import { api } from "../api";
import type { ArticleSource } from "../types";

export function ArticleSources() {
  const [sources, setSources] = useState<ArticleSource[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({
    name: "", url: "", frequency: "weekly", max_articles_per_sync: 50, auto_publish: false,
  });
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  async function load() {
    try {
      setSources(await api<ArticleSource[]>("/article-sources"));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load sources");
    }
  }
  useEffect(() => { load(); }, []);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    try {
      await api("/article-sources", { method: "POST", body: form });
      setForm({ name: "", url: "", frequency: "weekly", max_articles_per_sync: 50, auto_publish: false });
      setShowForm(false);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not add source");
    }
  }

  async function patch(id: string, body: Record<string, unknown>) {
    try {
      await api(`/article-sources/${id}`, { method: "PATCH", body });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Update failed");
    }
  }

  async function syncNow(id: string) {
    setNotice("");
    try {
      await api(`/article-sources/${id}/sync`, { method: "POST" });
      setNotice("Sync started — new articles will appear in the library shortly.");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not start sync");
    }
  }

  async function remove(id: string) {
    if (!window.confirm("Delete this auto-sync source? (Imported articles stay in the library.)")) return;
    try {
      await api(`/article-sources/${id}`, { method: "DELETE" });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Delete failed");
    }
  }

  return (
    <div className="card">
      <div className="card-header">
        <h2>Article Library auto-sync</h2>
        <button className="btn btn-primary" onClick={() => setShowForm((v) => !v)}>
          {showForm ? "Cancel" : "+ Add source"}
        </button>
      </div>
      <p className="muted">
        Configure blog/article sections to crawl periodically. New articles are imported
        automatically, or queued for review first (PRD §7.4).
      </p>
      {error && <div className="alert alert-error">{error}</div>}
      {notice && <div className="alert alert-success">{notice}</div>}

      {showForm && (
        <form className="form-inline" onSubmit={create}>
          <label>Name<input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></label>
          <label>Section URL
            <input type="url" placeholder="https://company.com/blog" value={form.url}
              onChange={(e) => setForm({ ...form, url: e.target.value })} required />
          </label>
          <label>Frequency
            <select value={form.frequency} onChange={(e) => setForm({ ...form, frequency: e.target.value })}>
              <option value="daily">Daily</option>
              <option value="weekly">Weekly</option>
              <option value="on_demand">On demand</option>
            </select>
          </label>
          <label>Max / sync
            <input type="number" min={1} max={500} value={form.max_articles_per_sync}
              onChange={(e) => setForm({ ...form, max_articles_per_sync: Number(e.target.value) })} />
          </label>
          <label className="checkbox-label">
            <input type="checkbox" checked={form.auto_publish}
              onChange={(e) => setForm({ ...form, auto_publish: e.target.checked })} />
            Auto-publish
          </label>
          <button className="btn btn-primary">Add</button>
        </form>
      )}

      <table className="table">
        <thead>
          <tr>
            <th>Source</th><th>Frequency</th><th>Publish</th><th>Active</th><th>Last sync</th><th></th>
          </tr>
        </thead>
        <tbody>
          {sources.map((s) => (
            <tr key={s.id}>
              <td>
                <strong>{s.name}</strong>
                <div className="muted small">{s.url}</div>
              </td>
              <td>{s.frequency}</td>
              <td>{s.auto_publish ? "auto" : "review"}</td>
              <td>
                <button className="btn btn-ghost" onClick={() => patch(s.id, { is_active: !s.is_active })}>
                  {s.is_active ? "✓ active" : "✗ inactive"}
                </button>
              </td>
              <td>
                <div className="muted small">
                  {s.last_synced_at ? new Date(s.last_synced_at).toLocaleString() : "never"}
                  {s.last_sync_status && ` · ${s.last_sync_status}`}
                </div>
                {s.last_sync_detail && <div className="muted small">{s.last_sync_detail}</div>}
              </td>
              <td>
                <button className="btn btn-ghost" onClick={() => syncNow(s.id)}
                  disabled={s.last_sync_status === "running"}>
                  {s.last_sync_status === "running" ? "Syncing…" : "Sync now"}
                </button>
                <button className="btn btn-ghost danger" onClick={() => remove(s.id)}>Delete</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
