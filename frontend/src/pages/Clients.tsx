import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Plus, Search, Building2, AlertCircle, Trash2, Inbox } from "lucide-react";
import { toast } from "sonner";
import { api } from "../api";
import { useAuth } from "../auth";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { ClientCard, type OnboardingState } from "../components/ClientCard";
import { ClientAvatar } from "../components/ClientAvatar";
import { ClientsPipeline } from "../components/ClientsPipeline";
import { ClientDrawer } from "../components/ClientDrawer";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Tabs,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";
import type { Client } from "../types";

type DeletionSummary = { campaigns: number; competitors: number; articles: number };

type StatusFilter = "all" | "running" | "ready" | "needs_attention" | "not_started";
type ViewMode = "cards" | "list" | "pipeline";

function onboardingBucket(state: string | undefined): StatusFilter {
  switch (state) {
    case "running": return "running";
    case "completed": return "ready";
    case "completed_with_errors":
    case "failed": return "needs_attention";
    case "not_started": return "not_started";
    default: return "all";
  }
}

export default function Clients() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const canEdit = user?.role === "admin" || user?.role === "editor";
  const [clients, setClients] = useState<Client[]>([]);
  const [statuses, setStatuses] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [view, setView] = useState<ViewMode>("cards");
  const [drawerClient, setDrawerClient] = useState<Client | null>(null);
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
      toast.success(`Deleted ${pendingDelete.company_name}`);
      setPendingDelete(null);
      setDeleteSummary(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not delete client");
    } finally {
      setDeleteBusy(false);
    }
  }

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return clients.filter((c) => {
      if (q && !c.company_name.toLowerCase().includes(q)) return false;
      if (statusFilter !== "all" && onboardingBucket(statuses[c.id]) !== statusFilter) return false;
      return true;
    });
  }, [clients, search, statusFilter, statuses]);

  const counts = useMemo(() => {
    const all: Record<StatusFilter, number> = {
      all: clients.length, running: 0, ready: 0, needs_attention: 0, not_started: 0,
    };
    for (const c of clients) {
      const bucket = onboardingBucket(statuses[c.id]);
      if (bucket in all) all[bucket]++;
    }
    return all;
  }, [clients, statuses]);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Clients</h1>
          <p className="text-sm text-muted-foreground">
            {visible.length} of {clients.length} client{clients.length !== 1 ? "s" : ""}
            {statusFilter !== "all" && ` · filtered by status`}
          </p>
        </div>
        {canEdit && (
          <Button asChild>
            <Link to="/clients/new">
              <Plus className="h-4 w-4" />
              New client
            </Link>
          </Button>
        )}
      </div>

      {error && (
        <div role="alert" className="flex items-start gap-2 rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Filter bar */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[12rem] max-w-xs">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search clients…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-8"
          />
        </div>
        <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as StatusFilter)}>
          <SelectTrigger className="w-[14rem]">
            <SelectValue placeholder="All statuses" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses ({counts.all})</SelectItem>
            <SelectItem value="running">Setting up ({counts.running})</SelectItem>
            <SelectItem value="ready">Ready ({counts.ready})</SelectItem>
            <SelectItem value="needs_attention">Needs attention ({counts.needs_attention})</SelectItem>
            <SelectItem value="not_started">Not started ({counts.not_started})</SelectItem>
          </SelectContent>
        </Select>

        <Tabs value={view} onValueChange={(v) => setView(v as ViewMode)} className="ml-auto">
          <TabsList>
            <TabsTrigger value="cards">Cards</TabsTrigger>
            <TabsTrigger value="list">List</TabsTrigger>
            <TabsTrigger value="pipeline">Pipeline</TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      {/* View */}
      {clients.length === 0 ? (
        <EmptyState
          canEdit={canEdit}
          title="No clients yet"
          description="Create your first client to start the onboarding pipeline."
        />
      ) : visible.length === 0 ? (
        <EmptyState
          canEdit={false}
          title="No matches"
          description="Try a different search or status filter."
        />
      ) : view === "cards" ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {visible.map((c) => (
            <ClientCard
              key={c.id}
              client={c}
              onboardingState={statuses[c.id] as OnboardingState | undefined}
              canEdit={canEdit}
              onDelete={(e) => openDeleteDialog(e, c)}
              onClick={() => setDrawerClient(c)}
            />
          ))}
        </div>
      ) : view === "pipeline" ? (
        <ClientsPipeline
          clients={visible}
          statuses={statuses}
          onCardClick={(c) => setDrawerClient(c)}
        />
      ) : (
        <div className="rounded-xl border border-border bg-card shadow-sm overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Industry</TableHead>
                <TableHead>Onboarding</TableHead>
                <TableHead>Last analyzed</TableHead>
                <TableHead className="w-12" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {visible.map((c) => (
                <TableRow
                  key={c.id}
                  className="cursor-pointer"
                  onClick={() => navigate(`/clients/${c.id}`)}
                >
                  <TableCell>
                    <div className="flex items-center gap-2.5">
                      <div className="shrink-0">
                        <ClientAvatar client={c} />
                      </div>
                      <span className="font-medium">{c.company_name}</span>
                    </div>
                  </TableCell>
                  <TableCell>
                    {c.industry ? (
                      <span className="inline-flex items-center gap-1.5 text-sm text-muted-foreground">
                        <Building2 className="h-3 w-3" />
                        {c.industry}
                      </span>
                    ) : (
                      <span className="text-muted-foreground/60">—</span>
                    )}
                  </TableCell>
                  <TableCell>
                    <OnboardingBadgeLite state={statuses[c.id]} />
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {c.last_extraction_at
                      ? new Date(c.last_extraction_at).toLocaleDateString()
                      : "—"}
                  </TableCell>
                  <TableCell>
                    {canEdit && (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7"
                        onClick={(e) => openDeleteDialog(e, c)}
                        aria-label={`Delete ${c.company_name}`}
                      >
                        <Trash2 className="h-3.5 w-3.5 text-destructive" />
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <ClientDrawer
        client={drawerClient}
        open={!!drawerClient}
        onOpenChange={(o) => !o && setDrawerClient(null)}
      />

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
          </p>
          {deleteSummary ? (
            <ul className="space-y-1 rounded-md border border-border bg-muted/30 p-3 text-sm">
              {deleteSummary.campaigns > 0 && <li>{deleteSummary.campaigns} campaign{deleteSummary.campaigns !== 1 ? "s" : ""}</li>}
              {deleteSummary.competitors > 0 && <li>{deleteSummary.competitors} competitor{deleteSummary.competitors !== 1 ? "s" : ""}</li>}
              {deleteSummary.articles > 0 && <li>{deleteSummary.articles} article{deleteSummary.articles !== 1 ? "s" : ""}</li>}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">Calculating associated records…</p>
          )}
          <p className="text-sm font-medium text-destructive">This action cannot be undone.</p>
        </ConfirmDialog>
      )}
    </div>
  );
}

function OnboardingBadgeLite({ state }: { state: string | undefined }) {
  // Mirror the ClientCard's OnboardingBadge but with the same variants.
  switch (state) {
    case "running":
      return <Badge variant="secondary" className="gap-1.5 font-normal"><span className="h-1.5 w-1.5 rounded-full bg-current animate-pulse" />Setting up…</Badge>;
    case "completed":
      return <Badge variant="default" className="font-normal">Ready</Badge>;
    case "completed_with_errors":
      return <Badge variant="destructive" className="font-normal">Setup incomplete</Badge>;
    case "failed":
      return <Badge variant="destructive" className="font-normal">Setup failed</Badge>;
    default:
      return <Badge variant="outline" className="font-normal text-muted-foreground">Not started</Badge>;
  }
}

function EmptyState({
  canEdit,
  title,
  description,
}: {
  canEdit: boolean;
  title: string;
  description: string;
}) {
  return (
    <div className={cn(
      "rounded-xl border border-dashed border-border bg-card/50 px-6 py-12 text-center",
    )}>
      <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
        <Inbox className="h-5 w-5" />
      </div>
      <h3 className="mt-4 text-base font-semibold">{title}</h3>
      <p className="mt-1 text-sm text-muted-foreground">{description}</p>
      {canEdit && (
        <Button className="mt-4" asChild>
          <Link to="/clients/new">
            <Plus className="h-4 w-4" />
            New client
          </Link>
        </Button>
      )}
    </div>
  );
}
