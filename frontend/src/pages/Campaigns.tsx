import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api } from "../api";
import { ArticleContentForm } from "../components/ArticleContentForm";
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

  // Poll while any campaign is generating — or still rendering its visuals.
  useEffect(() => {
    if (!campaigns.some((c) => c.status === "generating" || c.visuals_generating)) return;
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
            {c.status !== "generating" && c.visuals_generating && (
              <p className="small tag" style={{ display: "inline-block" }}>
                ⏳ Generating visuals…
              </p>
            )}
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
  const [elements, setElements] = useState<ElementDraft[]>([]);
  const [nextKey, setNextKey] = useState(1);
  const [settings, setSettings] = useState<Record<string, PlatformSettings>>({});
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

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
        platforms: ["instagram", "linkedin"],
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

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (!clientId) return setError("Select a client.");
    if (elements.length === 0) return setError("Add at least one element to the campaign.");
    if (elements.some((el) => el.platforms.length === 0))
      return setError("Every element needs at least one platform.");
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

      <h3>Campaign elements</h3>
      <p className="muted small">
        Each element is one piece of content (an image, a carousel, a video, or a text-only post). Tick the
        platforms it should be published to — the same visual is reused across them, generating one rendition
        per required aspect ratio.
      </p>
      <div className="element-list">
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
        {elements.length === 0 && <p className="muted">No elements yet — add the first one below.</p>}
      </div>
      <div className="competitor-actions" style={{ marginTop: "0.5rem" }}>
        {(Object.keys(ELEMENT_LABELS) as ElementType[]).map((t) => (
          <button key={t} type="button" className="btn btn-ghost" onClick={() => addElement(t)}>
            + {ELEMENT_LABELS[t]}
          </button>
        ))}
      </div>

      {usedPlatforms.length > 0 && (
        <>
          <h3>Platform settings</h3>
          <div className="platform-config-list">
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
                      <input
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
                      <input value={d.tone} onChange={(e) => updateSettings(s.platform, { tone: e.target.value })} />
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
        </>
      )}

      <div className="form-actions">
        <button className="btn btn-primary" disabled={submitting}>
          {submitting ? "Generating…" : "Generate campaign"}
        </button>
      </div>
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
      <div className="card-header">
        <strong>{ELEMENT_LABELS[el.element_type]}</strong>
        <div className="competitor-actions">
          <button type="button" className="btn btn-ghost small" onClick={onDuplicate}>
            Duplicate
          </button>
          <button type="button" className="btn btn-ghost small danger" onClick={onRemove}>
            ✕
          </button>
        </div>
      </div>

      <div className="platform-config-fields">
        {el.element_type === "carousel" && (
          <label>
            Slides
            <input
              type="number"
              min={2}
              max={10}
              value={el.carousel_slides}
              onChange={(e) => onChange({ carousel_slides: Number(e.target.value) })}
            />
          </label>
        )}
        {el.element_type === "video" && (
          <label>
            Duration (s)
            <input
              type="number"
              min={1}
              max={60}
              value={el.video_duration_seconds}
              onChange={(e) => onChange({ video_duration_seconds: Number(e.target.value) })}
            />
          </label>
        )}
      </div>

      <label className="small">
        Concept / theme for this element (optional)
        <input value={el.theme} onChange={(e) => onChange({ theme: e.target.value })} placeholder="e.g. product close-up with lifestyle background" />
      </label>

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
              <span key={r} className="tag" style={{ marginRight: "0.3rem" }}>
                {r}
              </span>
            ))}
          </span>
          <button type="button" className="btn btn-ghost small" onClick={() => setShowRatios((v) => !v)}>
            {showRatios ? "Hide ratios" : "Adjust ratios"}
          </button>
          {showRatios && (
            <div className="platform-config-fields">
              {el.platforms.map((p) => {
                const spec = specs.find((s) => s.platform === p);
                if (!spec) return null;
                return (
                  <label key={p}>
                    {spec.label}
                    <select
                      value={ratios[p]}
                      onChange={(e) =>
                        onChange({ ratio_overrides: { ...el.ratio_overrides, [p]: e.target.value } })
                      }
                    >
                      {spec.aspect_ratios.map((r) => (
                        <option key={r} value={r}>
                          {r}
                        </option>
                      ))}
                    </select>
                  </label>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
