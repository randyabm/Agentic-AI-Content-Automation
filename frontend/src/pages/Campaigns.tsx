import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { Plus, X, Calendar as CalendarIcon, ChevronDown, ChevronUp, Copy, Trash2 } from "lucide-react";
import { api } from "../api";
import { ArticleContentForm } from "../components/ArticleContentForm";
import { TextareaZoom } from "../components/TextareaZoom";
import { ArticlePickerModal } from "../components/ArticlePickerModal";
import { ClientAvatar } from "../components/ClientAvatar";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { PlatformIcon, platformLabel } from "../components/PlatformIcon";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { TableSkeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { resolvePlatformRatios } from "../ratios";
import type {
  ArticleListItem,
  CampaignListItem,
  CampaignObjective,
  Client,
  ElementType,
  PlatformSpec,
} from "../types";

const OBJECTIVES: CampaignObjective[] = [
  "awareness", "consideration", "conversion", "retention", "launch", "promotion",
];

const ELEMENT_LABELS: Record<ElementType, string> = {
  image: "🖼️ Image", carousel: "🎠 Carousel", video: "🎬 Video", text: "✍️ Text only",
};

const ELEMENT_TYPE_ORDER: ElementType[] = ["image", "carousel", "video", "text"];
const ELEMENT_TYPE_ICON: Record<ElementType, { icon: string; label: string }> = {
  image: { icon: "image", label: "image" },
  carousel: { icon: "view_carousel", label: "carousel" },
  video: { icon: "movie", label: "video" },
  text: { icon: "article", label: "text" },
};

interface ElementDraft {
  key: number;
  element_type: ElementType;
  theme: string;
  platforms: string[];
  ratio_overrides: Record<string, string>;
  carousel_slides: number;
  video_duration_seconds: number;
}

interface PlatformSettings {
  hashtag_count: number;
  emojis: string;
  include_cta: boolean;
  tone: string;
}

const APPROVAL_BADGE: Record<string, { bg: string; text: string; label: string }> = {
  draft: { bg: "#f3f4f6", text: "#6b7280", label: "Draft" },
  pending_review: { bg: "#fef3c7", text: "#d97706", label: "Pending Review" },
  approved: { bg: "#d1fae5", text: "#059669", label: "Approved" },
  rejected: { bg: "#fee2e2", text: "#dc2626", label: "Rejected" },
  changes_requested: { bg: "#fef3c7", text: "#d97706", label: "Changes Requested" },
};

/** Compact publish rollup for the Status column (failed needs action → wins). */
function publishSummary(c: CampaignListItem): { label: string; cls: string } | null {
  const pub = c.posts_published ?? 0;
  const sch = c.posts_scheduled ?? 0;
  const fail = c.posts_failed ?? 0;
  const total = c.post_count ?? 0;
  if (fail > 0) return { label: `✗ ${fail} failed`, cls: "text-red-600" };
  if (pub > 0 && total > 0 && pub >= total) return { label: "✓ All published", cls: "text-emerald-600" };
  if (pub > 0) return { label: `✓ ${pub}/${total} published`, cls: "text-emerald-600" };
  if (sch > 0) return { label: `⏰ ${sch} scheduled`, cls: "text-sky-600" };
  return null;
}

function publishTooltip(c: CampaignListItem): string {
  return `${c.posts_published ?? 0} published · ${c.posts_scheduled ?? 0} scheduled · ${c.posts_failed ?? 0} failed · ${c.post_count ?? 0} posts`;
}

const STATUS_VARIANT: Record<string, "success" | "secondary" | "destructive"> = {
  ready: "success", generating: "secondary", failed: "destructive", draft: "secondary",
};

const STATUS_LABELS: Record<string, string> = { all: "All", ready: "Ready", generating: "Generating", failed: "Failed", draft: "Draft" };

export default function Campaigns() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const initClient = params.get("client_id") ?? "";
  const fromArticle = params.get("from_article") ?? "";
  const [campaigns, setCampaigns] = useState<CampaignListItem[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [mode, setMode] = useState<"none" | "campaign" | "article">(fromArticle ? "article" : "none");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  const [search, setSearch] = useState("");
  const [filterClient, setFilterClient] = useState(initClient);
  const [filterStatus, setFilterStatus] = useState("all");
  const [sortOrder, setSortOrder] = useState<"newest" | "oldest">("newest");
  const [view, setView] = useState<"list" | "cards">(
    () => (localStorage.getItem("campaignsView") as "list" | "cards") || "list",
  );
  useEffect(() => { localStorage.setItem("campaignsView", view); }, [view]);
  const [deleteCandidate, setDeleteCandidate] = useState<CampaignListItem | null>(null);
  const [deleteSummary, setDeleteSummary] = useState<{ elements: number; posts: number; images: number; videos: number } | null>(null);
  const [deleting, setDeleting] = useState(false);

  async function load() { setCampaigns(await api<CampaignListItem[]>("/campaigns")); }

  useEffect(() => {
    load().catch((e) => setError(e.message)).finally(() => setLoading(false));
    api<Client[]>("/clients").then(setClients).catch(() => {});
  }, []);

  useEffect(() => {
    if (!campaigns.some((c) => c.status === "generating" || c.visuals_generating)) return;
    const t = setInterval(() => {
      if (document.hidden) return; // don't poll from background tabs
      load().catch(() => {});
    }, 4000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [campaigns]);

  const clientName = (id: string) => clients.find((c) => c.id === id)?.company_name ?? "—";

  const visible = useMemo(() => {
    let list = campaigns;
    const q = search.trim().toLowerCase();
    if (q) list = list.filter((c) => c.name.toLowerCase().includes(q));
    if (filterClient) list = list.filter((c) => c.client_id === filterClient);
    if (filterStatus !== "all") list = list.filter((c) => c.status === filterStatus);
    if (sortOrder === "oldest") list = [...list].reverse();
    return list;
  }, [campaigns, search, filterClient, filterStatus, sortOrder]);

  const statusCounts = useMemo(() => {
    const base = filterClient ? campaigns.filter((c) => c.client_id === filterClient) : campaigns;
    const counts: Record<string, number> = { all: base.length };
    for (const c of base) counts[c.status] = (counts[c.status] ?? 0) + 1;
    return counts;
  }, [campaigns, filterClient]);

  function openDeleteDialog(c: CampaignListItem) {
    setDeleteCandidate(c);
    setDeleteSummary(null);
    api<{ elements: number; posts: number; images: number; videos: number }>(`/campaigns/${c.id}/deletion-summary`)
      .then(setDeleteSummary)
      .catch(() => setDeleteSummary(null));
  }

  async function doDelete(id: string) {
    setDeleting(true);
    try {
      await api(`/campaigns/${id}`, { method: "DELETE" });
      setCampaigns((prev) => prev.filter((c) => c.id !== id));
      setDeleteCandidate(null);
      setDeleteSummary(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Delete failed");
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div>
      <div className="mb-5 flex items-center justify-between gap-4">
        <h1>Campaigns</h1>
        <div className="flex flex-shrink-0 items-center gap-2">
          <Button
            variant={mode === "campaign" ? "ghost" : "default"}
            onClick={() => setMode((m) => (m === "campaign" ? "none" : "campaign"))}
          >
            {mode === "campaign" ? "Cancel" : "+ New campaign"}
          </Button>
          <Button
            variant="ghost"
            onClick={() => setMode((m) => (m === "article" ? "none" : "article"))}
          >
            {mode === "article" ? "Cancel" : "+ From article"}
          </Button>
        </div>
      </div>
      {error && (
        <div className="mb-4 rounded-lg border-l-4 border-red-600 bg-red-50 p-3 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300">{error}</div>
      )}

      {mode === "campaign" && (
        <CreateCampaign
          clients={clients}
          defaultClient={initClient}
          onCreated={(id) => { setMode("none"); navigate(`/campaigns/${id}`); }}
          onCancel={() => setMode("none")}
        />
      )}
      {mode === "article" && (
        <ArticleContentForm
          clients={clients}
          defaultClient={initClient}
          initialArticleId={fromArticle}
          onCreated={(id) => { setMode("none"); navigate(`/campaigns/${id}`); }}
        />
      )}

      {mode === "none" && (
        <>
          <div className="mb-4 flex flex-wrap items-center gap-3">
            <Input
              placeholder="Search campaigns…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="max-w-xs"
            />
            <select
              value={filterClient}
              onChange={(e) => setFilterClient(e.target.value)}
              className="h-10 rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            >
              <option value="">All clients</option>
              {clients.map((c) => (<option key={c.id} value={c.id}>{c.company_name}</option>))}
            </select>
            <div className="flex gap-1">
              {["all", "ready", "generating", "failed"].map((s) => (
                <button
                  key={s}
                  onClick={() => setFilterStatus(s)}
                  className={cn(
                    "rounded-full border border-border bg-card px-3 py-1 text-xs font-medium transition-colors",
                    filterStatus === s ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-accent",
                  )}
                >
                  {STATUS_LABELS[s]}{statusCounts[s] ? ` (${statusCounts[s]})` : ""}
                </button>
              ))}
            </div>
            <select
              value={sortOrder}
              onChange={(e) => setSortOrder(e.target.value as "newest" | "oldest")}
              className="h-10 rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            >
              <option value="newest">Newest first</option>
              <option value="oldest">Oldest first</option>
            </select>
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

          {loading && <TableSkeleton rows={5} cols={7} />}

          {!loading && view === "list" && (
            <div className="overflow-hidden rounded-xl border border-border bg-card">
              <div className="grid grid-cols-[minmax(0,1.8fr)_minmax(0,1fr)_100px_120px_150px_90px_40px] gap-3 border-b border-border bg-muted/40 px-4 py-2.5 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                <div>Campaign</div>
                <div>Client</div>
                <div>Platforms</div>
                <div className="text-center">Elements</div>
                <div>Status</div>
                <div>Updated</div>
                <div></div>
              </div>
              {visible.map((c) => {
                const ab = c.approval_status ? APPROVAL_BADGE[c.approval_status] : null;
                const pub = publishSummary(c);
                return (
                  <div
                    key={c.id}
                    onClick={() => navigate(`/campaigns/${c.id}`)}
                    className="grid cursor-pointer grid-cols-[minmax(0,1.8fr)_minmax(0,1fr)_100px_120px_150px_90px_40px] items-center gap-3 border-b border-border px-4 py-3 transition-colors last:border-b-0 hover:bg-muted/40"
                  >
                    <div className="flex min-w-0 items-center gap-2.5">
                      <span
                        className={cn(
                          "size-2 shrink-0 rounded-full",
                          c.status === "ready" ? "bg-emerald-500" : c.status === "failed" ? "bg-red-500" : "bg-amber-400",
                        )}
                        title={c.status}
                      />
                      <div className="min-w-0">
                        <div className="truncate text-sm font-medium">{c.name}</div>
                        <div className="mt-0.5 flex items-center gap-1.5">
                          <span className="rounded bg-muted px-1.5 py-px text-[10px] capitalize text-muted-foreground">{c.objective}</span>
                          {c.status !== "generating" && c.visuals_generating && (
                            <span className="text-[10px] text-amber-600">⏳ visuals</span>
                          )}
                        </div>
                      </div>
                    </div>
                    <div className="truncate text-sm text-muted-foreground">{clientName(c.client_id)}</div>
                    <div className="flex items-center gap-1.5">
                      {(c.platforms ?? []).slice(0, 5).map((p) => (<PlatformIcon key={p} platform={p} size={15} />))}
                      {(c.platforms?.length ?? 0) > 5 && (
                        <span className="text-[10px] text-muted-foreground">+{(c.platforms!.length - 5)}</span>
                      )}
                      {(c.platforms?.length ?? 0) === 0 && <span className="text-xs text-muted-foreground/50">—</span>}
                    </div>
                    <div className="flex flex-wrap items-center justify-center gap-x-2 gap-y-1 text-sm text-muted-foreground">
                      {(() => {
                        const types = c.element_types ?? {};
                        const present = ELEMENT_TYPE_ORDER.filter((t) => (types[t] ?? 0) > 0);
                        if (present.length === 0) return <span>{c.element_count ?? 0}</span>;
                        return present.map((t) => (
                          <span key={t} className="inline-flex items-center gap-0.5" title={`${types[t]} ${ELEMENT_TYPE_ICON[t].label}`}>
                            <span className="material-symbols-outlined text-base text-muted-foreground/70">{ELEMENT_TYPE_ICON[t].icon}</span>
                            <span className="tabular-nums">{types[t]}</span>
                          </span>
                        ));
                      })()}
                    </div>
                    <div className="flex min-w-0 flex-col gap-1" title={publishTooltip(c)}>
                      {ab && (
                        <span className="w-fit rounded-full px-2 py-0.5 text-[10px] font-bold" style={{ background: ab.bg, color: ab.text }}>
                          {ab.label}
                        </span>
                      )}
                      {pub && <span className={cn("text-[11px] font-medium", pub.cls)}>{pub.label}</span>}
                    </div>
                    <div className="text-xs text-muted-foreground">{new Date(c.updated_at).toLocaleDateString()}</div>
                    <button
                      className="flex items-center justify-center rounded-md p-1 text-muted-foreground/60 transition-colors hover:bg-muted hover:text-destructive"
                      onClick={(e) => { e.stopPropagation(); openDeleteDialog(c); }}
                      title="Delete campaign"
                      aria-label="Delete campaign"
                    >
                      <span className="material-symbols-outlined text-base">delete</span>
                    </button>
                  </div>
                );
              })}
              {visible.length === 0 && campaigns.length > 0 && (
                <p className="px-4 py-6 text-sm text-muted-foreground">No campaigns match the current filters.</p>
              )}
              {campaigns.length === 0 && (
                <p className="px-4 py-6 text-sm text-muted-foreground">No campaigns yet. Create your first one.</p>
              )}
            </div>
          )}

          {!loading && view === "cards" && (
            <div className="grid grid-cols-[repeat(auto-fill,minmax(280px,1fr))] gap-4">
              {visible.map((c) => {
                const client = clients.find((cl) => cl.id === c.client_id) ?? null;
                const colors = client?.brand_colors?.length ? client.brand_colors : null;
                const ab = c.approval_status ? APPROVAL_BADGE[c.approval_status] : null;
                const pub = publishSummary(c);
                return (
                  <div key={c.id} className="group relative block overflow-hidden rounded-xl border border-border bg-card text-inherit">
                    <div
                      className="h-[52px] flex-shrink-0 bg-gradient-to-br from-primary to-indigo-400"
                      style={colors ? { background: `linear-gradient(135deg, ${colors.slice(0, 3).join(", ")})` } : undefined}
                    >
                      <div className="flex justify-end gap-1 p-2">
                        <Badge variant={STATUS_VARIANT[c.status] ?? "secondary"}>{c.status}</Badge>
                        {c.status !== "generating" && c.visuals_generating && (
                          <Badge>⏳ Visuals</Badge>
                        )}
                      </div>
                    </div>

                    <Link to={`/campaigns/${c.id}`} className="flex flex-1 flex-col px-4 pb-4 text-inherit no-underline">
                      <div className="-mt-[22px] mb-1.5">
                        {client && <ClientAvatar client={client} />}
                      </div>
                      <h3 className="mb-1">{c.name}</h3>
                      <p className="mb-1.5 text-sm font-medium text-primary">{clientName(c.client_id)}</p>
                      <div className="mb-1.5 flex flex-wrap items-center gap-1.5">
                        <Badge variant="secondary" className="capitalize">{c.objective}</Badge>
                        {ab && (
                          <span className="rounded-full px-2 py-0.5 text-[10px] font-bold" style={{ background: ab.bg, color: ab.text }}>
                            {ab.label}
                          </span>
                        )}
                        {pub && (
                          <span className={cn("text-[11px] font-medium", pub.cls)} title={publishTooltip(c)}>{pub.label}</span>
                        )}
                        <span className="text-xs text-muted-foreground">{new Date(c.updated_at).toLocaleDateString()}</span>
                      </div>
                    </Link>

                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => openDeleteDialog(c)}
                      title="Delete campaign"
                      aria-label="Delete campaign"
                      className="absolute right-2 top-2 size-7 opacity-0 transition-opacity group-hover:opacity-100"
                    >
                      <Trash2 size={14} />
                    </Button>
                  </div>
                );
              })}
              {visible.length === 0 && campaigns.length > 0 && (
                <p className="col-span-full text-sm text-muted-foreground">No campaigns match the current filters.</p>
              )}
              {campaigns.length === 0 && (
                <p className="col-span-full text-sm text-muted-foreground">No campaigns yet. Create your first one.</p>
              )}
            </div>
          )}
        </>
      )}

      {deleteCandidate && (
        <ConfirmDialog
          title="Delete campaign"
          confirmLabel="Delete"
          danger
          busy={deleting}
          onConfirm={() => doDelete(deleteCandidate.id)}
          onCancel={() => { setDeleteCandidate(null); setDeleteSummary(null); }}
        >
          <p>
            You are about to permanently delete <strong>{deleteCandidate.name}</strong>.
          </p>
          {deleteSummary ? (
            <ul className="my-3 list-disc pl-5 text-sm">
              {deleteSummary.elements > 0 && <li>{deleteSummary.elements} element{deleteSummary.elements !== 1 ? "s" : ""}</li>}
              {deleteSummary.posts > 0 && <li>{deleteSummary.posts} post{deleteSummary.posts !== 1 ? "s" : ""} (copy)</li>}
              {deleteSummary.images > 0 && <li>{deleteSummary.images} generated image{deleteSummary.images !== 1 ? "s" : ""}</li>}
              {deleteSummary.videos > 0 && <li>{deleteSummary.videos} generated video{deleteSummary.videos !== 1 ? "s" : ""}</li>}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">Loading details…</p>
          )}
          <p className="text-sm text-muted-foreground">This action cannot be undone.</p>
        </ConfirmDialog>
      )}
    </div>
  );
}

function CreateCampaign({
  clients, defaultClient, onCreated, onCancel,
}: {
  clients: Client[];
  defaultClient: string;
  onCreated: (id: string) => void;
  onCancel: () => void;
}) {
  const [specs, setSpecs] = useState<PlatformSpec[]>([]);
  const [articles, setArticles] = useState<ArticleListItem[]>([]);
  const [clientId, setClientId] = useState(defaultClient || (clients[0]?.id ?? ""));
  const [name, setName] = useState("");
  const [objective, setObjective] = useState<CampaignObjective>("awareness");
  const [theme, setTheme] = useState("");
  const [creativity, setCreativity] = useState(5);
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [articleId, setArticleId] = useState("");
  const [articleUrl, setArticleUrl] = useState("");
  const [pickerOpen, setPickerOpen] = useState(false);
  const [globalPlatforms, setGlobalPlatforms] = useState<string[]>(["instagram", "linkedin"]);
  const [elements, setElements] = useState<ElementDraft[]>([]);
  const [nextKey, setNextKey] = useState(1);
  const [settings, setSettings] = useState<Record<string, PlatformSettings>>({});
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [showPlatformSettings, setShowPlatformSettings] = useState(false);

  function toggleGlobalPlatform(platform: string, on: boolean) {
    const next = on ? [...globalPlatforms, platform] : globalPlatforms.filter((p) => p !== platform);
    setGlobalPlatforms(next);
    setElements((prev) => prev.map((el) => ({ ...el, platforms: next })));
  }

  useEffect(() => {
    api<PlatformSpec[]>("/campaigns/platforms").then(setSpecs);
    api<ArticleListItem[]>("/articles?article_status=active").then(setArticles).catch(() => {});
  }, []);

  function addElement(type: ElementType) {
    // Text-only elements can't target platforms that require an image/video (e.g. Instagram).
    const allowed = type === "text"
      ? globalPlatforms.filter((p) => !specs.find((s) => s.platform === p)?.requires_media)
      : globalPlatforms;
    setElements((prev) => [
      ...prev,
      { key: nextKey, element_type: type, theme: "", platforms: [...allowed], ratio_overrides: {}, carousel_slides: 3, video_duration_seconds: 8 },
    ]);
    setNextKey((k) => k + 1);
  }

  const [activeType, setActiveType] = useState<ElementType>("image");

  const updateElement = (key: number, patch: Partial<ElementDraft>) =>
    setElements((prev) => prev.map((el) => (el.key === key ? { ...el, ...patch } : el)));
  const removeElement = (key: number) => setElements((prev) => prev.filter((el) => el.key !== key));
  const duplicateElement = (el: ElementDraft) => {
    setElements((prev) => [...prev, { ...el, key: nextKey, ratio_overrides: { ...el.ratio_overrides } }]);
    setNextKey((k) => k + 1);
  };

  const usedPlatforms = useMemo(
    () => specs.filter((s) => elements.some((el) => el.platforms.includes(s.platform))),
    [specs, elements],
  );

  const settingsFor = (p: string): PlatformSettings =>
    settings[p] ?? { hashtag_count: p === "x" ? 2 : 5, emojis: "moderate", include_cta: true, tone: "" };

  const updateSettings = (p: string, patch: Partial<PlatformSettings>) =>
    setSettings((prev) => ({ ...prev, [p]: { ...settingsFor(p), ...patch } }));

  const [refImages, setRefImages] = useState<File[]>([]);
  const [confirmOpen, setConfirmOpen] = useState(false);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (!clientId) return setError("Select a client.");
    if (elements.length === 0) return setError("Add at least one element to the campaign.");
    if (elements.some((el) => el.platforms.length === 0)) return setError("Every element needs at least one platform.");
    setConfirmOpen(true);
  }

  async function doGenerate() {
    setConfirmOpen(false);
    setSubmitting(true);
    try {
      const payload = {
        client_id: clientId, name, objective, central_theme: theme,
        start_date: startDate || null, end_date: endDate || null, creativity_level: creativity,
        article_id: articleId || null, article_url: articleUrl,
        elements: elements.map((el) => ({
          element_type: el.element_type, theme: el.theme,
          platforms: el.element_type === "text"
            ? el.platforms.filter((p) => !specs.find((s) => s.platform === p)?.requires_media)
            : el.platforms,
          ratio_overrides: el.ratio_overrides, carousel_slides: el.carousel_slides,
          video_duration_seconds: el.video_duration_seconds,
        })),
        platforms: usedPlatforms.map((s) => {
          const d = settingsFor(s.platform);
          return { platform: s.platform, is_active: true, hashtag_count: d.hashtag_count, emojis: d.emojis, include_cta: d.include_cta, tone: d.tone };
        }),
      };
      const created = await api<{ id: string }>("/campaigns", { method: "POST", body: payload });
      for (const file of refImages) {
        const fd = new FormData();
        fd.append("file", file);
        await api(`/campaigns/${created.id}/references`, { method: "POST", formData: fd });
      }
      onCreated(created.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create campaign");
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit}>
      {error && (
        <div className="mb-4 rounded-lg border-l-4 border-red-600 bg-red-50 p-3 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300">{error}</div>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[5fr_7fr]">
        <div className="flex flex-col gap-6">
          <Card>
            <CardHeader><CardTitle className="text-base">Campaign Details</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="cc-client">Client</Label>
                <select id="cc-client" value={clientId} onChange={(e) => setClientId(e.target.value)} required className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring">
                  <option value="">Select…</option>
                  {clients.map((c) => (<option key={c.id} value={c.id}>{c.company_name}</option>))}
                </select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="cc-name">Campaign Name</Label>
                <Input id="cc-name" value={name} onChange={(e) => setName(e.target.value)} required placeholder="Summer Launch 2024" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="cc-obj">Goal</Label>
                <select id="cc-obj" value={objective} onChange={(e) => setObjective(e.target.value as CampaignObjective)} className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring">
                  {OBJECTIVES.map((o) => (<option key={o} value={o}>{o.charAt(0).toUpperCase() + o.slice(1)}</option>))}
                </select>
              </div>
              <div className="space-y-1.5">
                <Label>Platforms</Label>
                <div className="grid grid-cols-3 gap-1.5">
                  {specs.map((s) => {
                    const on = globalPlatforms.includes(s.platform);
                    return (
                      <button key={s.platform} type="button" onClick={() => toggleGlobalPlatform(s.platform, !on)}
                        className={cn(
                          "flex cursor-pointer flex-col items-center justify-center gap-1.5 rounded-lg border-2 px-1 py-2 text-xs transition-all",
                          on ? "border-violet-700 bg-violet-700/5 font-bold text-violet-700" : "border-border font-medium text-muted-foreground",
                        )}>
                        <PlatformIcon platform={s.platform} size={16} color={on ? "#6d28d9" : "#4a4455"} />
                        <span>{platformLabel(s.platform)}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
              <div className="space-y-1.5">
                <Label>Date Range</Label>
                <div className="flex items-center gap-3">
                  <div className="relative flex-1">
                    <CalendarIcon size={16} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
                    <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="h-10 w-full rounded-md border border-input bg-accent pl-9 pr-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring" />
                  </div>
                  <span className="text-sm text-muted-foreground">to</span>
                  <div className="relative flex-1">
                    <CalendarIcon size={16} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
                    <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className="h-10 w-full rounded-md border border-input bg-accent pl-9 pr-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring" />
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle className="text-sm">Central Theme / Concept <span className="font-normal text-muted-foreground">(optional)</span></CardTitle></CardHeader>
            <CardContent>
              <TextareaZoom label="Central theme / concept" rows={3} value={theme} onChange={setTheme} placeholder="e.g. Summer lifestyle campaign focused on outdoor adventures" />
              <div className="mt-3 space-y-1.5">
                <Label>Creativity: {creativity}/10</Label>
                <input type="range" min={1} max={10} value={creativity} onChange={(e) => setCreativity(Number(e.target.value))} className="w-full accent-primary" />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle className="text-sm">Reference Article <span className="font-normal text-muted-foreground">(optional)</span></CardTitle></CardHeader>
            <CardContent className="space-y-3">
              <div className="flex items-center gap-1.5">
                <button type="button" onClick={() => setPickerOpen(true)} className="flex-1 rounded-lg border border-border bg-accent px-3 py-2 text-left text-sm text-muted-foreground">
                  {articleId ? (articles.find((a) => a.id === articleId)?.title ?? "Article selected") : "Choose article…"}
                </button>
                {articleId && (
                  <Button type="button" variant="ghost" size="icon" onClick={() => setArticleId("")}>
                    <X size={14} className="text-red-600" />
                  </Button>
                )}
              </div>
              <Input value={articleUrl} onChange={(e) => setArticleUrl(e.target.value)} placeholder="…or external article URL" />
              {pickerOpen && (
                <ArticlePickerModal articles={articles} onSelect={(a) => { setArticleId(a.id); setPickerOpen(false); }} onClose={() => setPickerOpen(false)} />
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle className="text-sm">Reference Images <span className="font-normal text-muted-foreground">(optional)</span></CardTitle></CardHeader>
            <CardContent>
              <p className="mb-3 text-xs text-muted-foreground">Product photos so generated images match the real subject.</p>
              <div className="flex flex-wrap gap-2">
                {refImages.map((file, i) => (
                  <div key={i} className="relative size-16 overflow-hidden rounded-lg border border-border">
                    <img src={URL.createObjectURL(file)} alt={file.name} className="h-full w-full object-cover" />
                    <button type="button" onClick={() => setRefImages((prev) => prev.filter((_, j) => j !== i))} className="absolute right-0.5 top-0.5 flex size-[18px] items-center justify-center rounded-full bg-black/50 text-xs text-white">✕</button>
                  </div>
                ))}
                <label className="flex size-16 cursor-pointer items-center justify-center rounded-lg border-2 border-dashed border-border text-xl text-muted-foreground">
                  +<input type="file" accept="image/png,image/jpeg,image/webp" hidden multiple
                    onChange={(e) => { const files = Array.from(e.target.files ?? []); setRefImages((prev) => [...prev, ...files]); e.target.value = ""; }} />
                </label>
              </div>
            </CardContent>
          </Card>

          {usedPlatforms.length > 0 && (
            <Card>
              <CardContent className="py-4">
                <button type="button" onClick={() => setShowPlatformSettings((v) => !v)} className="flex items-center gap-1 text-xs font-semibold text-muted-foreground">
                  ⚙ Advanced platform settings {showPlatformSettings ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                </button>
                {showPlatformSettings && (
                  <div className="mt-3 flex flex-col gap-3">
                    {usedPlatforms.map((s) => {
                      const d = settingsFor(s.platform);
                      return (
                        <div key={s.platform} className="rounded-md bg-surface-alt p-3">
                          <strong className="text-sm">{s.label}</strong>
                          <span className="ml-1 text-xs text-muted-foreground"> ({s.char_limit.toLocaleString()} chars)</span>
                          <div className="mt-2 grid grid-cols-2 gap-2">
                            <div className="space-y-1">
                              <Label className="text-[0.65rem]">Hashtags</Label>
                              <Input type="number" min={0} max={30} value={d.hashtag_count} onChange={(e) => updateSettings(s.platform, { hashtag_count: Number(e.target.value) })} />
                            </div>
                            <div className="space-y-1">
                              <Label className="text-[0.65rem]">Emojis</Label>
                              <select value={d.emojis} onChange={(e) => updateSettings(s.platform, { emojis: e.target.value })} className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring">
                                <option value="none">None</option>
                                <option value="moderate">Moderate</option>
                                <option value="abundant">Abundant</option>
                              </select>
                            </div>
                            <div className="col-span-2 space-y-1">
                              <Label className="text-[0.65rem]">Tone (optional)</Label>
                              <Input value={d.tone} onChange={(e) => updateSettings(s.platform, { tone: e.target.value })} />
                            </div>
                            <label className="col-span-2 flex items-center gap-2 text-sm">
                              <input type="checkbox" checked={d.include_cta} onChange={(e) => updateSettings(s.platform, { include_cta: e.target.checked })} className="size-4 accent-primary" />
                              Include CTA
                            </label>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </CardContent>
            </Card>
          )}
        </div>

        <div>
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-base font-semibold">Campaign Elements ({elements.length})</h3>
          </div>

          <div className="mb-3 flex flex-col gap-3">
            {elements.length === 0 && (
              <div className="rounded-xl border-2 border-dashed border-border p-8 text-center">
                <div className="mx-auto mb-3 flex size-12 items-center justify-center rounded-full bg-violet-100 text-violet-700 dark:bg-violet-950/50 dark:text-violet-300">
                  <span className="material-symbols-outlined">post_add</span>
                </div>
                <h4 className="mb-1 text-base font-semibold">Add your first element</h4>
                <p className="text-xs text-muted-foreground">Use the buttons below to add images, carousels, videos, or text.</p>
              </div>
            )}
            {elements.length > 0 && (() => {
              const presentTypes = (Object.keys(ELEMENT_LABELS) as ElementType[]).filter((t) => elements.some((el) => el.element_type === t));
              const current = presentTypes.includes(activeType) ? activeType : presentTypes[0];
              const rows = elements.filter((el) => el.element_type === current);
              return (
                <div>
                  <div className="mb-2 flex flex-wrap gap-1.5">
                    {presentTypes.map((t) => {
                      const on = current === t;
                      const count = elements.filter((el) => el.element_type === t).length;
                      return (
                        <button
                          key={t}
                          type="button"
                          onClick={() => setActiveType(t)}
                          className={cn(
                            "flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-semibold transition-colors",
                            on ? "border-transparent bg-primary text-primary-foreground" : "border-border bg-card text-muted-foreground hover:bg-accent",
                          )}
                        >
                          {ELEMENT_LABELS[t]}
                          <span className={cn("rounded-full px-1.5 text-[0.65rem] font-bold", on ? "bg-white/20 text-primary-foreground" : "bg-primary/10 text-primary")}>
                            {count}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                  <div className="flex flex-col gap-2">
                    {rows.map((el) => (
                      <ElementCard
                        key={el.key} el={el} specs={specs}
                        onChange={(patch) => updateElement(el.key, patch)}
                        onRemove={() => removeElement(el.key)}
                        onDuplicate={() => duplicateElement(el)}
                      />
                    ))}
                  </div>
                </div>
              );
            })()}
          </div>

          <div className="mb-4 flex flex-wrap gap-2">
            {(Object.keys(ELEMENT_LABELS) as ElementType[]).map((t) => (
              <Button key={t} type="button" variant="outline" size="sm" onClick={() => addElement(t)}>
                <Plus size={12} /> {ELEMENT_LABELS[t]}
              </Button>
            ))}
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="ghost" onClick={onCancel}>Cancel</Button>
            <Button type="submit" disabled={submitting} className="shadow-md">
              {submitting ? "Generating…" : "Generate Campaign"}
            </Button>
          </div>
        </div>
      </div>

      {confirmOpen && (
        <CampaignConfirmModal
          clientName={clients.find((c) => c.id === clientId)?.company_name ?? clientId}
          campaignName={name} objective={objective} language="en" creativity={creativity}
          theme={theme} elements={elements} specs={specs}
          articleTitle={articles.find((a) => a.id === articleId)?.title ?? null}
          articleUrl={articleUrl}
          onConfirm={doGenerate} onBack={() => setConfirmOpen(false)}
        />
      )}
    </form>
  );
}

function Card({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn("rounded-xl border border-border bg-card shadow-sm", className)}>{children}</div>;
}
function CardHeader({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn("px-5 pt-4", className)}>{children}</div>;
}
function CardContent({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn("p-5 pt-3", className)}>{children}</div>;
}
function CardTitle({ children, className }: { children: React.ReactNode; className?: string }) {
  return <h3 className={cn("text-base font-semibold", className)}>{children}</h3>;
}

function ElementCard({ el, specs, onChange, onRemove, onDuplicate }: { el: ElementDraft; specs: PlatformSpec[]; onChange: (patch: Partial<ElementDraft>) => void; onRemove: () => void; onDuplicate: () => void; }) {
  const [expanded, setExpanded] = useState(false);
  const [showRatios, setShowRatios] = useState(false);
  const ratios = resolvePlatformRatios(el.platforms, specs, el.ratio_overrides);
  const uniqueRatios = Array.from(new Set(Object.values(ratios)));
  const togglePlatform = (p: string, on: boolean) => {
    const platforms = on ? [...el.platforms, p] : el.platforms.filter((x) => x !== p);
    const overrides = { ...el.ratio_overrides };
    if (!on) delete overrides[p];
    onChange({ platforms, ratio_overrides: overrides });
  };

  return (
    <div className="rounded-lg border border-primary bg-accent p-2.5">
      <div className="mb-2 flex items-center justify-between">
        <div className="flex flex-wrap items-center gap-1.5">
          {el.platforms.length === 0 ? (
            <span className="text-sm text-muted-foreground">No platforms</span>
          ) : (
            el.platforms.map((p) => (
              <span key={p} title={specs.find((s) => s.platform === p)?.label ?? p} className="inline-flex">
                <PlatformIcon platform={p} size={16} color="#6d28d9" />
              </span>
            ))
          )}
          {el.element_type !== "text" && uniqueRatios.length > 0 && (
            <span className="text-sm text-muted-foreground">· {uniqueRatios.join(", ")}</span>
          )}
        </div>
        <div className="flex flex-shrink-0 items-center gap-2">
          <Button type="button" variant="ghost" size="sm" onClick={onDuplicate}><Copy size={12} /> Duplicate</Button>
          <Button type="button" variant="ghost" size="sm" className="text-red-600 hover:bg-red-50 dark:hover:bg-red-950/40" onClick={onRemove}>✕</Button>
          <Button type="button" variant="ghost" size="sm" onClick={() => setExpanded((v) => !v)} aria-label={expanded ? "Collapse" : "Expand"}>
            {expanded ? "▲" : "▼"}
          </Button>
        </div>
      </div>
      <Label className="text-xs">Concept / theme for this element (optional)
        <Input className="mt-1" value={el.theme} onChange={(e) => onChange({ theme: e.target.value })} placeholder="e.g. product close-up with lifestyle background" />
      </Label>
      {expanded && (
        <>
          <div className="mt-2 grid grid-cols-[repeat(auto-fit,minmax(110px,1fr))] gap-3">
            {el.element_type === "carousel" && (
              <div className="space-y-1">
                <Label className="text-xs">Slides</Label>
                <Input type="number" min={2} max={10} value={el.carousel_slides} onChange={(e) => onChange({ carousel_slides: Number(e.target.value) })} />
              </div>
            )}
            {el.element_type === "video" && (
              <div className="space-y-1">
                <Label className="text-xs">Duration (s)</Label>
                <Input type="number" min={1} max={60} value={el.video_duration_seconds} onChange={(e) => onChange({ video_duration_seconds: Number(e.target.value) })} />
              </div>
            )}
          </div>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {specs.map((s) => {
              const blocked = el.element_type === "text" && s.requires_media;
              return (
                <label key={s.platform} className={cn("flex flex-row items-center gap-1.5 text-sm", blocked && "cursor-not-allowed opacity-40")}
                  title={blocked ? `${s.label} requires an image or video — not available for text-only posts` : s.label}>
                  <input type="checkbox" checked={!blocked && el.platforms.includes(s.platform)} disabled={blocked}
                    onChange={(e) => togglePlatform(s.platform, e.target.checked)} className="size-4 accent-primary" />
                  <PlatformIcon platform={s.platform} size={16} color={!blocked && el.platforms.includes(s.platform) ? "#6d28d9" : "#4a4455"} />
                </label>
              );
            })}
          </div>
          {el.platforms.length > 0 && el.element_type !== "text" && (
            <div className="mt-2 flex flex-wrap items-center gap-1.5 text-sm">
              <span className="text-muted-foreground">
                Will generate {uniqueRatios.length} rendition{uniqueRatios.length > 1 ? "s" : ""}:{" "}
                {uniqueRatios.map((r) => <Badge key={r} variant="secondary" className="mr-1.5">{r}</Badge>)}
              </span>
              <Button type="button" variant="ghost" size="sm" onClick={() => setShowRatios((v) => !v)}>
                {showRatios ? "Hide ratios" : "Adjust ratios"}
              </Button>
              {showRatios && (
                <div className="grid w-full grid-cols-[repeat(auto-fit,minmax(110px,1fr))] gap-3">
                  {el.platforms.map((p) => {
                    const spec = specs.find((s) => s.platform === p);
                    if (!spec) return null;
                    return (
                      <div key={p} className="space-y-1">
                        <Label className="text-xs">{spec.label}</Label>
                        <select value={ratios[p]} onChange={(e) => onChange({ ratio_overrides: { ...el.ratio_overrides, [p]: e.target.value } })} className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring">
                          {spec.aspect_ratios.map((r) => (<option key={r} value={r}>{r}</option>))}
                        </select>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function CampaignConfirmModal({ clientName, campaignName, objective, language, creativity, theme, elements, specs, articleTitle, articleUrl, onConfirm, onBack }: { clientName: string; campaignName: string; objective: string; language: string; creativity: number; theme: string; elements: ElementDraft[]; specs: PlatformSpec[]; articleTitle: string | null; articleUrl: string; onConfirm: () => void; onBack: () => void; }) {
  const allPlatforms = Array.from(new Set(elements.flatMap((el) => el.platforms)));

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-slate-900/45 p-6 backdrop-blur-sm" onClick={(e) => { if (e.target === e.currentTarget) onBack(); }}>
      <div className="flex max-h-[88vh] w-full max-w-[520px] flex-col gap-3 overflow-y-auto rounded-xl bg-surface p-6">
        <div className="mb-2 flex items-center justify-between">
          <h2 className="m-0 text-xl font-semibold">Review your campaign</h2>
          <Button type="button" variant="ghost" size="icon" onClick={onBack}><X size={14} /></Button>
        </div>

        <div className="my-2 flex flex-col gap-2">
          <div className="flex items-start gap-2.5 text-sm"><span className="min-w-[90px] flex-shrink-0 pt-px text-muted-foreground">Client</span><span className="font-medium">{clientName}</span></div>
          <div className="flex items-start gap-2.5 text-sm"><span className="min-w-[90px] flex-shrink-0 pt-px text-muted-foreground">Name</span><span className="font-medium">{campaignName || <em className="text-muted-foreground">Untitled</em>}</span></div>
          <div className="flex items-start gap-2.5 text-sm"><span className="min-w-[90px] flex-shrink-0 pt-px text-muted-foreground">Objective</span><span className="font-medium capitalize">{objective}</span></div>
          <div className="flex items-start gap-2.5 text-sm"><span className="min-w-[90px] flex-shrink-0 pt-px text-muted-foreground">Language</span><span className="font-medium">{language} · Creativity {creativity}/10</span></div>
          {theme && <div className="flex items-start gap-2.5 text-sm"><span className="min-w-[90px] flex-shrink-0 pt-px text-muted-foreground">Theme</span><span className="font-medium">{theme}</span></div>}
          <div className="flex items-start gap-2.5 text-sm">
            <span className="min-w-[90px] flex-shrink-0 pt-px text-muted-foreground">Platforms</span>
            <span className="flex flex-wrap gap-1">
              {allPlatforms.map((p) => <Badge key={p} variant="secondary">{platformLabel(p)}</Badge>)}
            </span>
          </div>
        </div>

        <div className="mt-4 border-t border-border pt-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Elements ({elements.length})</div>
        <div className="flex flex-col gap-1.5">
          {elements.map((el, i) => {
            const ratios = resolvePlatformRatios(el.platforms, specs, el.ratio_overrides);
            const uniqueRatios = Array.from(new Set(Object.values(ratios)));
            return (
              <div key={i} className="rounded-md border border-border bg-surface-alt p-2.5">
                <div className="text-sm font-semibold">{ELEMENT_LABELS[el.element_type]}</div>
                <div className="text-xs text-muted-foreground">
                  {el.theme ? `"${el.theme}" · ` : ""}{el.platforms.map(platformLabel).join(", ")}
                  {el.element_type !== "text" && uniqueRatios.length > 0 && ` · ${uniqueRatios.join(", ")}`}
                  {el.element_type === "carousel" && ` · ${el.carousel_slides} slides`}
                  {el.element_type === "video" && ` · ${el.video_duration_seconds}s`}
                </div>
              </div>
            );
          })}
        </div>

        {(articleTitle || articleUrl) && (
          <>
            <div className="mt-4 border-t border-border pt-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Reference article</div>
            <p className="mt-1 text-sm text-muted-foreground">{articleTitle ?? articleUrl}</p>
          </>
        )}

        {!theme && (
          <div className="mt-3 rounded-md border border-amber-300 bg-amber-50 p-2.5 text-sm text-amber-700 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-300">
            ⚠ No central theme set — the AI will infer one from the client profile and objective.
          </div>
        )}

        <div className="mt-3 flex justify-end gap-2 border-t border-border pt-4">
          <Button type="button" variant="secondary" onClick={onBack}>← Go back to edit</Button>
          <Button type="button" onClick={onConfirm}>Confirm &amp; Generate</Button>
        </div>
      </div>
    </div>
  );
}
