import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api";
import { useAuth } from "../auth";
import type { Client } from "../types";

export default function Clients() {
  const { user } = useAuth();
  const canEdit = user?.role === "admin" || user?.role === "editor";
  const [clients, setClients] = useState<Client[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api<Client[]>("/clients").then(setClients).catch((e) => setError(e.message));
  }, []);

  async function createClient(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      const client = await api<Client>("/clients", {
        method: "POST",
        body: { company_name: name, website_url: url },
      });
      setClients((prev) => [...prev, client].sort((a, b) => a.company_name.localeCompare(b.company_name)));
      setName("");
      setUrl("");
      setShowForm(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create client");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <div className="page-header">
        <h1>Clients</h1>
        {canEdit && (
          <button className="btn btn-primary" onClick={() => setShowForm((v) => !v)}>
            {showForm ? "Cancel" : "+ New client"}
          </button>
        )}
      </div>

      {showForm && (
        <form className="card form-inline" onSubmit={createClient}>
          <label>
            Company name
            <input value={name} onChange={(e) => setName(e.target.value)} required />
          </label>
          <label>
            Website URL
            <input
              type="url"
              placeholder="https://example.com"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              required
            />
          </label>
          <button className="btn btn-primary" disabled={busy}>
            {busy ? "Creating…" : "Create"}
          </button>
        </form>
      )}

      {error && <div className="alert alert-error">{error}</div>}

      <div className="card-grid">
        {clients.map((c) => (
          <Link key={c.id} to={`/clients/${c.id}`} className="card client-card">
            <h3>{c.company_name}</h3>
            <p className="muted">{c.website_url}</p>
            {c.industry && <span className="tag">{c.industry}</span>}
            <p className="muted small">
              {c.last_extraction_at
                ? `Last analyzed: ${new Date(c.last_extraction_at).toLocaleString()}`
                : "Not analyzed yet"}
            </p>
          </Link>
        ))}
        {clients.length === 0 && !error && (
          <p className="muted">No clients yet. {canEdit ? "Create the first one." : ""}</p>
        )}
      </div>
    </div>
  );
}
