import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api } from "../api";
import { ArticleContentForm } from "../components/ArticleContentForm";
import type {
  ArticleListItem,
  CampaignListItem,
  CampaignObjective,
  Client,
  PlatformSpec,
  VisualFormat,
} from "../types";

const OBJECTIVES: CampaignObjective[] = [
  "awareness",
  "consideration",
  "conversion",
  "retention",
  "launch",
  "promotion",
];

interface PlatformDraft {
  enabled: boolean;
  num_posts: number;
  images_per_post: number;
  visual_format: VisualFormat;
  carousel_slides: number;
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

export default function Campaigns() {
  const [params] = useSearchParams();
  const clientFilter = params.get("client_id") ?? "";
  const fromArticle = params.get("from_article") ?? "";
  const [campaigns, setCampaigns] = useState<CampaignListItem[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [mode, setMode] = useState<"none" | "campaign" | "article">(fromArticle ? "article" : "none");
  const [error, setError] = useState("");

  async function load() {
    const path = clientFilter ? `/campaigns?client_id=${clientFilter}` : "/campaigns";
    setCampaigns(await api<CampaignListItem[]>(path));
  }

  useEffect(() => {
    load().catch((e) => setError(e.message));
    api<Client[]>("/clients").then(setClients).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientFilter]);

  // Poll while any campaign is still generating.
  useEffect(() => {
    if (!campaigns.some((c) => c.status === "generating")) return;
    const t = setInterval(() => load().catch(() => {}), 4000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [campaigns]);

  const clientName = (id: string) => clients.find((c) => c.id === id)?.company_name ?? "—";

  return (
    <div>
      <div className="page-header">
        <h1>Campaigns</h1>
        <div className="competitor-actions">
          <button
            className={`btn ${mode === "campaign" ? "btn-ghost" : "btn-primary"}`}
            onClick={() => setMode((m) => (m === "campaign" ? "none" : "campaign"))}
          >
            {mode === "campaign" ? "Cancel" : "+ New campaign"}
          </button>
          <button
            className={`btn ${mode === "article" ? "btn-ghost" : "btn-ghost"}`}
            onClick={() => setMode((m) => (m === "article" ? "none" : "article"))}
          >
            {mode === "article" ? "Cancel" : "+ From article"}
          </button>
        </div>
      </div>
      {error && <div className="alert alert-error">{error}</div>}

      {mode === "campaign" && (
        <CreateCampaign
          clients={clients}
          defaultClient={clientFilter}
          onCreated={(id) => {
            setMode("none");
            window.location.assign(`/campaigns/${id}`);
          }}
        />
      )}

      {mode === "article" && (
        <ArticleContentForm
          clients={clients}
          defaultClient={clientFilter}
          initialArticleId={fromArticle}
          onCreated={(id) => {
            setMode("none");
            window.location.assign(`/campaigns/${id}`);
          }}
        />
      )}

      <div className="card-grid">
        {campaigns.map((c) => (
          <Link key={c.id} to={`/campaigns/${c.id}`} className="card client-card">
            <div className="card-header">
              <h3>{c.name}</h3>
              <span className={`tag ${STATUS_TAG[c.status] ?? "tag"}`}>{c.status}</span>
            </div>
            <p className="muted small">{clientName(c.client_id)}</p>
            <p className="small">Objective: {c.objective}</p>
            <p className="muted small">Updated {new Date(c.updated_at).toLocaleString()}</p>
          </Link>
        ))}
        {campaigns.length === 0 && <p className="muted">No campaigns yet. Create your first one.</p>}
      </div>
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
  const [platforms, setPlatforms] = useState<Record<string, PlatformDraft>>({});
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    api<PlatformSpec[]>("/campaigns/platforms").then((s) => {
      setSpecs(s);
      const init: Record<string, PlatformDraft> = {};
      for (const spec of s) {
        init[spec.platform] = {
          enabled: ["instagram", "linkedin"].includes(spec.platform),
          num_posts: 3,
          images_per_post: 1,
          visual_format: "static_image",
          carousel_slides: 3,
          hashtag_count: spec.platform === "x" ? 2 : 5,
          emojis: "moderate",
          include_cta: true,
          tone: "",
        };
      }
      setPlatforms(init);
    });
    api<ArticleListItem[]>("/articles?article_status=active").then(setArticles).catch(() => {});
  }, []);

  const update = (p: string, patch: Partial<PlatformDraft>) =>
    setPlatforms((prev) => ({ ...prev, [p]: { ...prev[p], ...patch } }));

  const anyEnabled = useMemo(() => Object.values(platforms).some((p) => p.enabled), [platforms]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (!clientId) return setError("Select a client.");
    if (!anyEnabled) return setError("Enable at least one platform.");
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
        platforms: specs
          .filter((s) => platforms[s.platform]?.enabled)
          .map((s) => {
            const d = platforms[s.platform];
            return {
              platform: s.platform,
              is_active: true,
              num_posts: d.num_posts,
              images_per_post: d.images_per_post,
              visual_format: d.visual_format,
              carousel_slides: d.carousel_slides,
              hashtag_count: d.hashtag_count,
              emojis: d.emojis,
              include_cta: d.include_cta,
              tone: d.tone,
            };
          }),
      };
      const created = await api<{ id: string }>("/campaigns", { method: "POST", body: payload });
      onCreated(created.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create campaign");
      setSubmitting(false);
    }
  }

  return (
    <form className="card" onSubmit={submit}>
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
          <input value={name} onChange={(e) => setName(e.target.value)} required placeholder="Q3 brand push" />
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
          <input value={language} onChange={(e) => setLanguage(e.target.value)} />
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
        <textarea rows={2} value={theme} onChange={(e) => setTheme(e.target.value)} />
      </label>

      <div className="form-grid">
        <label>
          Reference article from library (optional)
          <select value={articleId} onChange={(e) => setArticleId(e.target.value)}>
            <option value="">None</option>
            {articles.map((a) => (
              <option key={a.id} value={a.id}>
                {a.title}
              </option>
            ))}
          </select>
        </label>
        <label>
          …or external article URL (optional)
          <input value={articleUrl} onChange={(e) => setArticleUrl(e.target.value)} placeholder="https://…" />
        </label>
      </div>

      <h3>Platforms</h3>
      <div className="platform-config-list">
        {specs.map((s) => {
          const d = platforms[s.platform];
          if (!d) return null;
          return (
            <div key={s.platform} className={`platform-config ${d.enabled ? "enabled" : ""}`}>
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={d.enabled}
                  onChange={(e) => update(s.platform, { enabled: e.target.checked })}
                />
                <strong>{s.label}</strong>
                <span className="muted small">({s.char_limit.toLocaleString()} chars)</span>
              </label>
              {d.enabled && (
                <div className="platform-config-fields">
                  <label>
                    Posts
                    <input
                      type="number"
                      min={1}
                      max={20}
                      value={d.num_posts}
                      onChange={(e) => update(s.platform, { num_posts: Number(e.target.value) })}
                    />
                  </label>
                  <label>
                    Format
                    <select
                      value={d.visual_format}
                      onChange={(e) => update(s.platform, { visual_format: e.target.value as VisualFormat })}
                    >
                      {s.formats.map((f) => (
                        <option key={f} value={f}>
                          {f === "static_image" ? "Static image" : "Carousel"}
                        </option>
                      ))}
                    </select>
                  </label>
                  {d.visual_format === "carousel" ? (
                    <label>
                      Slides
                      <input
                        type="number"
                        min={2}
                        max={10}
                        value={d.carousel_slides}
                        onChange={(e) => update(s.platform, { carousel_slides: Number(e.target.value) })}
                      />
                    </label>
                  ) : (
                    <label>
                      Images/post
                      <input
                        type="number"
                        min={1}
                        max={10}
                        value={d.images_per_post}
                        onChange={(e) => update(s.platform, { images_per_post: Number(e.target.value) })}
                      />
                    </label>
                  )}
                  <label>
                    Hashtags
                    <input
                      type="number"
                      min={0}
                      max={30}
                      value={d.hashtag_count}
                      onChange={(e) => update(s.platform, { hashtag_count: Number(e.target.value) })}
                    />
                  </label>
                  <label>
                    Emojis
                    <select value={d.emojis} onChange={(e) => update(s.platform, { emojis: e.target.value })}>
                      <option value="none">None</option>
                      <option value="moderate">Moderate</option>
                      <option value="abundant">Abundant</option>
                    </select>
                  </label>
                  <label className="checkbox-label">
                    <input
                      type="checkbox"
                      checked={d.include_cta}
                      onChange={(e) => update(s.platform, { include_cta: e.target.checked })}
                    />
                    CTA
                  </label>
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="form-actions">
        <button className="btn btn-primary" disabled={submitting}>
          {submitting ? "Generating…" : "Generate campaign"}
        </button>
      </div>
    </form>
  );
}
