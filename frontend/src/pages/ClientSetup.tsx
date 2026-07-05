import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  ChevronRight,
  CircleDashed,
  Loader2,
  Play,
  RotateCcw,
  Sparkles,
  Timer,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";
import { api } from "../api";
import { useAuth } from "../auth";
import { OnboardingStepper } from "../components/OnboardingStepper";
import { ActivityTimeline } from "../components/ActivityTimeline";
import { Button } from "@/components/ui/button";
import { Breadcrumb } from "@/components/ui/breadcrumb";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type { AuditLog, OnboardingJob, OnboardingStep, OnboardingStepStatus } from "../types";

const STEP_DESCRIPTION: Record<string, string> = {
  profile: "Crawls the website and uses AI to infer the company profile (industry, audience, products, tone).",
  branding: "Looks for the logo and profile photo on the site, and extracts a brand color palette.",
  brand_memory: "Builds a persistent context the editorial and visual agents reference for every campaign.",
  competitors: "Identifies 3–5 main competitors and pulls their positioning.",
  articles: "Discovers the company blog and indexes the last ~50 posts.",
};

const STATUS_LABEL: Record<OnboardingStepStatus, string> = {
  pending: "Pending",
  running: "Running",
  ok: "Done",
  error: "Failed",
  skipped: "Skipped",
};

const STATUS_TONE: Record<OnboardingStepStatus, "default" | "secondary" | "destructive" | "outline"> = {
  pending: "outline",
  running: "secondary",
  ok: "default",
  error: "destructive",
  skipped: "outline",
};

function elapsed(iso: string | null | undefined): string {
  if (!iso) return "";
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return "";
  const sec = Math.floor((Date.now() - t) / 1000);
  if (sec < 60) return `${sec}s`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m ${sec % 60}s`;
  return `${Math.floor(sec / 3600)}h ${Math.floor((sec % 3600) / 60)}m`;
}

export default function ClientSetup() {
  const { clientId } = useParams<{ clientId: string }>();
  const { user } = useAuth();
  const canEdit = user?.role === "admin" || user?.role === "editor";

  const [job, setJob] = useState<OnboardingJob | null>(null);
  const [events, setEvents] = useState<AuditLog[]>([]);
  const [clientName, setClientName] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [busyStep, setBusyStep] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const pollRef = useRef<number | null>(null);
  const [, force] = useState(0);

  const loadJob = useCallback(async () => {
    if (!clientId) return null;
    try {
      const j = await api<OnboardingJob>(`/clients/${clientId}/onboarding`);
      setJob(j);
      return j;
    } catch {
      setJob(null);
      return null;
    }
  }, [clientId]);

  const loadEvents = useCallback(async () => {
    if (!clientId) return;
    try {
      const ev = await api<AuditLog[]>(`/clients/${clientId}/audit-log?limit=50`);
      setEvents(ev);
    } catch {
      setEvents([]);
    }
  }, [clientId]);

  const loadClient = useCallback(async () => {
    if (!clientId) return;
    try {
      const c = await api<{ company_name: string }>(`/clients/${clientId}`);
      setClientName(c.company_name);
    } catch {
      /* client may not exist or be inaccessible */
    }
  }, [clientId]);

  // initial load
  useEffect(() => {
    setLoading(true);
    Promise.all([loadJob(), loadEvents(), loadClient()]).finally(() => setLoading(false));
  }, [loadJob, loadEvents, loadClient]);

  // poll while running
  useEffect(() => {
    if (job?.status === "running" && pollRef.current === null) {
      pollRef.current = window.setInterval(async () => {
        const j = await loadJob();
        await loadEvents();
        if (j?.status !== "running" && pollRef.current) {
          window.clearInterval(pollRef.current);
          pollRef.current = null;
        }
        force((x) => x + 1);
      }, 2000);
    }
    return () => {
      if (pollRef.current) {
        window.clearInterval(pollRef.current);
        pollRef.current = null;
      }
    };
  }, [job?.status, loadJob, loadEvents]);

  // re-render the "elapsed" line every 30s
  useEffect(() => {
    const id = window.setInterval(() => force((x) => x + 1), 30_000);
    return () => window.clearInterval(id);
  }, []);

  async function rerunAll() {
    if (!clientId) return;
    setError("");
    setBusy(true);
    try {
      await api(`/clients/${clientId}/onboard`, { method: "POST" });
      toast.success("Onboarding re-started");
      await Promise.all([loadJob(), loadEvents()]);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Could not start onboarding";
      setError(msg);
      toast.error(msg);
    } finally {
      setBusy(false);
    }
  }

  async function retryStep(stepKey: string) {
    if (!clientId) return;
    setError("");
    setBusyStep(stepKey);
    try {
      await api(`/clients/${clientId}/onboarding/retry/${stepKey}`, { method: "POST" });
      toast.success(`Re-running step`);
      await Promise.all([loadJob(), loadEvents()]);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Could not retry step";
      setError(msg);
      toast.error(msg);
    } finally {
      setBusyStep(null);
    }
  }

  const running = job?.status === "running";
  const jobComplete = job?.status === "completed" || job?.status === "completed_with_errors";
  const failedSteps = job?.steps.filter((s) => s.status === "error") ?? [];
  const doneCount = job?.steps.filter((s) => s.status === "ok" || s.status === "skipped").length ?? 0;
  const totalSteps = job?.steps.length ?? 0;
  const pct = totalSteps ? Math.round((doneCount / totalSteps) * 100) : 0;
  const jobErrored = job?.status === "failed";

  return (
    <div className="space-y-6 max-w-6xl">
      {/* Header */}
      <Breadcrumb items={[
        { label: "Clients", to: "/clients" },
        ...(clientName ? [{ label: clientName, to: `/clients/${clientId}` }] : []),
        { label: "Setup" },
      ]} />
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">
              Setup
              {clientName && <span className="text-muted-foreground font-normal"> · {clientName}</span>}
            </h1>
            <p className="text-sm text-muted-foreground">
              {job
                ? doneCount === totalSteps
                  ? "All steps complete."
                  : `${doneCount} of ${totalSteps} steps complete · ${pct}%`
                : "No onboarding job yet for this client."}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {canEdit && job && !running && (
            <Button onClick={rerunAll} disabled={busy} variant="outline">
              <RotateCcw className="h-4 w-4" />
              {busy ? "Starting…" : "Re-run all"}
            </Button>
          )}
          <Button asChild variant="ghost">
            <Link to={`/clients/${clientId}`}>
              Open client
              <ChevronRight className="h-4 w-4" />
            </Link>
          </Button>
        </div>
      </div>

      {error && (
        <div role="alert" className="flex items-start gap-2 rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-[1fr_22rem]">
        <div className="space-y-4">
          {/* Stepper */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Pipeline</CardTitle>
              <CardDescription>
                {job
                  ? running
                    ? "Onboarding is running. This page updates automatically."
                    : jobErrored
                    ? "Onboarding failed before completion."
                    : jobComplete
                    ? "Onboarding finished."
                    : "Onboarding hasn't started yet."
                  : "Use 'Re-run all' to start the pipeline."}
              </CardDescription>
            </CardHeader>
            <CardContent>
              {loading ? (
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
                  {Array.from({ length: 5 }).map((_, i) => (
                    <div key={i} className="h-16 rounded-lg bg-muted/40 animate-pulse" />
                  ))}
                </div>
              ) : job ? (
                <OnboardingStepper steps={job.steps} jobComplete={jobComplete} />
              ) : (
                <div className="flex items-center gap-2 rounded-md border border-dashed border-border bg-muted/30 px-3 py-3 text-sm text-muted-foreground">
                  <CircleDashed className="h-4 w-4 shrink-0" />
                  <span>No onboarding job. Start one with the button on the right.</span>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Per-step detail cards */}
          {job && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Step details</CardTitle>
                <CardDescription>
                  Per-step status, current detail string, and per-step retry.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-2">
                {job.steps.map((step) => (
                  <StepRow
                    key={step.key}
                    step={step}
                    canEdit={canEdit}
                    busy={busyStep === step.key}
                    jobRunning={running}
                    onRetry={() => retryStep(step.key)}
                    onStartAll={rerunAll}
                    jobComplete={jobComplete}
                  />
                ))}
              </CardContent>
            </Card>
          )}

          {/* Job-failed banner */}
          {jobErrored && (
            <Card className="border-destructive/50">
              <CardContent className="flex items-start gap-3 p-4">
                <XCircle className="h-5 w-5 shrink-0 text-destructive mt-0.5" />
                <div>
                  <p className="text-sm font-medium text-destructive">Onboarding failed</p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    The pipeline hit an unrecoverable error. Inspect the failed steps above and
                    re-run them individually, or use "Re-run all" to start over.
                  </p>
                </div>
              </CardContent>
            </Card>
          )}

          {jobComplete && failedSteps.length > 0 && (
            <Card className="border-amber-500/40 bg-amber-500/5">
              <CardContent className="flex items-start gap-3 p-4">
                <AlertTriangle className="h-5 w-5 shrink-0 text-amber-600 dark:text-amber-400 mt-0.5" />
                <div>
                  <p className="text-sm font-medium">Finished with errors</p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {failedSteps.length} step{failedSteps.length === 1 ? "" : "s"} didn't finish.
                    You can keep using the client — the other steps succeeded — or retry the
                    failed ones.
                  </p>
                </div>
              </CardContent>
            </Card>
          )}
        </div>

        {/* Sidebar */}
        <aside className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Activity</CardTitle>
              <CardDescription>
                Every onboarding event for this client.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {loading ? (
                <div className="space-y-2">
                  {Array.from({ length: 5 }).map((_, i) => (
                    <div key={i} className="h-10 rounded-md bg-muted/40 animate-pulse" />
                  ))}
                </div>
              ) : (
                <ActivityTimeline events={events} emptyText="No onboarding events yet." initialLimit={10} />
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">What this does</CardTitle>
            </CardHeader>
            <CardContent className="text-sm text-muted-foreground space-y-2">
              <p>
                The onboarding pipeline runs 5 steps in sequence, then in parallel
                for the last two. Each step is independently retriable.
              </p>
              <p>
                Everything written here is fed into the Editorial and Visual
                agents for every campaign, so the more complete the profile, the
                better the output.
              </p>
            </CardContent>
          </Card>
        </aside>
      </div>
    </div>
  );
}

function StepRow({
  step,
  canEdit,
  busy,
  jobRunning,
  jobComplete,
  onRetry,
  onStartAll,
}: {
  step: OnboardingStep;
  canEdit: boolean;
  busy: boolean;
  jobRunning: boolean;
  jobComplete: boolean;
  onRetry: () => void;
  onStartAll: () => void;
}) {
  const isError = step.status === "error";
  const isRunning = step.status === "running";
  const isDone = step.status === "ok" || (jobComplete && step.status !== "error");
  const isSkipped = step.status === "skipped";
  const isPending = step.status === "pending";

  return (
    <div
      className={cn(
        "flex items-start gap-3 rounded-lg border px-3 py-2.5",
        isDone && "border-emerald-500/30 bg-emerald-500/5",
        isRunning && "border-primary/30 bg-primary/5",
        isError && "border-destructive/40 bg-destructive/5",
        isSkipped && "border-border bg-muted/30",
        isPending && "border-border bg-card",
      )}
    >
      <div className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center">
        {isRunning ? (
          <Loader2 className="h-4 w-4 animate-spin text-primary" />
        ) : isDone ? (
          <CheckCircle2 className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
        ) : isError ? (
          <XCircle className="h-4 w-4 text-destructive" />
        ) : isSkipped ? (
          <CircleDashed className="h-4 w-4 text-muted-foreground" />
        ) : (
          <CircleDashed className="h-4 w-4 text-muted-foreground" />
        )}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex flex-wrap items-baseline justify-between gap-x-2 gap-y-1">
          <p className="text-sm font-medium leading-tight">{step.label}</p>
          <Badge variant={STATUS_TONE[step.status]} className="font-normal text-[10px] py-0">
            {STATUS_LABEL[step.status]}
          </Badge>
        </div>
        <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">
          {step.detail || STEP_DESCRIPTION[step.key] || ""}
        </p>
      </div>
      <div className="flex items-center gap-1.5 shrink-0">
        {canEdit && (isError || isSkipped) && !jobRunning && (
          <Button size="sm" variant="outline" onClick={onRetry} disabled={busy}>
            <RotateCcw className="h-3 w-3" />
            {busy ? "Retrying…" : "Retry"}
          </Button>
        )}
        {canEdit && isPending && !jobRunning && (
          <Button size="sm" variant="outline" onClick={onStartAll}>
            <Play className="h-3 w-3" />
            Run
          </Button>
        )}
        {isRunning && (
          <Badge variant="secondary" className="gap-1 font-normal text-[10px] py-0">
            <Timer className="h-3 w-3" />
            In progress
          </Badge>
        )}
      </div>
    </div>
  );
}
