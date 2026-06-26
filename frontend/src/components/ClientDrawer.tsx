import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  AlertTriangle,
  ArrowRight,
  Building2,
  Calendar,
  CheckCircle2,
  Clock,
  ExternalLink,
  FileText,
  Globe,
  Hash,
  Loader2,
  Search,
  Users,
} from "lucide-react";
import { api } from "../api";
import { ClientAvatar } from "./ClientAvatar";
import { ActivityTimeline } from "./ActivityTimeline";
import { OnboardingStepper } from "./OnboardingStepper";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Separator } from "@/components/ui/separator";
import type { AuditLog, Client, OnboardingJob } from "../types";

interface ClientDrawerProps {
  client: Client | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

interface ClientSummary {
  campaigns: number;
  articles: number;
  competitors: number;
  channels: number;
}

export function ClientDrawer({ client, open, onOpenChange }: ClientDrawerProps) {
  const [job, setJob] = useState<OnboardingJob | null>(null);
  const [events, setEvents] = useState<AuditLog[]>([]);
  const [summary, setSummary] = useState<ClientSummary | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!client || !open) return;
    setLoading(true);
    Promise.all([
      api<OnboardingJob | null>(`/clients/${client.id}/onboarding`).catch(() => null),
      api<AuditLog[]>(`/clients/${client.id}/audit-log?limit=20`).catch(() => []),
      loadSummary(client.id),
    ]).then(([j, ev, _]) => {
      setJob(j);
      setEvents(ev);
      setLoading(false);
    });
  }, [client?.id, open]);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-lg overflow-y-auto p-0">
        {client && (
          <div className="p-6 space-y-6">
            <SheetHeader>
              <div className="flex items-start gap-3">
                <ClientAvatar client={client} large />
                <div className="flex-1 min-w-0">
                  <SheetTitle className="text-xl">{client.company_name}</SheetTitle>
                  <SheetDescription className="space-y-1">
                    {client.industry && (
                      <span className="flex items-center gap-1.5">
                        <Building2 className="h-3 w-3" /> {client.industry}
                      </span>
                    )}
                    {client.website_url && (
                      <span className="flex items-center gap-1.5">
                        <Globe className="h-3 w-3" />
                        <a href={client.website_url} target="_blank" rel="noreferrer" className="hover:underline truncate">
                          {client.website_url}
                        </a>
                      </span>
                    )}
                  </SheetDescription>
                </div>
              </div>
              <div className="flex items-center gap-2 mt-3">
                <Button asChild>
                  <Link to={`/clients/${client.id}`}>
                    Open client
                    <ArrowRight className="h-4 w-4" />
                  </Link>
                </Button>
                <Button asChild variant="outline">
                  <Link to={`/clients/${client.id}/setup`}>View setup</Link>
                </Button>
              </div>
            </SheetHeader>

            <Separator />

            {/* Status summary tiles */}
            <div>
              <h3 className="text-sm font-semibold mb-2">Status</h3>
              {loading ? (
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  {Array.from({ length: 4 }).map((_, i) => (
                    <div key={i} className="h-16 rounded-lg bg-muted/40 animate-pulse" />
                  ))}
                </div>
              ) : summary ? (
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  <SummaryTile icon={FileText} label="Campaigns" value={summary.campaigns} to={`/campaigns?client=${client.id}`} />
                  <SummaryTile icon={Hash} label="Competitors" value={summary.competitors} to={`/clients/${client.id}#competitors`} />
                  <SummaryTile icon={FileText} label="Articles" value={summary.articles} to={`/clients/${client.id}#articles`} />
                  <SummaryTile icon={Users} label="Channels" value={summary.channels} to={`/clients/${client.id}#channels`} />
                </div>
              ) : null}
            </div>

            {/* Onboarding status */}
            <div>
              <h3 className="text-sm font-semibold mb-2">Onboarding</h3>
              {loading ? (
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
                  {Array.from({ length: 5 }).map((_, i) => (
                    <div key={i} className="h-14 rounded-lg bg-muted/40 animate-pulse" />
                  ))}
                </div>
              ) : job ? (
                <OnboardingStepper steps={job.steps} jobComplete={job.status === "completed" || job.status === "completed_with_errors"} />
              ) : (
                <div className="rounded-md border border-dashed border-border bg-muted/30 px-3 py-2.5 text-sm text-muted-foreground">
                  No onboarding has run yet for this client.
                </div>
              )}
              {job && (
                <div className="mt-2 flex items-center justify-between gap-2 text-xs text-muted-foreground">
                  <span>
                    {job.steps.filter((s) => s.status === "ok" || s.status === "skipped").length} of {job.steps.length} steps complete
                  </span>
                  <Button variant="ghost" size="sm" asChild>
                    <Link to={`/clients/${client.id}/setup`}>Open setup</Link>
                  </Button>
                </div>
              )}
            </div>

            {/* Activity timeline */}
            <div>
              <h3 className="text-sm font-semibold mb-2">Recent activity</h3>
              {loading ? (
                <div className="space-y-2">
                  {Array.from({ length: 5 }).map((_, i) => (
                    <div key={i} className="h-8 rounded-md bg-muted/40 animate-pulse" />
                  ))}
                </div>
              ) : (
                <ActivityTimeline events={events} emptyText="No activity yet." initialLimit={6} />
              )}
            </div>

            {/* Notes */}
            {client.notes && (
              <div>
                <h3 className="text-sm font-semibold mb-2">Internal notes</h3>
                <p className="rounded-md border border-border bg-muted/20 p-3 text-sm text-muted-foreground whitespace-pre-wrap">
                  {client.notes}
                </p>
              </div>
            )}
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

function SummaryTile({
  icon: Icon,
  label,
  value,
  to,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: number;
  to: string;
}) {
  return (
    <Link
      to={to}
      className="flex items-center gap-2.5 rounded-lg border border-border bg-card px-3 py-2.5 hover:bg-muted/40 transition-colors"
    >
      <Icon className="h-4 w-4 text-muted-foreground shrink-0" />
      <div className="min-w-0">
        <div className="text-lg font-semibold leading-none">{value}</div>
        <div className="text-xs text-muted-foreground truncate">{label}</div>
      </div>
    </Link>
  );
}

async function loadSummary(clientId: string): Promise<ClientSummary> {
  // Fetch counts in parallel. Each endpoint returns a list (or {} for the
  // single-object social-accounts route). We don't need to render errors
  // — fall back to 0 if any single endpoint 404s or fails.
  const [c, a, comp, ch] = await Promise.all([
    api<unknown[]>(`/campaigns?client_id=${clientId}`).catch(() => []),
    api<unknown[]>(`/articles?client_id=${clientId}`).catch(() => []),
    api<unknown[]>(`/clients/${clientId}/competitors`).catch(() => []),
    api<unknown[]>(`/clients/${clientId}/channels`).catch(() => []),
  ]);
  return {
    campaigns: Array.isArray(c) ? c.length : 0,
    articles: Array.isArray(a) ? a.length : 0,
    competitors: Array.isArray(comp) ? comp.length : 0,
    channels: Array.isArray(ch) ? ch.length : 0,
  };
}
