import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Loader2, MoreVertical, RefreshCw, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { api } from "../api";
import { useAuth } from "../auth";
import { ClientAvatar } from "./ClientAvatar";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import type { Client, OnboardingJob } from "../types";

type Bucket = "not_started" | "running" | "ready" | "needs_attention";

const COLUMNS: { key: Bucket; label: string; tone: string }[] = [
  { key: "not_started",    label: "Not started",     tone: "border-border bg-muted/20" },
  { key: "running",         label: "Setting up",      tone: "border-primary/30 bg-primary/5" },
  { key: "needs_attention", label: "Needs attention", tone: "border-amber-500/40 bg-amber-500/5" },
  { key: "ready",           label: "Ready",           tone: "border-emerald-500/30 bg-emerald-500/5" },
];

function bucketFor(state: string | undefined): Bucket {
  switch (state) {
    case "running": return "running";
    case "completed": return "ready";
    case "completed_with_errors": return "needs_attention";
    case "failed": return "needs_attention";
    case "not_started": return "not_started";
    default: return "not_started";
  }
}

export function bucketLabel(b: Bucket): string {
  return COLUMNS.find((c) => c.key === b)?.label ?? b;
}

interface ClientsPipelineProps {
  clients: Client[];
  statuses: Record<string, string>;
  onCardClick?: (client: Client) => void;
}

export function ClientsPipeline({ clients, statuses, onCardClick }: ClientsPipelineProps) {
  const { user } = useAuth();
  const canEdit = user?.role === "admin" || user?.role === "editor";
  const navigate = useNavigate();
  const [busy, setBusy] = useState<string | null>(null);

  // Group clients by bucket
  const grouped = new Map<Bucket, Client[]>();
  for (const col of COLUMNS) grouped.set(col.key, []);
  for (const c of clients) {
    const b = bucketFor(statuses[c.id]);
    grouped.get(b)!.push(c);
  }

  async function rerun(client: Client) {
    setBusy(client.id);
    try {
      await api(`/clients/${client.id}/onboard`, { method: "POST" });
      toast.success(`Onboarding re-started for ${client.company_name}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not start onboarding");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
      {COLUMNS.map((col) => {
        const items = grouped.get(col.key)!;
        return (
          <div
            key={col.key}
            className={cn(
              "rounded-xl border p-3 min-h-[200px] flex flex-col gap-2",
              col.tone,
            )}
          >
            <div className="flex items-center justify-between px-1">
              <h3 className="text-sm font-semibold flex items-center gap-2">
                {col.key === "running" && <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />}
                {col.label}
              </h3>
              <Badge variant="outline" className="font-normal text-xs">
                {items.length}
              </Badge>
            </div>
            <div className="flex flex-col gap-2 min-h-0">
              {items.length === 0 ? (
                <p className="text-xs text-muted-foreground px-1 py-3">No clients in this state.</p>
              ) : (
                items.map((c) => {
                  const state = statuses[c.id];
                  const colors = c.brand_colors?.length ? c.brand_colors : null;
                  return (
                    <PipelineCard
                      key={c.id}
                      client={c}
                      state={state}
                      colors={colors}
                      canEdit={canEdit}
                      busy={busy === c.id}
                      onClick={() => (onCardClick ? onCardClick(c) : navigate(`/clients/${c.id}`))}
                      onRerun={() => rerun(c)}
                      onOpen={() => navigate(`/clients/${c.id}`)}
                      onOpenSetup={() => navigate(`/clients/${c.id}/setup`)}
                    />
                  );
                })
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function PipelineCard({
  client,
  state,
  colors,
  canEdit,
  busy,
  onClick,
  onRerun,
  onOpen,
  onOpenSetup,
}: {
  client: Client;
  state: string | undefined;
  colors: string[] | null;
  canEdit: boolean;
  busy: boolean;
  onClick: () => void;
  onRerun: () => void;
  onOpen: () => void;
  onOpenSetup: () => void;
}) {
  return (
    <div
      className="group rounded-lg border border-border bg-card p-3 text-sm transition-shadow hover:shadow-sm cursor-pointer"
      onClick={onClick}
    >
      <div className="flex items-center gap-2.5">
        <div className="shrink-0">
          <ClientAvatar client={client} />
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-medium leading-tight truncate">{client.company_name}</p>
          {client.industry && (
            <p className="text-xs text-muted-foreground truncate">{client.industry}</p>
          )}
        </div>
        {canEdit && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6 opacity-0 group-hover:opacity-100"
                onClick={(e) => e.stopPropagation()}
                aria-label="Open menu"
              >
                <MoreVertical className="h-3.5 w-3.5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
              <DropdownMenuItem onClick={onOpen}>Open client</DropdownMenuItem>
              <DropdownMenuItem onClick={onOpenSetup}>View setup</DropdownMenuItem>
              <DropdownMenuItem disabled={busy} onClick={onRerun}>
                {busy ? (
                  <>
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    Re-running…
                  </>
                ) : (
                  <>
                    <RefreshCw className="h-3.5 w-3.5" />
                    Re-run onboarding
                  </>
                )}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
      <div className="mt-2 flex items-center justify-between gap-2">
        {colors && colors.length > 0 ? (
          <div className="flex items-center gap-0.5">
            {colors.slice(0, 4).map((c, i) => (
              <span key={i} className="h-2 w-2 rounded-full ring-1 ring-border" style={{ background: c }} />
            ))}
          </div>
        ) : (
          <span />
        )}
        <StatusChip state={state} />
      </div>
    </div>
  );
}

function StatusChip({ state }: { state: string | undefined }) {
  switch (state) {
    case "running":
      return <Badge variant="secondary" className="gap-1 font-normal text-[10px] py-0"><Loader2 className="h-3 w-3 animate-spin" />Running</Badge>;
    case "completed":
      return <Badge variant="default" className="font-normal text-[10px] py-0">Ready</Badge>;
    case "completed_with_errors":
      return <Badge variant="destructive" className="font-normal text-[10px] py-0">Incomplete</Badge>;
    case "failed":
      return <Badge variant="destructive" className="font-normal text-[10px] py-0">Failed</Badge>;
    default:
      return <Badge variant="outline" className="font-normal text-[10px] py-0 text-muted-foreground">Not started</Badge>;
  }
}
