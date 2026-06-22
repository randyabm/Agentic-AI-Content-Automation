import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { api } from "../api";
import { ArticleContentForm } from "../components/ArticleContentForm";
import { TextareaZoom } from "../components/TextareaZoom";
import { ArticlePickerModal } from "../components/ArticlePickerModal";
import { ClientAvatar } from "../components/ClientAvatar";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { PlatformIcon, platformLabel } from "../components/PlatformIcon";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
  "awareness",
  "consideration",
  "conversion",
  "retention",
  "launch",
  "promotion",
];

const ELEMENT_LABELS: Record<ElementType, string> = {
  image: "🖼️ Image",
  carousel: "🎠 Carousel",
  video: "🎬 Video",
  text: "✍️ Text only",
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

const STATUS_TAG: Record<string, string> = {
  ready: "tag-green",
  generating: "tag",
  failed: "tag-red",
  draft: "tag",
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

  const [search, setSearch] = useState("");
  const [filterClient, setFilterClient] = useState(initClient);
  const [filterStatus, setFilterStatus] = useState("all");
  const [sortOrder, setSortOrder] = useState<"newest" | "oldest">("newest");
  const [deleteCandidate, setDeleteCandidate] = useState<CampaignListItem | null>(null);
  const [deleteSummary, setDeleteSummary] = useState<{ elements: number; posts: number; images: number; videos: number } | null>(null);
  const [deleting, setDeleting] = useState(false);

  async function load() {
    setCampaigns(await api<CampaignListItem[]>("/campaigns"));
  }

  useEffect(() => {
    load().catch((e) => setError(e.message));
    api<Client[]>("/clients").then(setClients).catch(() => {});
  }, []);

  useEffect(() => {
    if (!campaigns.some((c) => c.status === "generating" || c.visuals_generating)) return;
    const t = setInterval(() => load().catch(() => {}), 4000);
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
    api<{ elements: number; posts: number; images: number; videos: number }>(
      `/campaigns/${c.id}/deletion-summary`
    )
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
      <div className="page-header">
        <h1>Campaigns</h1>
        <div className="competitor-actions">
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
      {error && <div className="alert alert-error">{error}</div>}

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
      <div className="campaign-filter-bar">
        <div className="campaign-filter-search">
          <Input
            placeholder="Search campaigns…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ margin: 0 }}
          />
        </div>
        <select
          className="campaign-filter-select"
          value={filterClient}
          onChange={(e) => setFilterClient(e.target.value)}
        >
          <option value="">All clients</option>
          {clients.map((c) => (
            <option key={c.id} value={c.id}>{c.company_name}</option>
          ))}
        </select>
        <div className="status-filter-pills">
          {["all", "ready", "generating", "failed"].map((s) => (
            <button
              key={s}
              className={`status-filter-pill${filterStatus === s ? " active" : ""}`}
              onClick={() => setFilterStatus(s)}
            >
              {STATUS_LABELS[s]}{statusCounts[s] ? ` (${statusCounts[s]})` : ""}
            </button>
          ))}
        </div>
        <select
          className="campaign-filter-select"
          value={sortOrder}
          onChange={(e) => setSortOrder(e.target.value as "newest" | "oldest")}
        >
          <option value="newest">Newest first</option>
          <option value="oldest">Oldest first</option>
        </select>
      </div>

      <div className="card-grid">
        {visible.map((c) => {
          const client = clients.find((cl) => cl.id === c.client_id) ?? null;
          const colors = client?.brand_colors?.length ? client.brand_colors : null;
          const ab = (c as any).approval_status ? APPROVAL_BADGE[(c as any).approval_status] : null;
          return (
          <div key={c.id} className="card client-card client-card-v2" style={{ borderRadius: "12px", overflow: "hidden" }}>
            <div
              className="client-card-banner"
              style={colors ? { background: `linear-gradient(135deg, ${colors.slice(0, 3).join(", ")})` } : undefined}
            >
              <div className="campaign-card-badges">
                <span className={`tag ${STATUS_TAG[c.status] ?? "tag"}`}>{c.status}</span>
                {c.status !== "generating" && c.visuals_generating && (
                  <span className="tag" style={{ fontSize: "0.75rem" }}>⏳ Visuals</span>
                )}
              </div>
            </div>

            <Link to={`/campaigns/${c.id}`} className="client-card-body">
              <div className="client-card-avatar-wrap">
                {client && <ClientAvatar client={client} />}
              </div>
              <h3 className="client-card-name">{c.name}</h3>
              <p className="muted small" style={{ margin: "0 0 0.45rem", color: "var(--primary)", fontWeight: 500 }}>
                {clientName(c.client_id)}
              </p>
              <div className="campaign-card-meta">
                <span className={`objective-badge objective-${c.objective}`}>{c.objective}</span>
                {ab && (
                  <span className="px-2 py-0.5 text-[10px] font-bold rounded-full" style={{ background: ab.bg, color: ab.text }}>
                    {ab.label}
                  </span>
                )}
                <span className="muted small">{new Date(c.updated_at).toLocaleDateString()}</span>
              </div>
            </Link>

            <button
              className="client-card-delete-v2 campaign-card-delete-v2"
              onClick={() => openDeleteDialog(c)}
              title="Delete campaign"
              aria-label="Delete campaign"
            >
              🗑
            </button>
          </div>
          );
        })}
        {visible.length === 0 && campaigns.length > 0 && (
          <p className="muted">No campaigns match the current filters.</p>
        )}
        {campaigns.length === 0 && (
          <p className="muted">No campaigns yet. Create your first one.</p>
        )}
      </div>
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
            <ul className="deletion-summary-list">
              {deleteSummary.elements > 0 && <li>{deleteSummary.elements} element{deleteSummary.elements !== 1 ? "s" : ""}</li>}
              {deleteSummary.posts > 0 && <li>{deleteSummary.posts} post{deleteSummary.posts !== 1 ? "s" : ""} (copy)</li>}
              {deleteSummary.images > 0 && <li>{deleteSummary.images} generated image{deleteSummary.images !== 1 ? "s" : ""}</li>}
              {deleteSummary.videos > 0 && <li>{deleteSummary.videos} generated video{deleteSummary.videos !== 1 ? "s" : ""}</li>}
            </ul>
          ) : (
            <p className="muted small">Loading details…</p>
          )}
          <p className="muted small">This action cannot be undone.</p>
        </ConfirmDialog>
      )}
    </div>
  );
}

function CreateCampaign({
  clients,
  defaultClient,
  onCreated,
  onCancel,
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
    setElements((prev) => [
      ...prev,
      {
        key: nextKey,
        element_type: type,
        theme: "",
        platforms: [...globalPlatforms],
        ratio_overrides: {},
        carousel_slides: 3,
        video_duration_seconds: 8,
      },
    ]);
    setNextKey((k) => k + 1);
  }

  const [collapsedTypes, setCollapsedTypes] = useState<Set<ElementType>>(new Set());
  const toggleType = (t: ElementType) =>
    setCollapsedTypes((prev) => {
      const next = new Set(prev);
      next.has(t) ? next.delete(t) : next.add(t);
      return next;
    });

  const updateElement = (key: number, patch: Partial<ElementDraft>) =>
    setElements((prev) => prev.map((el) => (el.key === key ? { ...el, ...patch } : el)));

  const removeElement = (key: number) => setElements((prev) => prev.filter((el) => el.key !== key));

  const duplicateElement = (el: ElementDraft) => {
    setElements((prev) => [...prev, { ...el, key: nextKey, ratio_overrides: { ...el.ratio_overrides } }]);
    setNextKey((k) => k + 1);
  };

  // Platforms used by at least one element — these get a settings panel.
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
    if (elements.some((el) => el.platforms.length === 0))
      return setError("Every element needs at least one platform.");
    setConfirmOpen(true);
  }

  async function doGenerate() {
    setConfirmOpen(false);
    setSubmitting(true);
    try {
      const payload = {
        client_id: clientId,
        name,
        objective,
        central_theme: theme,
        start_date: startDate || null,
        end_date: endDate || null,
        creativity_level: creativity,
        article_id: articleId || null,
        article_url: articleUrl,
        elements: elements.map((el) => ({
          element_type: el.element_type,
          theme: el.theme,
          platforms: el.platforms,
          ratio_overrides: el.ratio_overrides,
          carousel_slides: el.carousel_slides,
          video_duration_seconds: el.video_duration_seconds,
        })),
        platforms: usedPlatforms.map((s) => {
          const d = settingsFor(s.platform);
          return {
            platform: s.platform,
            is_active: true,
            hashtag_count: d.hashtag_count,
            emojis: d.emojis,
            include_cta: d.include_cta,
            tone: d.tone,
          };
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

  const cLabel = (s: string) => specs.find((p) => p.platform === s)?.label ?? s;

  return (
    <form onSubmit={handleSubmit}>
      {error && <div className="alert alert-error">{error}</div>}

      {/* ===== TWO-COLUMN LAYOUT (CONCEPT UI) ===== */}
      <div style={{ display: "grid", gridTemplateColumns: "5fr 7fr", gap: "1.5rem", alignItems: "start" }}>

        {/* ===== LEFT COLUMN: Campaign Details ===== */}
        <div style={{ display: "flex", flexDirection: "column", gap: "1.5rem" }}>

          {/* Campaign Details card */}
          <div style={{ background: "white", borderRadius: "12px", border: "1px solid #e5e7eb", padding: "1.5rem", boxShadow: "0 1px 3px rgba(0,0,0,0.05)" }}>
            <h3 style={{ fontSize: "1.1rem", fontWeight: 600, margin: "0 0 1rem", color: "#141b2b" }}>Campaign Details</h3>
            <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
              {/* Client */}
              <div>
                <label style={{ fontSize: "0.7rem", fontWeight: 600, color: "#4a4455", textTransform: "uppercase", letterSpacing: "0.05em", display: "block", marginBottom: "0.35rem" }}>Client</label>
                <select value={clientId} onChange={(e) => setClientId(e.target.value)} required
                  style={{ width: "100%", padding: "0.65rem 0.75rem", border: "1px solid #ccc3d7", borderRadius: "8px", fontSize: "0.85rem", background: "white", color: "#141b2b" }}>
                  <option value="">Select…</option>
                  {clients.map((c) => (<option key={c.id} value={c.id}>{c.company_name}</option>))}
                </select>
              </div>
              {/* Campaign Name */}
              <div>
                <label style={{ fontSize: "0.7rem", fontWeight: 600, color: "#4a4455", textTransform: "uppercase", letterSpacing: "0.05em", display: "block", marginBottom: "0.35rem" }}>Campaign Name</label>
                <Input value={name} onChange={(e) => setName(e.target.value)} required placeholder="Summer Launch 2024" />
              </div>
              {/* Goal */}
              <div>
                <label style={{ fontSize: "0.7rem", fontWeight: 600, color: "#4a4455", textTransform: "uppercase", letterSpacing: "0.05em", display: "block", marginBottom: "0.35rem" }}>Goal</label>
                <select value={objective} onChange={(e) => setObjective(e.target.value as CampaignObjective)}
                  style={{ width: "100%", padding: "0.65rem 0.75rem", border: "1px solid #ccc3d7", borderRadius: "8px", fontSize: "0.85rem", background: "white", color: "#141b2b" }}>
                  {OBJECTIVES.map((o) => (<option key={o} value={o}>{o.charAt(0).toUpperCase() + o.slice(1)}</option>))}
                </select>
              </div>
              {/* Platforms */}
              <div>
                <label style={{ fontSize: "0.7rem", fontWeight: 600, color: "#4a4455", textTransform: "uppercase", letterSpacing: "0.05em", display: "block", marginBottom: "0.35rem" }}>Platforms</label>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "0.4rem" }}>
                  {specs.map((s) => {
                    const on = globalPlatforms.includes(s.platform);
                    return (
                      <button key={s.platform} type="button" onClick={() => toggleGlobalPlatform(s.platform, !on)}
                        style={{
                          display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: "0.4rem",
                          padding: "0.6rem 0.25rem", borderRadius: "10px", border: on ? "2px solid #6d28d9" : "2px solid #ccc3d7",
                          background: on ? "rgba(109,40,217,0.05)" : "white", cursor: "pointer", transition: "all 0.15s",
                          fontWeight: on ? 700 : 500, color: on ? "#6d28d9" : "#4a4455",
                        }}>
                        <PlatformIcon platform={s.platform} size={16} color={on ? "#6d28d9" : "#4a4455"} />
                        <span style={{ fontSize: "0.7rem" }}>{platformLabel(s.platform)}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
              {/* Date Range */}
              <div>
                <label style={{ fontSize: "0.7rem", fontWeight: 600, color: "#4a4455", textTransform: "uppercase", letterSpacing: "0.05em", display: "block", marginBottom: "0.35rem" }}>Date Range</label>
                <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
                  <div style={{ position: "relative", flex: 1 }}>
                    <span className="material-symbols-outlined" style={{ position: "absolute", left: "10px", top: "50%", transform: "translateY(-50%)", color: "#4a4455", fontSize: "16px" }}>calendar_today</span>
                    <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)}
                      style={{ width: "100%", padding: "0.65rem 0.75rem 0.65rem 2.2rem", border: "1px solid #ccc3d7", borderRadius: "8px", fontSize: "0.85rem", background: "#f1f3ff", color: "#141b2b" }} />
                  </div>
                  <span style={{ color: "#4a4455", fontSize: "0.85rem" }}>to</span>
                  <div style={{ position: "relative", flex: 1 }}>
                    <span className="material-symbols-outlined" style={{ position: "absolute", left: "10px", top: "50%", transform: "translateY(-50%)", color: "#4a4455", fontSize: "16px" }}>calendar_today</span>
                    <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)}
                      style={{ width: "100%", padding: "0.65rem 0.75rem 0.65rem 2.2rem", border: "1px solid #ccc3d7", borderRadius: "8px", fontSize: "0.85rem", background: "#f1f3ff", color: "#141b2b" }} />
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Central Theme */}
          <div style={{ background: "white", borderRadius: "12px", border: "1px solid #e5e7eb", padding: "1.5rem", boxShadow: "0 1px 3px rgba(0,0,0,0.05)" }}>
            <h4 style={{ fontSize: "0.85rem", fontWeight: 600, margin: "0 0 0.75rem", color: "#141b2b" }}>Central Theme / Concept <span style={{ fontWeight: 400, color: "#4a4455" }}>(optional)</span></h4>
            <TextareaZoom label="Central theme / concept" rows={3} value={theme} onChange={setTheme} placeholder="e.g. Summer lifestyle campaign focused on outdoor adventures" />
            <div style={{ marginTop: "0.75rem" }}>
              <label style={{ fontSize: "0.7rem", fontWeight: 600, color: "#4a4455", textTransform: "uppercase", letterSpacing: "0.05em", display: "block", marginBottom: "0.35rem" }}>Creativity: {creativity}/10</label>
              <input type="range" min={1} max={10} value={creativity} onChange={(e) => setCreativity(Number(e.target.value))}
                style={{ width: "100%" }} />
            </div>
          </div>

          {/* Reference Article */}
          <div style={{ background: "white", borderRadius: "12px", border: "1px solid #e5e7eb", padding: "1.5rem", boxShadow: "0 1px 3px rgba(0,0,0,0.05)" }}>
            <h4 style={{ fontSize: "0.85rem", fontWeight: 600, margin: "0 0 0.75rem", color: "#141b2b" }}>Reference Article <span style={{ fontWeight: 400, color: "#4a4455" }}>(optional)</span></h4>
            <div style={{ display: "flex", gap: "0.4rem", alignItems: "center", marginBottom: "0.6rem" }}>
              <button type="button" onClick={() => setPickerOpen(true)}
                style={{ padding: "0.5rem 0.75rem", background: "#f1f3ff", border: "1px solid #ccc3d7", borderRadius: "8px", fontSize: "0.8rem", cursor: "pointer", color: "#4a4455", flex: 1, textAlign: "left" }}>
                {articleId ? (articles.find((a) => a.id === articleId)?.title ?? "Article selected") : "Choose article…"}
              </button>
              {articleId && (
                <button type="button" onClick={() => setArticleId("")} style={{ padding: "0.4rem", background: "none", border: "none", cursor: "pointer", color: "#dc2626" }}>✕</button>
              )}
            </div>
            <Input value={articleUrl} onChange={(e) => setArticleUrl(e.target.value)} placeholder="…or external article URL" />
            {pickerOpen && (
              <ArticlePickerModal articles={articles} onSelect={(a) => { setArticleId(a.id); setPickerOpen(false); }} onClose={() => setPickerOpen(false)} />
            )}
          </div>

          {/* Reference Images */}
          <div style={{ background: "white", borderRadius: "12px", border: "1px solid #e5e7eb", padding: "1.5rem", boxShadow: "0 1px 3px rgba(0,0,0,0.05)" }}>
            <h4 style={{ fontSize: "0.85rem", fontWeight: 600, margin: "0 0 0.25rem", color: "#141b2b" }}>Reference Images <span style={{ fontWeight: 400, color: "#4a4455" }}>(optional)</span></h4>
            <p style={{ fontSize: "0.75rem", color: "#4a4455", margin: "0 0 0.75rem" }}>Product photos so generated images match the real subject.</p>
            <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
              {refImages.map((file, i) => (
                <div key={i} style={{ width: "4rem", height: "4rem", borderRadius: "8px", overflow: "hidden", position: "relative", border: "1px solid #e5e7eb" }}>
                  <img src={URL.createObjectURL(file)} alt={file.name} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                  <button type="button" onClick={() => setRefImages((prev) => prev.filter((_, j) => j !== i))}
                    style={{ position: "absolute", top: "2px", right: "2px", width: "18px", height: "18px", borderRadius: "50%", background: "rgba(0,0,0,0.5)", color: "white", border: "none", fontSize: "10px", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>✕</button>
                </div>
              ))}
              <label style={{ width: "4rem", height: "4rem", borderRadius: "8px", border: "2px dashed #ccc3d7", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", color: "#4a4455", fontSize: "1.5rem" }}>
                +<input type="file" accept="image/png,image/jpeg,image/webp" hidden multiple
                  onChange={(e) => { const files = Array.from(e.target.files ?? []); setRefImages((prev) => [...prev, ...files]); e.target.value = ""; }} />
              </label>
            </div>
          </div>

          {/* Advanced Platform Settings */}
          {usedPlatforms.length > 0 && (
            <div style={{ background: "white", borderRadius: "12px", border: "1px solid #e5e7eb", padding: "1.5rem", boxShadow: "0 1px 3px rgba(0,0,0,0.05)" }}>
              <button type="button" onClick={() => setShowPlatformSettings((v) => !v)}
                style={{ display: "flex", alignItems: "center", gap: "0.3rem", background: "none", border: "none", cursor: "pointer", padding: 0, color: "#4a4455", fontSize: "0.8rem", fontWeight: 600 }}>
                ⚙ Advanced platform settings {showPlatformSettings ? "▲" : "▼"}
              </button>
              {showPlatformSettings && (
                <div style={{ marginTop: "0.75rem", display: "flex", flexDirection: "column", gap: "0.75rem" }}>
                  {usedPlatforms.map((s) => {
                    const d = settingsFor(s.platform);
                    return (
                      <div key={s.platform} style={{ padding: "0.75rem", background: "#f9fafb", borderRadius: "8px" }}>
                        <strong style={{ fontSize: "0.85rem", color: "#141b2b" }}>{s.label}</strong>
                        <span style={{ fontSize: "0.75rem", color: "#4a4455" }}> ({s.char_limit.toLocaleString()} chars)</span>
                        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.5rem", marginTop: "0.5rem" }}>
                          <div>
                            <label style={{ fontSize: "0.65rem", color: "#4a4455", display: "block" }}>Hashtags</label>
                            <Input type="number" min={0} max={30} value={d.hashtag_count}
                              onChange={(e) => updateSettings(s.platform, { hashtag_count: Number(e.target.value) })} />
                          </div>
                          <div>
                            <label style={{ fontSize: "0.65rem", color: "#4a4455", display: "block" }}>Emojis</label>
                            <select value={d.emojis} onChange={(e) => updateSettings(s.platform, { emojis: e.target.value })}
                              style={{ width: "100%", padding: "0.5rem", border: "1px solid #e5e7eb", borderRadius: "6px", fontSize: "0.8rem", background: "white" }}>
                              <option value="none">None</option>
                              <option value="moderate">Moderate</option>
                              <option value="abundant">Abundant</option>
                            </select>
                          </div>
                          <div style={{ gridColumn: "1 / -1" }}>
                            <label style={{ fontSize: "0.65rem", color: "#4a4455", display: "block" }}>Tone (optional)</label>
                            <Input value={d.tone} onChange={(e) => updateSettings(s.platform, { tone: e.target.value })} />
                          </div>
                          <div>
                            <label style={{ display: "flex", alignItems: "center", gap: "0.4rem", fontSize: "0.8rem", color: "#4a4455", cursor: "pointer" }}>
                              <input type="checkbox" checked={d.include_cta} onChange={(e) => updateSettings(s.platform, { include_cta: e.target.checked })} />
                              Include CTA
                            </label>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>

        {/* ===== RIGHT COLUMN: Campaign Elements ===== */}
        <div>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "0.75rem" }}>
            <h3 style={{ fontSize: "1.1rem", fontWeight: 600, margin: 0, color: "#141b2b" }}>Campaign Elements ({elements.length})</h3>
          </div>

          {/* Element list */}
          <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem", marginBottom: "0.75rem" }}>
            {elements.length === 0 && (
              <div style={{ background: "white", borderRadius: "12px", border: "2px dashed #ccc3d7", padding: "2rem", textAlign: "center" }}>
                <div style={{ width: "3rem", height: "3rem", borderRadius: "50%", background: "#e1e8fd", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 0.75rem", color: "#6d28d9" }}>
                  <span className="material-symbols-outlined">post_add</span>
                </div>
                <h4 style={{ fontSize: "1rem", fontWeight: 600, margin: "0 0 0.25rem", color: "#141b2b" }}>Add your first element</h4>
                <p style={{ fontSize: "0.8rem", color: "#4a4455", margin: 0 }}>Use the buttons below to add images, carousels, videos, or text.</p>
              </div>
            )}
            {(Object.keys(ELEMENT_LABELS) as ElementType[]).map((type) => {
              const group = elements.filter((el) => el.element_type === type);
              if (group.length === 0) return null;
              const collapsed = collapsedTypes.has(type);
              return (
                <div key={type} className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
                  <button
                    type="button"
                    onClick={() => toggleType(type)}
                    className="flex w-full items-center justify-between bg-accent px-4 py-2.5 text-left"
                  >
                    <span className="flex items-center gap-2 text-sm font-semibold text-foreground">
                      {ELEMENT_LABELS[type]}
                      <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-bold text-primary">{group.length}</span>
                    </span>
                    <span className="text-xs text-muted-foreground">{collapsed ? "▶" : "▼"}</span>
                  </button>
                  {!collapsed && (
                    <div className="flex flex-col gap-2 p-2">
                      {group.map((el) => (
                        <ElementCard
                          key={el.key}
                          el={el}
                          specs={specs}
                          onChange={(patch) => updateElement(el.key, patch)}
                          onRemove={() => removeElement(el.key)}
                          onDuplicate={() => duplicateElement(el)}
                        />
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* Add Element buttons */}
          <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem", marginBottom: "1rem" }}>
            {(Object.keys(ELEMENT_LABELS) as ElementType[]).map((t) => (
              <button key={t} type="button" onClick={() => addElement(t)}
                style={{
                  padding: "0.5rem 0.75rem", borderRadius: "8px", border: "1px solid #ccc3d7", background: "white",
                  cursor: "pointer", fontSize: "0.75rem", fontWeight: 600, color: "#4a4455",
                  display: "flex", alignItems: "center", gap: "0.3rem", transition: "all 0.15s",
                }}>
                + {ELEMENT_LABELS[t]}
              </button>
            ))}
          </div>

          {/* Generate button */}
          <div style={{ display: "flex", justifyContent: "flex-end", gap: "0.5rem", paddingTop: "0.5rem" }}>
            <button type="button" onClick={onCancel}
              style={{ padding: "0.65rem 1.5rem", borderRadius: "8px", border: "1px solid #ccc3d7", background: "white", cursor: "pointer", fontSize: "0.85rem", fontWeight: 600, color: "#4a4455" }}>
              Cancel
            </button>
            <button type="submit" disabled={submitting}
              style={{
                padding: "0.65rem 1.5rem", borderRadius: "8px", border: "none", background: "#6d28d9", color: "white",
                cursor: submitting ? "not-allowed" : "pointer", fontSize: "0.85rem", fontWeight: 600, opacity: submitting ? 0.7 : 1,
                boxShadow: "0 4px 6px -1px rgba(0,0,0,0.1)",
              }}>
              {submitting ? "Generating…" : "Generate Campaign"}
            </button>
          </div>
        </div>
      </div>

      {confirmOpen && (
        <CampaignConfirmModal
          clientName={clients.find((c) => c.id === clientId)?.company_name ?? clientId}
          campaignName={name}
          objective={objective}
          language="en"
          creativity={creativity}
          theme={theme}
          elements={elements}
          specs={specs}
          articleTitle={articles.find((a) => a.id === articleId)?.title ?? null}
          articleUrl={articleUrl}
          onConfirm={doGenerate}
          onBack={() => setConfirmOpen(false)}
        />
      )}
    </form>
  );
}

function ElementCard({
  el,
  specs,
  onChange,
  onRemove,
  onDuplicate,
}: {
  el: ElementDraft;
  specs: PlatformSpec[];
  onChange: (patch: Partial<ElementDraft>) => void;
  onRemove: () => void;
  onDuplicate: () => void;
}) {
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
    <div className="platform-config enabled element-card">
      {/* Always visible: platform-icon summary + actions */}
      <div className="card-header">
        <div className="flex flex-wrap items-center gap-1.5">
          {el.platforms.length === 0 ? (
            <span className="muted small">No platforms</span>
          ) : (
            el.platforms.map((p) => (
              <span key={p} title={specs.find((s) => s.platform === p)?.label ?? p} className="inline-flex">
                <PlatformIcon platform={p} size={16} color="#6d28d9" />
              </span>
            ))
          )}
          {el.element_type !== "text" && uniqueRatios.length > 0 && (
            <span className="muted small">· {uniqueRatios.join(", ")}</span>
          )}
        </div>
        <div className="competitor-actions">
          <Button type="button" variant="ghost" size="sm" onClick={onDuplicate}>Duplicate</Button>
          <Button type="button" variant="ghost" size="sm" className="text-destructive hover:bg-destructive/10 hover:text-destructive" onClick={onRemove}>✕</Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setExpanded((v) => !v)}
            aria-label={expanded ? "Collapse" : "Expand"}
            title={expanded ? "Collapse details" : "Expand details"}
          >
            {expanded ? "▲" : "▼"}
          </Button>
        </div>
      </div>

      <label className="small" style={{ marginTop: "0.4rem" }}>
        Concept / theme for this element (optional)
        <Input
          value={el.theme}
          onChange={(e) => onChange({ theme: e.target.value })}
          placeholder="e.g. product close-up with lifestyle background"
        />
      </label>

      {/* Expanded details */}
      {expanded && (
        <>
          <div className="platform-config-fields" style={{ marginTop: "0.5rem" }}>
            {el.element_type === "carousel" && (
              <label>
                Slides
                <Input type="number" min={2} max={10} value={el.carousel_slides}
                  onChange={(e) => onChange({ carousel_slides: Number(e.target.value) })} />
              </label>
            )}
            {el.element_type === "video" && (
              <label>
                Duration (s)
                <Input type="number" min={1} max={60} value={el.video_duration_seconds}
                  onChange={(e) => onChange({ video_duration_seconds: Number(e.target.value) })} />
              </label>
            )}
          </div>

          <div className="element-platforms">
            {specs.map((s) => (
              <label key={s.platform} className="checkbox-label" title={s.label}>
                <input
                  type="checkbox"
                  checked={el.platforms.includes(s.platform)}
                  onChange={(e) => togglePlatform(s.platform, e.target.checked)}
                />
                <PlatformIcon platform={s.platform} size={16} color={el.platforms.includes(s.platform) ? "#6d28d9" : "#4a4455"} />
              </label>
            ))}
          </div>

          {el.platforms.length > 0 && el.element_type !== "text" && (
            <div className="element-ratios small">
              <span className="muted">
                Will generate {uniqueRatios.length} rendition{uniqueRatios.length > 1 ? "s" : ""}:{" "}
                {uniqueRatios.map((r) => (
                  <span key={r} className="tag" style={{ marginRight: "0.3rem" }}>{r}</span>
                ))}
              </span>
              <Button type="button" variant="ghost" size="sm" onClick={() => setShowRatios((v) => !v)}>
                {showRatios ? "Hide ratios" : "Adjust ratios"}
              </Button>
              {showRatios && (
                <div className="platform-config-fields">
                  {el.platforms.map((p) => {
                    const spec = specs.find((s) => s.platform === p);
                    if (!spec) return null;
                    return (
                      <label key={p}>
                        {spec.label}
                        <select value={ratios[p]}
                          onChange={(e) => onChange({ ratio_overrides: { ...el.ratio_overrides, [p]: e.target.value } })}>
                          {spec.aspect_ratios.map((r) => (
                            <option key={r} value={r}>{r}</option>
                          ))}
                        </select>
                      </label>
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

function CampaignConfirmModal({
  clientName,
  campaignName,
  objective,
  language,
  creativity,
  theme,
  elements,
  specs,
  articleTitle,
  articleUrl,
  onConfirm,
  onBack,
}: {
  clientName: string;
  campaignName: string;
  objective: string;
  language: string;
  creativity: number;
  theme: string;
  elements: ElementDraft[];
  specs: PlatformSpec[];
  articleTitle: string | null;
  articleUrl: string;
  onConfirm: () => void;
  onBack: () => void;
}) {
  const platformLabel = (p: string) => specs.find((s) => s.platform === p)?.label ?? p;

  const allPlatforms = Array.from(new Set(elements.flatMap((el) => el.platforms)));

  return (
    <div className="modal-overlay" onClick={(e) => { if (e.target === e.currentTarget) onBack(); }}>
      <div className="modal campaign-confirm-modal">
        <div className="modal-header">
          <h2>Review your campaign</h2>
          <button type="button" className="btn-icon" onClick={onBack} aria-label="Close">✕</button>
        </div>

        <div className="confirm-rows">
          <div className="confirm-row"><span className="confirm-key">Client</span><span className="confirm-val">{clientName}</span></div>
          <div className="confirm-row"><span className="confirm-key">Name</span><span className="confirm-val">{campaignName || <em className="muted">Untitled</em>}</span></div>
          <div className="confirm-row"><span className="confirm-key">Objective</span><span className="confirm-val" style={{ textTransform: "capitalize" }}>{objective}</span></div>
          <div className="confirm-row"><span className="confirm-key">Language</span><span className="confirm-val">{language} · Creativity {creativity}/10</span></div>
          {theme && <div className="confirm-row"><span className="confirm-key">Theme</span><span className="confirm-val">{theme}</span></div>}
          <div className="confirm-row">
            <span className="confirm-key">Platforms</span>
            <span className="confirm-val" style={{ display: "flex", flexWrap: "wrap", gap: "0.3rem" }}>
              {allPlatforms.map((p) => <span key={p} className="tag">{platformLabel(p)}</span>)}
            </span>
          </div>
        </div>

        <div className="confirm-section-title">Elements ({elements.length})</div>
        <div className="confirm-elements">
          {elements.map((el, i) => {
            const ratios = resolvePlatformRatios(el.platforms, specs, el.ratio_overrides);
            const uniqueRatios = Array.from(new Set(Object.values(ratios)));
            return (
              <div key={i} className="confirm-element-row">
                <span className="confirm-el-type">{ELEMENT_LABELS[el.element_type]}</span>
                <span className="confirm-el-detail muted small">
                  {el.theme ? `"${el.theme}" · ` : ""}
                  {el.platforms.map(platformLabel).join(", ")}
                  {el.element_type !== "text" && uniqueRatios.length > 0 && ` · ${uniqueRatios.join(", ")}`}
                  {el.element_type === "carousel" && ` · ${el.carousel_slides} slides`}
                  {el.element_type === "video" && ` · ${el.video_duration_seconds}s`}
                </span>
              </div>
            );
          })}
        </div>

        {(articleTitle || articleUrl) && (
          <>
            <div className="confirm-section-title">Reference article</div>
            <p className="muted small" style={{ margin: "0.25rem 0 0" }}>
              {articleTitle ?? articleUrl}
            </p>
          </>
        )}

        {!theme && (
          <div className="confirm-warning">
            ⚠ No central theme set — the AI will infer one from the client profile and objective.
          </div>
        )}

        <div className="modal-actions" style={{ display: "flex", justifyContent: "flex-end", gap: "0.5rem" }}>
          <Button type="button" variant="secondary" onClick={onBack}>← Go back to edit</Button>
          <Button type="button" onClick={onConfirm}>Confirm &amp; Generate</Button>
        </div>
      </div>
    </div>
  );
}
