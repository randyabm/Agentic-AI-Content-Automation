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

      {/* Filter bar */}
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

      {/* Cards */}
      <div className="card-grid">
        {visible.map((c) => {
          const client = clients.find((cl) => cl.id === c.client_id) ?? null;
          const colors = client?.brand_colors?.length ? client.brand_colors : null;
          return (
          <div key={c.id} className="card client-card client-card-v2">
            {/* Brand color banner — same structure as client cards */}
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
}: {
  clients: Client[];
  defaultClient: string;
  onCreated: (id: string) => void;
}) {
  const [specs, setSpecs] = useState<PlatformSpec[]>([]);
  const [articles, setArticles] = useState<ArticleListItem[]>([]);
  const [clientId, setClientId] = useState(defaultClient || (clients[0]?.id ?? ""));
  const [name, setName] = useState("");
  const [objective, setObjective] = useState<CampaignObjective>("awareness");
  const [theme, setTheme] = useState("");
  const [creativity, setCreativity] = useState(5);
  const [language, setLanguage] = useState("en");
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
        content_language: language,
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

  return (
    <form className="card" onSubmit={handleSubmit}>
      <h2>New campaign</h2>
      {error && <div className="alert alert-error">{error}</div>}
      <div className="form-grid">
        <label>
          Client
          <select value={clientId} onChange={(e) => setClientId(e.target.value)} required>
            <option value="">Select…</option>
            {clients.map((c) => (
              <option key={c.id} value={c.id}>
                {c.company_name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Campaign name
          <Input value={name} onChange={(e) => setName(e.target.value)} required placeholder="Q3 brand push" />
        </label>
        <label>
          Objective
          <select value={objective} onChange={(e) => setObjective(e.target.value as CampaignObjective)}>
            {OBJECTIVES.map((o) => (
              <option key={o} value={o}>
                {o}
              </option>
            ))}
          </select>
        </label>
        <label>
          Content language
          <Input value={language} onChange={(e) => setLanguage(e.target.value)} />
        </label>
        <label>
          Creativity: {creativity}
          <input
            type="range"
            min={1}
            max={10}
            value={creativity}
            onChange={(e) => setCreativity(Number(e.target.value))}
          />
        </label>
      </div>
      <label>
        Central theme / concept (optional)
        <TextareaZoom label="Central theme / concept" rows={2} value={theme} onChange={setTheme} />
      </label>

      <div className="form-grid">
        <label>
          Reference article from library (optional)
          <div style={{ display: "flex", gap: "0.4rem", alignItems: "center" }}>
            <button
              type="button"
              className="article-picker-trigger"
              onClick={() => setPickerOpen(true)}
            >
              {articleId
                ? (articles.find((a) => a.id === articleId)?.title ?? "Article selected")
                : "Choose article…"}
            </button>
            {articleId && (
              <button
                type="button"
                className="btn-icon"
                onClick={() => setArticleId("")}
                aria-label="Clear article"
                title="Clear"
              >
                ✕
              </button>
            )}
          </div>
        </label>
        <label>
          …or external article URL (optional)
          <Input value={articleUrl} onChange={(e) => setArticleUrl(e.target.value)} placeholder="https://…" />
        </label>
      </div>

      {pickerOpen && (
        <ArticlePickerModal
          articles={articles}
          onSelect={(a) => {
            setArticleId(a.id);
            setPickerOpen(false);
          }}
          onClose={() => setPickerOpen(false)}
        />
      )}

      <div className="global-platforms-selector">
        <span className="global-platforms-label">Platforms</span>
        <div className="global-platforms-pills">
          {specs.map((s) => {
            const on = globalPlatforms.includes(s.platform);
            return (
              <button
                key={s.platform}
                type="button"
                className={`platform-pill${on ? " platform-pill-on" : ""}`}
                onClick={() => toggleGlobalPlatform(s.platform, !on)}
              >
                <PlatformIcon platform={s.platform} size={13} color={on ? undefined : "currentColor"} />
                {platformLabel(s.platform)}
              </button>
            );
          })}
        </div>
      </div>

      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "1rem", flexWrap: "wrap", marginBottom: "0.5rem" }}>
        <h3 style={{ margin: 0 }}>Campaign elements</h3>
        <div className="competitor-actions" style={{ margin: 0 }}>
          {(Object.keys(ELEMENT_LABELS) as ElementType[]).map((t) => (
            <Button key={t} type="button" variant="ghost" onClick={() => addElement(t)}>
              + {ELEMENT_LABELS[t]}
            </Button>
          ))}
        </div>
      </div>
      <div className="element-zone">
        {elements.length === 0 && (
          <p className="muted" style={{ margin: 0, padding: "1.25rem", textAlign: "center" }}>
            No elements yet — use the buttons above to add the first one.
          </p>
        )}
        {elements.map((el) => (
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

      <div className="ref-images-section">
        <div className="ref-images-header">
          <span className="ref-images-title">Reference images <span className="muted small">(optional)</span></span>
        </div>
        <p className="muted small" style={{ margin: "0 0 0.6rem" }}>
          Product photos used as visual reference so generated images match the real subject.
        </p>
        <div className="ref-images-row">
          {refImages.map((file, i) => (
            <div key={i} className="ref-thumb">
              <img src={URL.createObjectURL(file)} alt={file.name} />
              <button
                type="button"
                className="ref-thumb-remove"
                onClick={() => setRefImages((prev) => prev.filter((_, j) => j !== i))}
                aria-label="Remove"
              >✕</button>
            </div>
          ))}
          <label className="ref-thumb ref-thumb-add" title="Add image">
            +
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp"
              hidden
              multiple
              onChange={(e) => {
                const files = Array.from(e.target.files ?? []);
                setRefImages((prev) => [...prev, ...files]);
                e.target.value = "";
              }}
            />
          </label>
        </div>
      </div>

      {usedPlatforms.length > 0 && (
        <>
          <button
            type="button"
            className="btn-link muted small"
            onClick={() => setShowPlatformSettings((v) => !v)}
            style={{ display: "inline-flex", alignItems: "center", gap: "0.3rem", background: "none", border: "none", cursor: "pointer", padding: 0, marginTop: "0.25rem" }}
          >
            ⚙ Advanced platform settings {showPlatformSettings ? "▲" : "▼"}
          </button>
          {showPlatformSettings && (
            <div className="platform-config-list" style={{ marginTop: "0.5rem" }}>
              {usedPlatforms.map((s) => {
                const d = settingsFor(s.platform);
                return (
                  <div key={s.platform} className="platform-config enabled">
                    <label className="checkbox-label">
                      <strong>{s.label}</strong>
                      <span className="muted small">({s.char_limit.toLocaleString()} chars)</span>
                    </label>
                    <div className="platform-config-fields">
                      <label>
                        Hashtags
                        <Input
                          type="number"
                          min={0}
                          max={30}
                          value={d.hashtag_count}
                          onChange={(e) => updateSettings(s.platform, { hashtag_count: Number(e.target.value) })}
                        />
                      </label>
                      <label>
                        Emojis
                        <select value={d.emojis} onChange={(e) => updateSettings(s.platform, { emojis: e.target.value })}>
                          <option value="none">None</option>
                          <option value="moderate">Moderate</option>
                          <option value="abundant">Abundant</option>
                        </select>
                      </label>
                      <label>
                        Tone (optional)
                        <Input value={d.tone} onChange={(e) => updateSettings(s.platform, { tone: e.target.value })} />
                      </label>
                      <label className="checkbox-label">
                        <input
                          type="checkbox"
                          checked={d.include_cta}
                          onChange={(e) => updateSettings(s.platform, { include_cta: e.target.checked })}
                        />
                        CTA
                      </label>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}

      <div className="form-actions">
        <Button type="submit" disabled={submitting}>
          {submitting ? "Generating…" : "Generate campaign"}
        </Button>
      </div>

      {confirmOpen && (
        <CampaignConfirmModal
          clientName={clients.find((c) => c.id === clientId)?.company_name ?? clientId}
          campaignName={name}
          objective={objective}
          language={language}
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
      {/* Always visible: header + concept */}
      <div className="card-header">
        <strong>{ELEMENT_LABELS[el.element_type]}</strong>
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

      {/* Collapsed summary */}
      {!expanded && el.platforms.length > 0 && (
        <p className="muted small" style={{ margin: "0.35rem 0 0" }}>
          {el.platforms.map((p) => specs.find((s) => s.platform === p)?.label ?? p).join(", ")}
          {el.element_type !== "text" && uniqueRatios.length > 0 && ` · ${uniqueRatios.join(", ")}`}
        </p>
      )}

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
              <label key={s.platform} className="checkbox-label">
                <input
                  type="checkbox"
                  checked={el.platforms.includes(s.platform)}
                  onChange={(e) => togglePlatform(s.platform, e.target.checked)}
                />
                {s.label}
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
