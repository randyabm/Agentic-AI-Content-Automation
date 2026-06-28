import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Building2, Clock, Search, Trash2 } from "lucide-react";
import { api } from "../api";
import { useAuth } from "../auth";
import { ClientAvatar } from "../components/ClientAvatar";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type { Client } from "../types";

type DeletionSummary = { campaigns: number; competitors: number; articles: number };

const ONBOARDING_BADGE: Record<string, { label: string; variant: "warning" | "destructive"; spin?: boolean }> = {
  running: { label: "Setting up…", variant: "warning", spin: true },
  completed_with_errors: { label: "Setup incomplete", variant: "destructive" },
  failed: { label: "Setup failed", variant: "destructive" },
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
  const [view, setView] = useState<"list" | "cards">(
    () => (localStorage.getItem("clientsView") as "list" | "cards") || "list",
  );
  useEffect(() => { localStorage.setItem("clientsView", view); }, [view]);
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
      <div className="mb-5 flex items-center justify-between gap-4">
        <h1>Clients</h1>
        {canEdit && (
          <Button variant={showForm ? "ghost" : "default"} onClick={() => setShowForm((v) => !v)}>
            {showForm ? "Cancel" : "+ New client"}
          </Button>
        )}
      </div>

      {showForm && (
        <form onSubmit={createClient} className="mb-4 flex flex-wrap items-end gap-4 rounded-xl border border-border bg-card p-5 shadow-sm">
          <div className="flex-1 min-w-[200px]">
            <label className="mb-0 block text-sm">Company name
              <Input value={name} onChange={(e) => setName(e.target.value)} required />
            </label>
          </div>
          <div className="flex-1 min-w-[200px]">
            <label className="mb-0 block text-sm">Website URL
              <Input
                type="url"
                placeholder="https://example.com"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                required
              />
            </label>
          </div>
          <Button type="submit" disabled={busy}>
            {busy ? "Creating…" : "Create"}
          </Button>
        </form>
      )}

      {error && (
        <div className="mb-4 rounded-lg border-l-4 border-red-600 bg-red-50 p-3 text-sm text-red-700">{error}</div>
      )}

      <div className="mb-4 flex items-center gap-3">
        <div className="relative flex-1">
          <Search size={15} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search clients…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-8"
          />
        </div>
        <span className="text-sm text-muted-foreground">
          {visible.length} client{visible.length !== 1 ? "s" : ""}
        </span>
        <div className="ml-auto inline-flex overflow-hidden rounded-md border border-border">
          <button
            type="button"
            onClick={() => setView("list")}
            className={cn(
              "flex items-center gap-1.5 px-3 py-1.5 text-sm transition-colors",
              view === "list" ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-muted",
            )}
            title="List view"
          >
            <span className="material-symbols-outlined text-base">list</span> List
          </button>
          <button
            type="button"
            onClick={() => setView("cards")}
            className={cn(
              "flex items-center gap-1.5 border-l border-border px-3 py-1.5 text-sm transition-colors",
              view === "cards" ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-muted",
            )}
            title="Card view"
          >
            <span className="material-symbols-outlined text-base">grid_view</span> Cards
          </button>
        </div>
      </div>

      {view === "list" && (
        <div className="overflow-hidden rounded-xl border border-border bg-card">
          <div className="grid grid-cols-[minmax(0,1.6fr)_minmax(0,1.4fr)_140px_120px_40px] gap-3 border-b border-border bg-muted/40 px-4 py-2.5 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
            <div>Client</div>
            <div>Industry</div>
            <div>Brand colors</div>
            <div>Last analyzed</div>
            <div></div>
          </div>
          {visible.map((c) => {
            const badge = ONBOARDING_BADGE[statuses[c.id]];
            const colors = c.brand_colors?.length ? c.brand_colors : null;
            return (
              <div
                key={c.id}
                onClick={() => navigate(`/clients/${c.id}`)}
                className="grid cursor-pointer grid-cols-[minmax(0,1.6fr)_minmax(0,1.4fr)_140px_120px_40px] items-center gap-3 border-b border-border px-4 py-2.5 transition-colors last:border-b-0 hover:bg-muted/40"
              >
                <div className="flex min-w-0 items-center gap-2.5">
                  <ClientAvatar client={c} className="size-7 shrink-0 border border-border" />
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium">{c.company_name}</div>
                    {badge && (
                      <span
                        className={cn(
                          "mt-0.5 inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-semibold",
                          badge.variant === "warning" && "bg-amber-100 text-amber-800",
                          badge.variant === "destructive" && "bg-red-100 text-red-700",
                        )}
                      >
                        {badge.spin && <span className="size-2.5 animate-spin rounded-full border-2 border-current border-t-transparent" />}
                        {badge.label}
                      </span>
                    )}
                  </div>
                </div>
                <div className="truncate text-sm text-muted-foreground">
                  {c.industry ? (
                    <span className="flex items-center gap-1.5">
                      <Building2 size={12} className="shrink-0" /> {c.industry}
                    </span>
                  ) : (
                    "—"
                  )}
                </div>
                <div className="flex flex-wrap items-center gap-1">
                  {colors ? (
                    colors.slice(0, 5).map((col, i) => (
                      <span
                        key={i}
                        className="inline-block size-3.5 rounded-full border border-black/10 shadow-sm"
                        style={{ background: col }}
                        title={col}
                      />
                    ))
                  ) : (
                    <span className="text-xs text-muted-foreground/50">—</span>
                  )}
                </div>
                <div className="flex items-center gap-1 text-xs text-muted-foreground">
                  <Clock size={11} />
                  {c.last_extraction_at
                    ? new Date(c.last_extraction_at).toLocaleDateString()
                    : "Not analyzed yet"}
                </div>
                {canEdit ? (
                  <button
                    className="flex items-center justify-center rounded-md p-1 text-muted-foreground/60 transition-colors hover:bg-muted hover:text-destructive"
                    onClick={(e) => openDeleteDialog(e, c)}
                    title="Delete client"
                    aria-label="Delete client"
                  >
                    <Trash2 size={14} />
                  </button>
                ) : (
                  <div />
                )}
              </div>
            );
          })}
          {visible.length === 0 && clients.length > 0 && (
            <p className="px-4 py-6 text-sm text-muted-foreground">No clients match your search.</p>
          )}
          {clients.length === 0 && !error && (
            <p className="px-4 py-6 text-sm text-muted-foreground">No clients yet. {canEdit ? "Create the first one." : ""}</p>
          )}
        </div>
      )}

      {view === "cards" && (
      <div className="grid grid-cols-[repeat(auto-fill,minmax(280px,1fr))] gap-4">
        {visible.map((c) => {
          const badge = ONBOARDING_BADGE[statuses[c.id]];
          const colors = c.brand_colors?.length ? c.brand_colors : null;
          return (
            <div
              key={c.id}
              className={cn(
                "group relative block overflow-hidden rounded-xl border border-border bg-card text-inherit transition-all hover:-translate-y-0.5 hover:border-primary hover:shadow-md",
                statuses[c.id] === "running" && "ring-2 ring-amber-400/30",
              )}
            >
              <div
                className="h-[52px] flex-shrink-0 bg-gradient-to-br from-primary to-indigo-400"
                style={
                  colors
                    ? { background: `linear-gradient(135deg, ${colors.slice(0, 3).join(", ")})` }
                    : undefined
                }
              />

              <Link to={`/clients/${c.id}`} className="flex flex-1 flex-col px-4 pb-4 text-inherit no-underline">
                <div className="-mt-[22px] mb-1.5">
                  <ClientAvatar client={c} className="border-2 border-surface shadow-sm" />
                </div>

                <div className="flex flex-col">
                  <h3 className="mb-1">{c.company_name}</h3>

                  {c.industry && (
                    <div className="mb-2 flex items-center gap-1 text-xs text-muted-foreground">
                      <Building2 size={12} />
                      <span>{c.industry}</span>
                    </div>
                  )}

                  {badge && (
                    <span
                      className={cn(
                        "mb-1.5 inline-flex w-fit items-center gap-1.5 rounded-md px-2 py-0.5 text-xs font-semibold",
                        badge.variant === "warning" && "bg-amber-100 text-amber-800",
                        badge.variant === "destructive" && "bg-red-100 text-red-700",
                      )}
                    >
                      {badge.spin && <span className="size-3 animate-spin rounded-full border-2 border-current border-t-transparent" />}
                      {badge.label}
                    </span>
                  )}

                  {colors && (
                    <div className="mb-1.5 flex flex-wrap gap-1">
                      {colors.slice(0, 5).map((col, i) => (
                        <span
                          key={i}
                          className="inline-block size-3 rounded-full border border-black/10 shadow-sm"
                          style={{ background: col }}
                          title={col}
                        />
                      ))}
                    </div>
                  )}

                  <p className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
                    <Clock size={11} />
                    {c.last_extraction_at
                      ? new Date(c.last_extraction_at).toLocaleDateString()
                      : "Not analyzed yet"}
                  </p>
                </div>
              </Link>

              {canEdit && (
                <Button
                  variant="ghost"
                  size="icon"
                  title="Delete client"
                  onClick={(e) => openDeleteDialog(e, c)}
                  aria-label="Delete client"
                  className="absolute right-2 top-2 size-7 opacity-0 transition-opacity group-hover:opacity-100"
                >
                  <Trash2 size={14} />
                </Button>
              )}
            </div>
          );
        })}
        {visible.length === 0 && clients.length > 0 && (
          <p className="col-span-full text-sm text-muted-foreground">No clients match your search.</p>
        )}
        {clients.length === 0 && !error && (
          <p className="col-span-full text-sm text-muted-foreground">No clients yet. {canEdit ? "Create the first one." : ""}</p>
        )}
      </div>
      )}

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
          <p className="text-sm text-muted-foreground">
            This permanently deletes the client and everything associated with it.
            This cannot be undone.
          </p>
          {deleteSummary ? (
            <ul className="my-3 list-disc pl-5 text-sm">
              {deleteSummary.campaigns > 0 && <li>{deleteSummary.campaigns} campaign{deleteSummary.campaigns !== 1 ? "s" : ""}</li>}
              {deleteSummary.competitors > 0 && <li>{deleteSummary.competitors} competitor{deleteSummary.competitors !== 1 ? "s" : ""}</li>}
              {deleteSummary.articles > 0 && <li>{deleteSummary.articles} article{deleteSummary.articles !== 1 ? "s" : ""}</li>}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">Calculating associated records…</p>
          )}
          <p className="text-sm text-muted-foreground">This action cannot be undone.</p>
        </ConfirmDialog>
      )}
    </div>
  );
}
