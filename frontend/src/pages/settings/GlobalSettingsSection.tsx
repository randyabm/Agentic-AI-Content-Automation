import { useEffect, useState } from "react";
import { api } from "../../api";
import type { Setting } from "../../types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, SettingsGroup } from "./shared";

const SELECT_OPTIONS: Record<string, { value: string; label: string }[]> = {
  social_publishing_mode: [
    { value: "zernio", label: "Zernio (social publishing middleman)" },
    { value: "direct", label: "Direct Platform APIs" },
  ],
  default_ui_language: [
    { value: "en", label: "English" },
    { value: "es", label: "Spanish" },
  ],
  default_content_language: [
    { value: "en", label: "English" },
    { value: "es", label: "Spanish" },
  ],
  onboarding_competitor_depth: [
    { value: "analyze", label: "Analyze (identify + full analysis)" },
    { value: "identify", label: "Identify (list only)" },
  ],
  onboarding_competitor_type: [
    { value: "direct", label: "Direct" },
    { value: "indirect", label: "Indirect" },
  ],
  onboarding_competitor_scope: [
    { value: "local", label: "Local" },
    { value: "national", label: "National" },
    { value: "international", label: "International" },
  ],
};

const BOOLEAN_SETTINGS = new Set(["onboarding_auto_run", "show_onboarding_panel", "dev_mode", "show_article_library"]);

const NUMBER_SETTINGS = new Set([
  "default_competitor_count",
  "default_article_count",
  "crawler_max_depth",
  "crawler_max_pages",
  "crawler_timeout_seconds",
  "crawler_concurrency",
  "competitor_crawl_max_depth",
  "competitor_crawl_max_pages",
]);

const SETTING_META: Record<string, { label: string; help: string }> = {
  default_ui_language: {
    label: "Interface language",
    help: "Language used for the platform's own menus, labels and buttons.",
  },
  default_content_language: {
    label: "Content language",
    help: "Default language the AI writes campaigns, posts and articles in. Can be overridden per client.",
  },
  onboarding_auto_run: {
    label: "Auto-run onboarding",
    help: "When ON, creating a client immediately kicks off the full pipeline (crawl site, import articles, research competitors). When OFF, you start each step manually.",
  },
  show_onboarding_panel: {
    label: "Show onboarding panel",
    help: "When ON, the Onboarding card is visible on every client detail page. Keep OFF in production — it's mainly useful during testing and debugging.",
  },
  dev_mode: {
    label: "Developer mode",
    help: "When ON, shows admin action buttons (Analyze Website, Import Articles) on the client detail page. Keep OFF for end-user-facing environments.",
  },
  show_article_library: {
    label: "Show Article Library",
    help: "When ON, the Article Library link appears in the left sidebar. Turn OFF to hide the global library and direct article access through individual client pages.",
  },
  default_article_count: {
    label: "Articles to import",
    help: "How many articles onboarding pulls in from the client's site as a baseline content library.",
  },
  default_competitor_count: {
    label: "Competitors to research",
    help: "How many competitors the AI tries to identify and analyze for a new client.",
  },
  onboarding_competitor_depth: {
    label: "Competitor depth",
    help: "“Analyze” identifies competitors and runs a full crawl + analysis of each (slower, richer). “Identify” only produces the list.",
  },
  onboarding_competitor_type: {
    label: "Competitor type",
    help: "“Direct” = rivals offering the same product/service. “Indirect” = different offering competing for the same audience or need.",
  },
  onboarding_competitor_scope: {
    label: "Competitor scope",
    help: "Geographic reach when searching for competitors: same city/region (local), country-wide (national), or worldwide (international).",
  },
  crawler_max_depth: {
    label: "Max crawl depth",
    help: "How many link levels deep to follow from the homepage. Higher = more coverage but slower.",
  },
  crawler_max_pages: {
    label: "Max pages per site",
    help: "Hard cap on the number of pages fetched from a single site, so a large site can't run forever.",
  },
  crawler_concurrency: {
    label: "Parallel requests",
    help: "How many pages are fetched at the same time per depth level. Higher = faster, but more load on the target site.",
  },
  crawler_timeout_seconds: {
    label: "Page timeout (seconds)",
    help: "How long to wait for a single page to respond before giving up and moving on.",
  },
  crawler_excluded_paths: {
    label: "Excluded URL paths",
    help: "Comma-separated regex patterns; any URL path matching one is skipped (e.g. /cart, /login, \\?.*).",
  },
  crawler_user_agent: {
    label: "Crawler User-Agent",
    help: "The User-Agent header the crawler sends. Identifies our bot to the sites it visits.",
  },
  competitor_crawl_max_depth: {
    label: "Competitor crawl depth",
    help: "Link depth used specifically when crawling competitor sites — kept shallow so analysis stays fast.",
  },
  competitor_crawl_max_pages: {
    label: "Competitor max pages",
    help: "Page cap when crawling a competitor site. Intentionally small to keep competitor analysis quick.",
  },
};

const SETTING_GROUPS: { title: string; description: string; accent: string; keys: string[] }[] = [
  {
    title: "Language & localization",
    description: "Default languages for the interface and the content the AI produces.",
    accent: "#2563EB",
    keys: ["default_ui_language", "default_content_language"],
  },
  {
    title: "Interface & developer tools",
    description: "Controls which sections of the UI are visible and which developer tools are exposed.",
    accent: "#7C3AED",
    keys: ["show_article_library", "dev_mode", "show_onboarding_panel"],
  },
  {
    title: "Client onboarding",
    description: "What happens automatically when a new client is created.",
    accent: "#4338CA",
    keys: [
      "onboarding_auto_run",
      "default_article_count",
      "default_competitor_count",
      "onboarding_competitor_depth",
      "onboarding_competitor_type",
      "onboarding_competitor_scope",
    ],
  },
  {
    title: "Site crawler",
    description: "How the crawler explores a client's own website.",
    accent: "#0F766E",
    keys: [
      "crawler_max_depth",
      "crawler_max_pages",
      "crawler_concurrency",
      "crawler_timeout_seconds",
      "crawler_excluded_paths",
      "crawler_user_agent",
    ],
  },
  {
    title: "Competitor crawler",
    description: "A lighter crawl used when analyzing competitor sites — kept small to stay fast.",
    accent: "#D97706",
    keys: ["competitor_crawl_max_depth", "competitor_crawl_max_pages"],
  },
];

export function GlobalSettingsSection() {
  const [settings, setSettings] = useState<Setting[]>([]);
  const [edited, setEdited] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    api<Setting[]>("/settings").then(setSettings).catch((e) => setError(e.message));
  }, []);

  async function save() {
    setError("");
    setNotice("");
    try {
      const updated = await api<Setting[]>("/settings", { method: "PUT", body: { values: edited } });
      setSettings(updated);
      setEdited({});
      setNotice("Settings saved.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    }
  }

  const byKey = new Map(settings.map((s) => [s.key, s]));
  const grouped = new Set(SETTING_GROUPS.flatMap((g) => g.keys));
  const ungrouped = settings.filter((s) => !grouped.has(s.key));

  function renderControl(s: Setting) {
    const val = edited[s.key] ?? s.value;
    if (SELECT_OPTIONS[s.key]) {
      return (
        <select
          value={val}
          onChange={(e) => setEdited({ ...edited, [s.key]: e.target.value })}
          className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
        >
          {SELECT_OPTIONS[s.key].map((o) => (<option key={o.value} value={o.value}>{o.label}</option>))}
        </select>
      );
    }
    if (BOOLEAN_SETTINGS.has(s.key)) {
      return (
        <label className="flex flex-row items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={val === "true"}
            onChange={(e) => setEdited({ ...edited, [s.key]: e.target.checked ? "true" : "false" })}
            className="size-4 accent-primary"
          />
          <span className="text-sm text-muted-foreground">{val === "true" ? "Enabled" : "Disabled"}</span>
        </label>
      );
    }
    if (NUMBER_SETTINGS.has(s.key)) {
      return (
        <Input
          type="number"
          min={0}
          value={val}
          onChange={(e) => setEdited({ ...edited, [s.key]: e.target.value })}
        />
      );
    }
    return <Input value={val} onChange={(e) => setEdited({ ...edited, [s.key]: e.target.value })} />;
  }

  function renderRows(items: Setting[]) {
    return items.map((s) => {
      const meta = SETTING_META[s.key];
      return (
        <tr key={s.key} className="border-b border-border last:border-0">
          <td className="px-4 py-3 align-top">
            <strong>{meta?.label ?? s.key}</strong>
            <div className="font-mono text-xs text-muted-foreground">{s.key}</div>
            <div className="mt-0.5 text-sm text-muted-foreground">{meta?.help ?? s.description}</div>
          </td>
          <td className="px-4 py-3 align-middle">{renderControl(s)}</td>
        </tr>
      );
    });
  }

  return (
    <Card>
      <CardHeader><CardTitle>Global settings</CardTitle></CardHeader>
      <CardContent className="space-y-4">
        {error && <Alert kind="error">{error}</Alert>}
        {notice && <Alert kind="success">{notice}</Alert>}

        {SETTING_GROUPS.map((g) => {
          const items = g.keys.map((k) => byKey.get(k)).filter((s): s is Setting => !!s);
          if (items.length === 0) return null;
          return (
            <SettingsGroup key={g.title} title={g.title} description={g.description} accent={g.accent}>
              <table className="w-full border-collapse text-sm">
                <tbody>{renderRows(items)}</tbody>
              </table>
            </SettingsGroup>
          );
        })}

        {ungrouped.length > 0 && (
          <SettingsGroup title="Other" description="" accent="#78716C">
            <table className="w-full border-collapse text-sm">
              <tbody>{renderRows(ungrouped)}</tbody>
            </table>
          </SettingsGroup>
        )}

        <PublishingLimitsEditor />

        <div className="flex">
          <Button onClick={save} disabled={Object.keys(edited).length === 0}>
            Save changes
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function PublishingLimitsEditor() {
  const PLATFORMS = [
    { key: "instagram", label: "Instagram" },
    { key: "facebook", label: "Facebook" },
    { key: "linkedin", label: "LinkedIn" },
    { key: "x", label: "X (Twitter)" },
  ];

  const [limits, setLimits] = useState<Record<string, { per_day: number; min_gap_min: number }>>({});
  const [edited, setEdited] = useState<Record<string, { per_day: number; min_gap_min: number }>>({});
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api<{ limits: Record<string, { per_day: number; min_gap_min: number }> }>(
      "/settings/publishing-limits",
    )
      .then((r) => {
        setLimits(r.limits);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load limits"))
      .finally(() => setLoading(false));
  }, []);

  function currentValue(platform: string): { per_day: number; min_gap_min: number } {
    if (edited[platform]) return edited[platform];
    return limits[platform] ?? limits._default ?? { per_day: 20, min_gap_min: 10 };
  }

  function setField(platform: string, field: "per_day" | "min_gap_min", value: number) {
    const next = { ...currentValue(platform), [field]: value };
    setEdited((prev) => ({ ...prev, [platform]: next }));
  }

  async function save() {
    setError("");
    setNotice("");
    setSaving(true);
    try {
      const res = await api<{ limits: Record<string, { per_day: number; min_gap_min: number }> }>(
        "/settings/publishing-limits",
        { method: "PUT", body: { limits: edited } },
      );
      setLimits(res.limits);
      setEdited({});
      setNotice("Publishing limits updated.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  function reset() {
    setEdited({});
  }

  const dirty = Object.keys(edited).length > 0;

  return (
    <SettingsGroup title="Publishing limits" description="Throttle the publish queue per account so we never burst a platform. per_day is the max posts/24h rolling window; min_gap_min is the minimum minutes between consecutive posts on the same account. Empty cells fall back to the safe default." accent="#0F766E">
      <div className="p-4">
        {error && <Alert kind="error">{error}</Alert>}
        {notice && <Alert kind="success">{notice}</Alert>}
        {loading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : (
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-border bg-surface-alt text-left text-xs font-medium uppercase tracking-wider text-muted-foreground">
                <th className="px-4 py-2.5">Platform</th>
                <th className="px-4 py-2.5">Posts per day (per account)</th>
                <th className="px-4 py-2.5">Minimum gap (minutes)</th>
              </tr>
            </thead>
            <tbody>
              {PLATFORMS.map((p) => {
                const v = currentValue(p.key);
                return (
                  <tr key={p.key} className="border-b border-border last:border-0">
                    <td className="px-4 py-2.5"><strong>{p.label}</strong></td>
                    <td className="px-4 py-2.5">
                      <Input
                        type="number"
                        min={1}
                        value={v.per_day}
                        onChange={(e) => setField(p.key, "per_day", Math.max(1, Number(e.target.value) || 0))}
                        className="w-24"
                      />
                    </td>
                    <td className="px-4 py-2.5">
                      <Input
                        type="number"
                        min={0}
                        value={v.min_gap_min}
                        onChange={(e) => setField(p.key, "min_gap_min", Math.max(0, Number(e.target.value) || 0))}
                        className="w-24"
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
        <div className="mt-3 flex gap-2">
          <Button variant="ghost" onClick={reset} disabled={!dirty || saving}>Reset</Button>
          <Button onClick={save} disabled={!dirty || saving}>
            {saving ? "Saving…" : "Save limits"}
          </Button>
        </div>
      </div>
    </SettingsGroup>
  );
}
