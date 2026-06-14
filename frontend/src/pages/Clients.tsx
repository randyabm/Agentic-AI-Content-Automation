import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api } from "../api";
import { useAuth } from "../auth";
import type { Client } from "../types";

const ONBOARDING_BADGE: Record<string, { label: string; cls: string; spin?: boolean }> = {
  running: { label: "Setting up…", cls: "onboarding-badge running", spin: true },
  completed_with_errors: { label: "Setup incomplete", cls: "onboarding-badge error" },
  failed: { label: "Setup failed", cls: "onboarding-badge error" },
};

export default function Clients() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const canEdit = user?.role === "admin" || user?.role === "editor";
  const [clients, setClients] = useState<Client[]>([]);
  const [statuses, setStatuses] = useState<Record<string, string>>({});
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const pollRef = useRef<number | null>(null);

  useEffect(() => {
    api<Client[]>("/clients").then(setClients).catch((e) => setError(e.message));
  }, []);

  const loadStatuses = useCallback(
    () => api<Record<string, string>>("/clients/onboarding-statuses").then(setStatuses).catch(() => {}),
    [],
  );

  useEffect(() => {
    loadStatuses();
  }, [loadStatuses]);

  // Poll while any client is still onboarding.
  useEffect(() => {
    const anyRunning = Object.values(statuses).some((s) => s === "running");
    if (anyRunning && pollRef.current === null) {
      pollRef.current = window.setInterval(loadStatuses, 3000);
    } else if (!anyRunning && pollRef.current !== null) {
      window.clearInterval(pollRef.current);
      pollRef.current = null;
    }
    return () => {
      if (pollRef.current) {
        window.clearInterval(pollRef.current);
        pollRef.current = null;
      }
    };
  }, [statuses, loadStatuses]);

  async function deleteClient(e: React.MouseEvent, client: Client) {
    e.preventDefault();
    e.stopPropagation();
    if (!window.confirm(`Delete "${client.company_name}"? This removes its profile, competitors and articles.`)) return;
    try {
      await api(`/clients/${client.id}`, { method: "DELETE" });
      setClients((prev) => prev.filter((c) => c.id !== client.id));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not delete client");
    }
  }

  async function createClient(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      const client = await api<Client>("/clients", {
        method: "POST",
        body: { company_name: name, website_url: url },
      });
      setName("");
      setUrl("");
      setShowForm(false);
      // Onboarding runs in the background; the client detail page shows live progress.
      navigate(`/clients/${client.id}`);
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
        {clients.map((c) => {
          const badge = ONBOARDING_BADGE[statuses[c.id]];
          return (
            <Link
              key={c.id}
              to={`/clients/${c.id}`}
              className={`card client-card ${statuses[c.id] === "running" ? "onboarding-running" : ""}`}
            >
              <div className="client-card-top">
                <h3>{c.company_name}</h3>
                {canEdit && (
                  <button
                    className="btn btn-ghost small danger client-delete"
                    title="Delete client"
                    onClick={(e) => deleteClient(e, c)}
                  >
                    ✕
                  </button>
                )}
              </div>
              <p className="muted">{c.website_url}</p>
              <div className="client-card-tags">
                {c.industry && <span className="tag">{c.industry}</span>}
                {badge && (
                  <span className={badge.cls}>
                    {badge.spin && <span className="spinner-inline" />} {badge.label}
                  </span>
                )}
              </div>
              <p className="muted small">
                {c.last_extraction_at
                  ? `Last analyzed: ${new Date(c.last_extraction_at).toLocaleString()}`
                  : "Not analyzed yet"}
              </p>
            </Link>
          );
        })}
        {clients.length === 0 && !error && (
          <p className="muted">No clients yet. {canEdit ? "Create the first one." : ""}</p>
        )}
      </div>
    </div>
  );
}
