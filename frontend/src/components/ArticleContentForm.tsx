import { useEffect, useState } from "react";
import { api } from "../api";
import type { ArticleListItem, Client, PlatformSpec } from "../types";

type Source = "library" | "url" | "paste";

const ANGLES = ["informational", "opinion", "promotional", "educational"] as const;

interface PlatformDraft {
  enabled: boolean;
  hashtag_count: number;
  emojis: string;
}

/** Module 4 — generate social posts from a source article (PRD §6). */
export function ArticleContentForm({
  clients,
  defaultClient,
  initialArticleId,
  onCreated,
}: {
  clients: Client[];
  defaultClient: string;
  initialArticleId?: string;
  onCreated: (id: string) => void;
}) {
  const [specs, setSpecs] = useState<PlatformSpec[]>([]);
  const [articles, setArticles] = useState<ArticleListItem[]>([]);
  const [clientId, setClientId] = useState(defaultClient || (clients[0]?.id ?? ""));
  const [name, setName] = useState("");
  const [source, setSource] = useState<Source>(initialArticleId ? "library" : "library");
  const [articleId, setArticleId] = useState(initialArticleId ?? "");
  const [articleUrl, setArticleUrl] = useState("");
  const [articleText, setArticleText] = useState("");
  const [angle, setAngle] = useState<(typeof ANGLES)[number]>("informational");
  const [language, setLanguage] = useState("en");
  const [creativity, setCreativity] = useState(5);
  const [includeLink, setIncludeLink] = useState(true);
  const [linkFormat, setLinkFormat] = useState("direct");
  const [mentionAuthor, setMentionAuthor] = useState(true);
  const [generateImages, setGenerateImages] = useState(false);
  const [numPosts, setNumPosts] = useState(2);
  const [platforms, setPlatforms] = useState<Record<string, PlatformDraft>>({});
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    api<PlatformSpec[]>("/campaigns/platforms").then((s) => {
      setSpecs(s);
      const init: Record<string, PlatformDraft> = {};
      for (const spec of s) {
        init[spec.platform] = {
          enabled: ["linkedin", "instagram"].includes(spec.platform),
          hashtag_count: spec.platform === "x" ? 2 : 4,
          emojis: "moderate",
        };
      }
      setPlatforms(init);
    });
    api<ArticleListItem[]>("/articles?article_status=active").then(setArticles).catch(() => {});
  }, []);

  const update = (p: string, patch: Partial<PlatformDraft>) =>
    setPlatforms((prev) => ({ ...prev, [p]: { ...prev[p], ...patch } }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (!clientId) return setError("Select a client.");
    if (source === "library" && !articleId) return setError("Select a library article.");
    if (source === "url" && !articleUrl.trim()) return setError("Enter the article URL.");
    if (source === "paste" && !articleText.trim()) return setError("Paste the article text.");
    if (!Object.values(platforms).some((p) => p.enabled)) return setError("Enable at least one platform.");

    setSubmitting(true);
    try {
      const payload = {
        client_id: clientId,
        name: name || "Article content",
        generation_mode: "article",
        content_angle: angle,
        content_language: language,
        creativity_level: creativity,
        article_id: source === "library" ? articleId : null,
        article_url: source === "url" ? articleUrl : "",
        article_text: source === "paste" ? articleText : "",
        include_article_link: includeLink,
        link_format: linkFormat,
        mention_author: mentionAuthor,
        generate_images: generateImages,
        // Each post is an element shared by every enabled platform (same visual,
        // ratio-adjusted per platform).
        elements: Array.from({ length: numPosts }, () => ({
          element_type: generateImages ? "image" : "text",
          theme: "",
          platforms: specs.filter((s) => platforms[s.platform]?.enabled).map((s) => s.platform),
        })),
        platforms: specs
          .filter((s) => platforms[s.platform]?.enabled)
          .map((s) => {
            const d = platforms[s.platform];
            return {
              platform: s.platform,
              is_active: true,
              hashtag_count: d.hashtag_count,
              emojis: d.emojis,
              include_cta: true,
            };
          }),
      };
      const created = await api<{ id: string }>("/campaigns", { method: "POST", body: payload });
      onCreated(created.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not generate content");
      setSubmitting(false);
    }
  }

  return (
    <form className="card" onSubmit={submit}>
      <h2>Article-to-Content</h2>
      <p className="muted">Generate posts that reference a source article, in the client's brand voice (PRD §6).</p>
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
          Name
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Article content" />
        </label>
        <label>
          Content angle
          <select value={angle} onChange={(e) => setAngle(e.target.value as (typeof ANGLES)[number])}>
            {ANGLES.map((a) => (
              <option key={a} value={a}>
                {a}
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
          <input type="range" min={1} max={10} value={creativity} onChange={(e) => setCreativity(Number(e.target.value))} />
        </label>
      </div>

      <h3>Source article</h3>
      <div className="source-tabs">
        {(["library", "url", "paste"] as Source[]).map((s) => (
          <button
            type="button"
            key={s}
            className={`tab ${source === s ? "tab-active" : ""}`}
            onClick={() => setSource(s)}
          >
            {s === "library" ? "Internal Library" : s === "url" ? "External URL" : "Paste text"}
          </button>
        ))}
      </div>
      {source === "library" && (
        <label>
          Article
          <select value={articleId} onChange={(e) => setArticleId(e.target.value)}>
            <option value="">Select an article…</option>
            {articles.map((a) => (
              <option key={a.id} value={a.id}>
                {a.title}
              </option>
            ))}
          </select>
        </label>
      )}
      {source === "url" && (
        <label>
          Article URL
          <input value={articleUrl} onChange={(e) => setArticleUrl(e.target.value)} placeholder="https://…" />
        </label>
      )}
      {source === "paste" && (
        <label>
          Article text
          <textarea rows={6} value={articleText} onChange={(e) => setArticleText(e.target.value)} />
        </label>
      )}

      <div className="form-grid">
        <label className="checkbox-label">
          <input type="checkbox" checked={includeLink} onChange={(e) => setIncludeLink(e.target.checked)} />
          Include article link (where the platform allows)
        </label>
        <label>
          Link format
          <select value={linkFormat} onChange={(e) => setLinkFormat(e.target.value)} disabled={!includeLink}>
            <option value="direct">Direct</option>
            <option value="shortened">Shortened</option>
            <option value="in_bio">In bio</option>
          </select>
        </label>
        <label className="checkbox-label">
          <input type="checkbox" checked={mentionAuthor} onChange={(e) => setMentionAuthor(e.target.checked)} />
          Mention author on LinkedIn
        </label>
        <label className="checkbox-label">
          <input type="checkbox" checked={generateImages} onChange={(e) => setGenerateImages(e.target.checked)} />
          Also generate image prompts
        </label>
      </div>

      <h3>Platforms</h3>
      <label style={{ maxWidth: "12rem" }}>
        Posts (shared across platforms)
        <input type="number" min={1} max={20} value={numPosts} onChange={(e) => setNumPosts(Number(e.target.value))} />
      </label>
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
              </label>
              {d.enabled && (
                <div className="platform-config-fields">
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
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="form-actions">
        <button className="btn btn-primary" disabled={submitting}>
          {submitting ? "Generating…" : "Generate content"}
        </button>
      </div>
    </form>
  );
}
