import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronDown, Loader2, RefreshCw, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { api } from "../api";
import { useAuth } from "../auth";
import type { Client, Competitor, CompetitorSearchJob } from "../types";
import { useConfirm } from "@/components/ui/dialogs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";

const RUNNING_ANALYSIS = ["pending", "crawling", "extracting", "comparing"];
const RUNNING_SEARCH = ["pending", "identifying"];

const COMP_DOT: Record<string, string> = {
  ok: "bg-emerald-600",
  err: "bg-red-700",
  busy: "bg-amber-600",
  idle: "bg-stone-300",
};

export function Competitors({ client, onboardingRunning }: { client: Client; onboardingRunning?: boolean }) {
  const confirm = useConfirm();
  const { user } = useAuth();
  const canEdit = user?.role === "admin" || user?.role === "editor";

  const [competitors, setCompetitors] = useState<Competitor[]>([]);
  const [searchJob, setSearchJob] = useState<CompetitorSearchJob | null>(null);
  const [params, setParams] = useState({ num_competitors: 5, competitor_type: "direct", geographic_scope: "national" });
  const [manualUrl, setManualUrl] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const searchDecided = useRef(false);
  const [error, setError] = useState("");
  const pollRef = useRef<number | null>(null);
  const tabsRef = useRef<HTMLDivElement | null>(null);
  const [tabScroll, setTabScroll] = useState({ left: false, right: false });

  const updateTabArrows = useCallback(() => {
    const el = tabsRef.current;
    if (!el) return;
    const maxScroll = el.scrollWidth - el.clientWidth;
    setTabScroll({
      left: el.scrollLeft > 1,
      right: el.scrollLeft < maxScroll - 1,
    });
  }, []);

  function scrollTabs(dir: -1 | 1) {
    const el = tabsRef.current;
    if (el) el.scrollBy({ left: dir * el.clientWidth * 0.7, behavior: "smooth" });
  }

  const load = useCallback(async () => {
    const [list, job] = await Promise.all([
      api<Competitor[]>(`/clients/${client.id}/competitors`),
      api<CompetitorSearchJob | null>(`/clients/${client.id}/competitors/search/latest`),
    ]);
    setCompetitors(list);
    setSearchJob(job);
    if (!searchDecided.current) {
      setSearchOpen(list.length === 0);
      searchDecided.current = true;
    }
    return { list, job };
  }, [client.id]);

  useEffect(() => {
    load().catch((e) => setError(e.message));
    return () => {
      if (pollRef.current) window.clearInterval(pollRef.current);
    };
  }, [load]);

  const busy =
    (searchJob && RUNNING_SEARCH.includes(searchJob.status)) ||
    competitors.some((c) => RUNNING_ANALYSIS.includes(c.analysis_status));

  useEffect(() => {
    if (busy && pollRef.current === null) {
      pollRef.current = window.setInterval(async () => {
        const { list, job } = await load().catch(() => ({ list: [], job: null }));
        const stillBusy =
          (job && RUNNING_SEARCH.includes(job.status)) ||
          list.some((c) => RUNNING_ANALYSIS.includes(c.analysis_status));
        if (!stillBusy && pollRef.current) {
          window.clearInterval(pollRef.current);
          pollRef.current = null;
        }
      }, 4000);
    }
  }, [busy, load]);

  useEffect(() => {
    updateTabArrows();
    window.addEventListener("resize", updateTabArrows);
    return () => window.removeEventListener("resize", updateTabArrows);
  }, [competitors.length, updateTabArrows]);

  async function startSearch(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    try {
      await api(`/clients/${client.id}/competitors/search`, { method: "POST", body: params });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not start search");
    }
  }

  async function addManual(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    try {
      await api(`/clients/${client.id}/competitors`, { method: "POST", body: { website_url: manualUrl } });
      setManualUrl("");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not add competitor");
    }
  }

  async function remove(id: string) {
    const ok = await confirm({
      title: "Remove competitor",
      description: "This removes the competitor from this client's analysis.",
      confirmLabel: "Remove",
      destructive: true,
    });
    if (!ok) return;
    try {
      await api(`/clients/${client.id}/competitors/${id}`, { method: "DELETE" });
      setCompetitors((prev) => prev.filter((c) => c.id !== id));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Delete failed");
    }
  }

  async function reanalyze(id: string) {
    setError("");
    try {
      await api(`/clients/${client.id}/competitors/${id}/analyze`, { method: "POST" });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not start analysis");
    }
  }

  const searching = !!(searchJob && RUNNING_SEARCH.includes(searchJob.status));
  const selected = competitors.find((c) => c.id === selectedId) ?? competitors[0] ?? null;
  const isOpen = searchOpen && !onboardingRunning;

  return (
    <div className="flex flex-col gap-5">
      {onboardingRunning && (
        <div className="flex items-center gap-2 rounded-md border border-primary/30 bg-primary/5 px-3 py-2 text-xs text-primary">
          <Loader2 className="h-3.5 w-3.5 animate-spin shrink-0" />
          <span>
            Client setup is still running in the background. You can already
            review and edit competitors below — the onboarding step will add
            to this list when it finishes.
          </span>
        </div>
      )}

      {canEdit && (
        <Card className={cn(!isOpen && "pb-4")}>
          <button
            type="button"
            aria-expanded={isOpen}
            onClick={() => setSearchOpen((o) => !o)}
            className="flex w-full cursor-pointer items-center justify-between gap-4 border-none bg-transparent p-0 text-left font-inherit text-inherit"
          >
            <div>
              <h2 className="m-0">Find competitors automatically</h2>
              <span className="text-sm text-muted-foreground">
                Click to find or manually add competitors while setup runs
              </span>
            </div>
            <ChevronDown
              size={18}
              className={cn(
                "flex-shrink-0 text-muted-foreground transition-transform duration-200",
                isOpen && "rotate-180",
              )}
            />
          </button>
          {isOpen && (
            <CardContent className="space-y-4 px-0 pt-3">
              <p className="text-sm text-muted-foreground">
                Uses the configured LLM with web search to identify the most relevant competitors,
                then crawls and analyzes each one against this client.
              </p>
              <form onSubmit={startSearch} className="grid grid-cols-1 gap-x-4 gap-y-3 sm:grid-cols-4">
                <div className="space-y-1.5">
                  <Label htmlFor="comp-num">Number of competitors (1–20)</Label>
                  <Input id="comp-num" type="number" min={1} max={20} value={params.num_competitors} onChange={(e) => setParams({ ...params, num_competitors: Number(e.target.value) })} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="comp-type">Type</Label>
                  <select id="comp-type" value={params.competitor_type} onChange={(e) => setParams({ ...params, competitor_type: e.target.value })} className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring">
                    <option value="direct">Direct</option>
                    <option value="indirect">Indirect</option>
                  </select>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="comp-scope">Geographic scope</Label>
                  <select id="comp-scope" value={params.geographic_scope} onChange={(e) => setParams({ ...params, geographic_scope: e.target.value })} className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring">
                    <option value="local">Local</option>
                    <option value="national">National</option>
                    <option value="international">International</option>
                  </select>
                </div>
                <div className="flex items-end">
                  <Button type="submit" disabled={searching} className="h-[42px] w-full">
                    {searching ? "Searching…" : "Find competitors"}
                  </Button>
                </div>
              </form>
              {searching && (
                <div className="mt-2 h-2 overflow-hidden rounded-full bg-border">
                  <div className="h-full w-[35%] animate-[slide_1.4s_ease-in-out_infinite] rounded-full bg-primary" />
                </div>
              )}
              {searchJob?.status === "failed" && (
                <div className="rounded-lg border-l-4 border-red-600 bg-red-50 p-3 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300">
                  Last search failed: {searchJob.error}
                </div>
              )}
              <div className="rounded-lg border border-dashed border-border bg-surface-alt p-3">
                <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">or add one manually</span>
                <form onSubmit={addManual} className="mt-2 flex gap-2">
                  <Input type="url" placeholder="https://competitor.com" value={manualUrl} onChange={(e) => setManualUrl(e.target.value)} required className="flex-1" />
                  <Button type="submit" variant="secondary">Add competitor</Button>
                </form>
              </div>
            </CardContent>
          )}
        </Card>
      )}

      {error && (
        <div className="rounded-lg border-l-4 border-red-600 bg-red-50 p-3 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300">{error}</div>
      )}

      {competitors.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            No competitors yet — run an automatic search above or add one by URL.
          </CardContent>
        </Card>
      ) : (
        <Card className="overflow-hidden p-0">
          <div className="relative">
            <button
              type="button"
              aria-label="Scroll tabs left"
              hidden={!tabScroll.left}
              onClick={() => scrollTabs(-1)}
              className="absolute left-0 top-0 z-10 flex h-full cursor-pointer items-center bg-gradient-to-r from-surface to-transparent pl-2 pr-4 text-2xl text-muted-foreground transition-colors hover:text-primary"
            >
              ‹
            </button>
            <div
              role="tablist"
              ref={tabsRef}
              onScroll={updateTabArrows}
              onWheel={(e) => {
                const el = tabsRef.current;
                if (el && el.scrollWidth > el.clientWidth && e.deltaY !== 0) {
                  el.scrollLeft += e.deltaY;
                }
              }}
              className="scrollbar-thin flex gap-1 overflow-x-auto scroll-smooth border-b border-border px-5 pt-3 [-ms-overflow-style:none] [scrollbar-width:thin] [&::-webkit-scrollbar]:h-1.5"
            >
              {competitors.map((c) => (
                <button
                  key={c.id}
                  role="tab"
                  type="button"
                  aria-selected={selected?.id === c.id}
                  onClick={() => setSelectedId(c.id)}
                  title={c.company_name}
                  className={cn(
                    "inline-flex max-w-[220px] flex-shrink-0 cursor-pointer items-center gap-2 rounded-t-lg border border-b-0 border-border bg-surface-alt px-3.5 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-card hover:text-foreground",
                    selected?.id === c.id && "z-10 -mb-px border-border-b border-b border-surface bg-surface font-semibold text-primary",
                  )}
                >
                  <Dot status={c.analysis_status} />
                  <span className="overflow-hidden text-ellipsis whitespace-nowrap">{c.company_name}</span>
                </button>
              ))}
            </div>
            <button
              type="button"
              aria-label="Scroll tabs right"
              hidden={!tabScroll.right}
              onClick={() => scrollTabs(1)}
              className="absolute right-0 top-0 z-10 flex h-full cursor-pointer items-center bg-gradient-to-l from-surface to-transparent pr-2 pl-4 text-2xl text-muted-foreground transition-colors hover:text-primary"
            >
              ›
            </button>
          </div>

          {selected && (
            <div className="p-5 pt-5" role="tabpanel">
              <div className="flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-start">
                <div>
                  <h3 className="mb-0.5">
                    {selected.company_name}{" "}
                    <Badge variant={selected.source === "auto" ? "secondary" : "success"}>{selected.source}</Badge>
                  </h3>
                  <a href={selected.website_url} target="_blank" rel="noreferrer" className="text-sm text-muted-foreground hover:underline">
                    {selected.website_url}
                  </a>
                </div>
                <div className="flex flex-shrink-0 items-center gap-2">
                  <StatusBadge status={selected.analysis_status} pages={selected.pages_crawled} />
                  {canEdit && !RUNNING_ANALYSIS.includes(selected.analysis_status) && (
                    <Button variant="ghost" size="sm" onClick={() => reanalyze(selected.id)}>
                      <RefreshCw size={14} /> Re-analyze
                    </Button>
                  )}
                  {canEdit && (
                    <Button variant="ghost" size="sm" className="text-red-600 hover:bg-red-50 dark:hover:bg-red-950/40" onClick={() => remove(selected.id)}>
                      <Trash2 size={14} /> Remove
                    </Button>
                  )}
                </div>
              </div>

              {selected.identification_reason && (
                <p className="my-2.5 rounded-r-md border-l-[3px] border-primary bg-surface-alt p-3 text-[0.92rem] leading-relaxed">
                  {selected.identification_reason}
                </p>
              )}

              {selected.analysis_status === "failed" && (
                <div className="rounded-lg border-l-4 border-red-600 bg-red-50 p-3 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300">
                  {selected.analysis_error}
                </div>
              )}

              {RUNNING_ANALYSIS.includes(selected.analysis_status) && (
                <div className="mt-2 h-2 overflow-hidden rounded-full bg-border">
                  <div className="h-full w-[35%] animate-[slide_1.4s_ease-in-out_infinite] rounded-full bg-primary" />
                </div>
              )}

              {selected.analysis_status === "completed" && (
                <>
                  <div className="my-5 grid grid-cols-1 gap-5 sm:grid-cols-2">
                    <div className="rounded-md border border-emerald-200 bg-emerald-50 p-4 dark:border-emerald-900 dark:bg-emerald-950/30">
                      <h4 className="mb-2 font-semibold text-emerald-700">Strengths vs {client.company_name}</h4>
                      <ul className="m-0 pl-4 text-[0.92rem]">
                        {selected.strengths.map((s, i) => <li key={i} className="mb-1.5 leading-relaxed">{s}</li>)}
                      </ul>
                    </div>
                    <div className="rounded-md border border-red-200 bg-red-50 p-4 dark:border-red-900 dark:bg-red-950/30">
                      <h4 className="mb-2 font-semibold text-red-700">Weaknesses vs {client.company_name}</h4>
                      <ul className="m-0 pl-4 text-[0.92rem]">
                        {selected.weaknesses.map((w, i) => <li key={i} className="mb-1.5 leading-relaxed">{w}</li>)}
                      </ul>
                    </div>
                  </div>
                  <Button variant="ghost" onClick={() => setExpanded(expanded === selected.id ? null : selected.id)}>
                    {expanded === selected.id ? "Hide full profile" : "Show full profile"}
                  </Button>
                  {expanded === selected.id && (
                    <div className="mt-2.5 whitespace-pre-wrap border-t border-border pt-3">
                      <Row label="Differential positioning" value={selected.positioning} />
                      <Row label="Industry" value={selected.industry} />
                      <Row label="Description" value={selected.description} />
                      <Row label="Products / services" value={selected.products_services} />
                      <Row label="Target audience" value={selected.target_audience} />
                      <Row label="Value proposition" value={selected.value_proposition} />
                      <Row label="Communication tone" value={selected.communication_tone} />
                      <Row label="Social media" value={selected.social_media_urls.join(", ")} />
                    </div>
                  )}
                </>
              )}
            </div>
          )}
        </Card>
      )}
    </div>
  );
}

function Dot({ status }: { status: string }) {
  const state =
    status === "completed" ? "ok" : status === "failed" ? "err"
    : RUNNING_ANALYSIS.includes(status) ? "busy" : "idle";
  return <span className={cn("size-2 flex-shrink-0 rounded-full", COMP_DOT[state])} aria-hidden />;
}

function StatusBadge({ status, pages }: { status: string; pages: number }) {
  const variant: "success" | "destructive" | "secondary" =
    status === "completed" ? "success" : status === "failed" ? "destructive" : "secondary";
  const label = RUNNING_ANALYSIS.includes(status)
    ? `${status}${status === "crawling" && pages ? ` (${pages} pages)` : ""}…`
    : status;
  return <Badge variant={variant}>{label}</Badge>;
}

function Row({ label, value }: { label: string; value: string }) {
  if (!value) return null;
  return (
    <div className="grid grid-cols-1 gap-4 border-b border-border py-2 last:border-0 sm:grid-cols-[200px_1fr]">
      <div className="text-sm text-muted-foreground">{label}</div>
      <div>{value}</div>
    </div>
  );
}
