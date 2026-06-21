import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Building2, Clock, Search, Trash2 } from "lucide-react";
import { api } from "../api";
import { useAuth } from "../auth";
import { ClientAvatar } from "../components/ClientAvatar";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { Client } from "../types";

type DeletionSummary = { campaigns: number; competitors: number; articles: number };

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
  const [search, setSearch] = useState("");
  const [pendingDelete, setPendingDelete] = useState<Client | null>(null);
  const [deleteSummary, setDeleteSummary] = useState<DeletionSummary | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
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

  function openDeleteDialog(e: React.MouseEvent, client: Client) {
    e.preventDefault();
    e.stopPropagation();
    setError("");
    setPendingDelete(client);
    setDeleteSummary(null);
    // Fetch concrete counts to show in the warning (best-effort).
    api<DeletionSummary>(`/clients/${client.id}/deletion-summary`)
      .then(setDeleteSummary)
      .catch(() => setDeleteSummary(null));
  }

  async function confirmDelete() {
    if (!pendingDelete) return;
    setDeleteBusy(true);
    try {
      await api(`/clients/${pendingDelete.id}`, { method: "DELETE" });
      setClients((prev) => prev.filter((c) => c.id !== pendingDelete.id));
      setPendingDelete(null);
      setDeleteSummary(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not delete client");
    } finally {
      setDeleteBusy(false);
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

  const visible = search.trim()
    ? clients.filter((c) => c.company_name.toLowerCase().includes(search.toLowerCase()))
    : clients;

  return (
    <div>
      <div className="page-header">
        <h1>Clients</h1>
        {canEdit && (
          <Button variant={showForm ? "ghost" : "default"} onClick={() => setShowForm((v) => !v)}>
            {showForm ? "Cancel" : "+ New client"}
          </Button>
        )}
      </div>

      {showForm && (
        <form className="card form-inline" onSubmit={createClient}>
          <label>
            Company name
            <Input value={name} onChange={(e) => setName(e.target.value)} required />
          </label>
          <label>
            Website URL
            <Input
              type="url"
              placeholder="https://example.com"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              required
            />
          </label>
          <Button type="submit" disabled={busy}>
            {busy ? "Creating…" : "Create"}
          </Button>
        </form>
      )}

      {error && <div className="alert alert-error">{error}</div>}

      {/* Search bar */}
      <div className="client-filter-bar">
        <div className="client-filter-search">
          <Search size={15} className="client-search-icon" />
          <Input
            placeholder="Search clients…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ margin: 0, paddingLeft: "2rem" }}
          />
        </div>
        <span className="muted small" style={{ marginLeft: "auto" }}>
          {visible.length} client{visible.length !== 1 ? "s" : ""}
        </span>
      </div>

      <div className="card-grid">
        {visible.map((c) => {
          const badge = ONBOARDING_BADGE[statuses[c.id]];
          const colors = c.brand_colors?.length ? c.brand_colors : null;
          return (
            <div
              key={c.id}
              className={`card client-card client-card-v2 ${statuses[c.id] === "running" ? "onboarding-running" : ""}`}
            >
              {/* Brand color banner */}
              <div
                className="client-card-banner"
                style={
                  colors
                    ? {
                        background: `linear-gradient(135deg, ${colors.slice(0, 3).join(", ")})`,
                      }
                    : undefined
                }
              />

              <Link to={`/clients/${c.id}`} className="client-card-body">
                {/* Avatar overlapping the banner */}
                <div className="client-card-avatar-wrap">
                  <ClientAvatar client={c} />
                </div>

                <div className="client-card-content">
                  <div className="client-card-name-row">
                    <h3 className="client-card-name">{c.company_name}</h3>
                  </div>

                  {c.industry && (
                    <div className="client-card-industry">
                      <Building2 size={12} />
                      <span>{c.industry}</span>
                    </div>
                  )}

                  {badge && (
                    <span className={badge.cls} style={{ marginBottom: "0.4rem" }}>
                      {badge.spin && <span className="spinner-inline" />} {badge.label}
                    </span>
                  )}

                  {colors && (
                    <div className="client-card-colors">
                      {colors.slice(0, 5).map((col, i) => (
                        <span
                          key={i}
                          className="client-color-dot"
                          style={{ background: col }}
                          title={col}
                        />
                      ))}
                    </div>
                  )}

                  <p className="client-card-date">
                    <Clock size={11} />
                    {c.last_extraction_at
                      ? new Date(c.last_extraction_at).toLocaleDateString()
                      : "Not analyzed yet"}
                  </p>
                </div>
              </Link>

              {canEdit && (
                <button
                  className="client-card-delete-v2"
                  title="Delete client"
                  onClick={(e) => openDeleteDialog(e, c)}
                  aria-label="Delete client"
                >
                  <Trash2 size={14} />
                </button>
              )}
            </div>
          );
        })}
        {visible.length === 0 && clients.length > 0 && (
          <p className="muted">No clients match your search.</p>
        )}
        {clients.length === 0 && !error && (
          <p className="muted">No clients yet. {canEdit ? "Create the first one." : ""}</p>
        )}
      </div>

      {pendingDelete && (
        <ConfirmDialog
          title={`Delete "${pendingDelete.company_name}"?`}
          confirmWord="delete"
          confirmLabel="Delete client"
          busy={deleteBusy}
          onConfirm={confirmDelete}
          onCancel={() => {
            setPendingDelete(null);
            setDeleteSummary(null);
          }}
        >
          <p className="muted">
            This permanently deletes the client and everything associated with it.
            This cannot be undone.
          </p>
          {deleteSummary ? (
            <ul className="deletion-summary-list">
              {deleteSummary.campaigns > 0 && <li>{deleteSummary.campaigns} campaign{deleteSummary.campaigns !== 1 ? "s" : ""}</li>}
              {deleteSummary.competitors > 0 && <li>{deleteSummary.competitors} competitor{deleteSummary.competitors !== 1 ? "s" : ""}</li>}
              {deleteSummary.articles > 0 && <li>{deleteSummary.articles} article{deleteSummary.articles !== 1 ? "s" : ""}</li>}
            </ul>
          ) : (
            <p className="muted small">Calculating associated records…</p>
          )}
          <p className="muted small">This action cannot be undone.</p>
        </ConfirmDialog>
      )}
    </div>
  );
}
