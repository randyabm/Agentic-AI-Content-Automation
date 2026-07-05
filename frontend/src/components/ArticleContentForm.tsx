import { useState } from "react";
import { Sparkles } from "lucide-react";
import { api } from "../api";
import type { Article, Client } from "../types";
import { TextareaZoom } from "./TextareaZoom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

const ANGLES = ["informative", "opinion", "announcement", "how-to", "story"] as const;
type Source = "library" | "url" | "paste";

export function ArticleContentForm({
  clients: clientsProp,
  defaultClient,
  initialArticleId,
  onCreated,
}: {
  clients?: Client[];
  defaultClient?: string;
  initialArticleId?: string;
  onCreated: (campaignId: string) => void;
}) {
  const [fetchedClients, setFetchedClients] = useState<{ id: string; company_name: string }[]>([]);
  const clients = clientsProp ?? fetchedClients;
  const [articles, setArticles] = useState<Article[]>([]);
  const [clientId, setClientId] = useState(defaultClient ?? "");
  const [name, setName] = useState("Article content");
  const [angle, setAngle] = useState<(typeof ANGLES)[number]>("informative");
  const [language, setLanguage] = useState("en");
  const [creativity, setCreativity] = useState(6);
  const [source, setSource] = useState<Source>("library");
  const [articleId, setArticleId] = useState("");
  const [articleUrl, setArticleUrl] = useState("");
  const [articleText, setArticleText] = useState("");
  const [includeLink, setIncludeLink] = useState(true);
  const [linkFormat, setLinkFormat] = useState("direct");
  const [mentionAuthor, setMentionAuthor] = useState(false);
  const [generateImages, setGenerateImages] = useState(false);
  const [numPosts, setNumPosts] = useState(3);
  const [specs, setSpecs] = useState<{ platform: string; label: string }[]>([]);
  const [platforms, setPlatforms] = useState<Record<string, { enabled: boolean; hashtag_count: number; emojis: string }>>({});
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  // Load clients + articles on mount.
  useState(() => {
    if (!clientsProp) {
      api<{ id: string; company_name: string }[]>("/clients").then(setFetchedClients).catch(() => {});
    }
    api<Article[]>("/articles").then(setArticles).catch(() => {});
  });

  // Apply initial article id from parent (e.g. /campaigns/new?fromArticle=…).
  useState(() => {
    if (initialArticleId) {
      setArticleId(initialArticleId);
      setSource("library");
    }
  });

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setSubmitting(true);
    try {
      const body: Record<string, unknown> = {
        client_id: clientId,
        name,
        angle,
        language,
        creativity,
        num_posts: numPosts,
        include_link: includeLink,
        link_format: linkFormat,
        mention_author: mentionAuthor,
        generate_images: generateImages,
        platform_specs: specs.map((s) => ({ platform: s.platform, ...platforms[s.platform] })),
      };
      if (source === "library") body.article_id = articleId;
      if (source === "url") body.article_url = articleUrl;
      if (source === "paste") body.article_text = articleText;
      const out = await api<{ campaign_id: string }>("/campaigns/from-article", { method: "POST", body });
      onCreated(out.campaign_id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not generate content");
      setSubmitting(false);
    }
  }

  function update(platform: string, patch: Partial<{ enabled: boolean; hashtag_count: number; emojis: string }>) {
    setPlatforms((prev) => ({ ...prev, [platform]: { ...prev[platform], ...patch } }));
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <Card>
        <CardContent className="space-y-4 pt-6">
          <div>
            <h2 className="mb-1">Article-to-Content</h2>
            <p className="text-sm text-muted-foreground">Generate posts that reference a source article, in the client's brand voice (PRD §6).</p>
          </div>
          {error && (
            <div className="rounded-lg border-l-4 border-red-600 bg-red-50 p-3 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300">
              {error}
            </div>
          )}

          <div className="grid grid-cols-1 gap-x-4 gap-y-3 sm:grid-cols-2 lg:grid-cols-3">
            <div className="space-y-1.5">
              <Label htmlFor="acf-client">Client</Label>
              <select
                id="acf-client"
                value={clientId}
                onChange={(e) => setClientId(e.target.value)}
                required
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              >
                <option value="">Select…</option>
                {clients.map((c) => (
                  <option key={c.id} value={c.id}>{c.company_name}</option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="acf-name">Name</Label>
              <Input id="acf-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Article content" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="acf-angle">Content angle</Label>
              <select
                id="acf-angle"
                value={angle}
                onChange={(e) => setAngle(e.target.value as (typeof ANGLES)[number])}
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              >
                {ANGLES.map((a) => (<option key={a} value={a}>{a}</option>))}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="acf-lang">Content language</Label>
              <Input id="acf-lang" value={language} onChange={(e) => setLanguage(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="acf-creativity">Creativity: {creativity}</Label>
              <Input id="acf-creativity" type="range" min={1} max={10} value={creativity} onChange={(e) => setCreativity(Number(e.target.value))} />
            </div>
          </div>

          <div>
            <h3 className="mb-2">Source article</h3>
            <div className="mb-3 flex gap-1 border-b border-border">
              {(["library", "url", "paste"] as Source[]).map((s) => (
                <button
                  type="button"
                  key={s}
                  onClick={() => setSource(s)}
                  className={cn(
                    "border-b-2 border-transparent bg-transparent px-4 py-2.5 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground",
                    source === s && "border-primary text-foreground",
                  )}
                >
                  {s === "library" ? "Internal Library" : s === "url" ? "External URL" : "Paste text"}
                </button>
              ))}
            </div>
            {source === "library" && (
              <div className="space-y-1.5">
                <Label htmlFor="acf-article">Article</Label>
                <select
                  id="acf-article"
                  value={articleId}
                  onChange={(e) => setArticleId(e.target.value)}
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                >
                  <option value="">Select an article…</option>
                  {articles.map((a) => (<option key={a.id} value={a.id}>{a.title}</option>))}
                </select>
              </div>
            )}
            {source === "url" && (
              <div className="space-y-1.5">
                <Label htmlFor="acf-url">Article URL</Label>
                <Input id="acf-url" value={articleUrl} onChange={(e) => setArticleUrl(e.target.value)} placeholder="https://…" />
              </div>
            )}
            {source === "paste" && (
              <div className="space-y-1.5">
                <Label>Article text</Label>
                <TextareaZoom label="Article text" rows={6} value={articleText} onChange={setArticleText} />
              </div>
            )}
          </div>

          <div className="grid grid-cols-1 gap-x-4 gap-y-3 sm:grid-cols-2 lg:grid-cols-3">
            <label className="flex flex-row items-center gap-2 text-sm">
              <input type="checkbox" checked={includeLink} onChange={(e) => setIncludeLink(e.target.checked)} className="size-4 accent-primary" />
              Include article link (where the platform allows)
            </label>
            <div className="space-y-1.5">
              <Label htmlFor="acf-link">Link format</Label>
              <select
                id="acf-link"
                value={linkFormat}
                onChange={(e) => setLinkFormat(e.target.value)}
                disabled={!includeLink}
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50"
              >
                <option value="direct">Direct</option>
                <option value="shortened">Shortened</option>
                <option value="in_bio">In bio</option>
              </select>
            </div>
            <label className="flex flex-row items-center gap-2 text-sm">
              <input type="checkbox" checked={mentionAuthor} onChange={(e) => setMentionAuthor(e.target.checked)} className="size-4 accent-primary" />
              Mention author on LinkedIn
            </label>
            <label className="flex flex-row items-center gap-2 text-sm">
              <input type="checkbox" checked={generateImages} onChange={(e) => setGenerateImages(e.target.checked)} className="size-4 accent-primary" />
              Also generate image prompts
            </label>
          </div>

          <div>
            <h3 className="mb-2">Platforms</h3>
            <div className="mb-4 max-w-[12rem] space-y-1.5">
              <Label htmlFor="acf-numposts">Posts (shared across platforms)</Label>
              <Input id="acf-numposts" type="number" min={1} max={20} value={numPosts} onChange={(e) => setNumPosts(Number(e.target.value))} />
            </div>
            <div className="mb-4 flex flex-col gap-2">
              {specs.map((s) => {
                const d = platforms[s.platform];
                if (!d) return null;
                return (
                  <div
                    key={s.platform}
                    className={cn(
                      "rounded-lg border border-border p-2.5",
                      d.enabled && "border-primary bg-accent",
                    )}
                  >
                    <label className="mb-0 flex flex-row items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={d.enabled}
                        onChange={(e) => update(s.platform, { enabled: e.target.checked })}
                        className="size-4 accent-primary"
                      />
                      <strong>{s.label}</strong>
                    </label>
                    {d.enabled && (
                      <div className="mt-2.5 grid grid-cols-[repeat(auto-fit,minmax(110px,1fr))] gap-x-3">
                        <div className="mb-1.5 space-y-1">
                          <Label className="text-xs">Hashtags</Label>
                          <Input
                            type="number"
                            min={0}
                            max={30}
                            value={d.hashtag_count}
                            onChange={(e) => update(s.platform, { hashtag_count: Number(e.target.value) })}
                          />
                        </div>
                        <div className="mb-1.5 space-y-1">
                          <Label className="text-xs">Emojis</Label>
                          <select
                            value={d.emojis}
                            onChange={(e) => update(s.platform, { emojis: e.target.value })}
                            className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                          >
                            <option value="none">None</option>
                            <option value="moderate">Moderate</option>
                            <option value="abundant">Abundant</option>
                          </select>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          <div className="flex gap-2">
            <Button type="submit" disabled={submitting}>
              <Sparkles size={14} />
              {submitting ? "Generating…" : "Generate content"}
            </Button>
          </div>
        </CardContent>
      </Card>
    </form>
  );
}
