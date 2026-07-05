import { useEffect, useState } from "react";
import { Plus, X } from "lucide-react";
import { api } from "../api";
import type { ArticleSource } from "../types";
import { useConfirm } from "@/components/ui/dialogs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export function ArticleSources() {
  const confirm = useConfirm();
  const [sources, setSources] = useState<ArticleSource[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({
    name: "", url: "", frequency: "weekly", max_articles_per_sync: 50, auto_publish: false,
  });
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  async function load() {
    try {
      setSources(await api<ArticleSource[]>("/article-sources"));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load sources");
    }
  }
  useEffect(() => { load(); }, []);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    try {
      await api("/article-sources", { method: "POST", body: form });
      setForm({ name: "", url: "", frequency: "weekly", max_articles_per_sync: 50, auto_publish: false });
      setShowForm(false);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not add source");
    }
  }

  async function patch(id: string, body: Record<string, unknown>) {
    try {
      await api(`/article-sources/${id}`, { method: "PATCH", body });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Update failed");
    }
  }

  async function syncNow(id: string) {
    setNotice("");
    try {
      await api(`/article-sources/${id}/sync`, { method: "POST" });
      setNotice("Sync started — new articles will appear in the library shortly.");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not start sync");
    }
  }

  async function remove(id: string) {
    const ok = await confirm({
      title: "Delete auto-sync source",
      description: "Imported articles stay in the library; only the sync source is removed.",
      confirmLabel: "Delete",
      destructive: true,
    });
    if (!ok) return;
    try {
      await api(`/article-sources/${id}`, { method: "DELETE" });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Delete failed");
    }
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <CardTitle>Article Library auto-sync</CardTitle>
        <Button onClick={() => setShowForm((v) => !v)}>
          {showForm ? <><X size={14} /> Cancel</> : <><Plus size={14} /> Add source</>}
        </Button>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">
          Configure blog/article sections to crawl periodically. New articles are imported
          automatically, or queued for review first (PRD §7.4).
        </p>
        {error && (
          <div className="rounded-lg border-l-4 border-red-600 bg-red-50 p-3 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300">{error}</div>
        )}
        {notice && (
          <div className="rounded-lg border-l-4 border-emerald-600 bg-emerald-50 p-3 text-sm text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300">{notice}</div>
        )}

        {showForm && (
          <form onSubmit={create} className="flex flex-wrap items-end gap-4 rounded-lg border border-border bg-surface-alt p-4">
            <div className="flex-1 min-w-[180px] space-y-1.5">
              <Label htmlFor="src-name">Name</Label>
              <Input id="src-name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </div>
            <div className="flex-1 min-w-[220px] space-y-1.5">
              <Label htmlFor="src-url">Section URL</Label>
              <Input id="src-url" type="url" placeholder="https://company.com/blog" value={form.url} onChange={(e) => setForm({ ...form, url: e.target.value })} required />
            </div>
            <div className="flex-1 min-w-[140px] space-y-1.5">
              <Label htmlFor="src-freq">Frequency</Label>
              <select id="src-freq" value={form.frequency} onChange={(e) => setForm({ ...form, frequency: e.target.value })} className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring">
                <option value="daily">Daily</option>
                <option value="weekly">Weekly</option>
                <option value="on_demand">On demand</option>
              </select>
            </div>
            <div className="flex-1 min-w-[120px] space-y-1.5">
              <Label htmlFor="src-max">Max / sync</Label>
              <Input id="src-max" type="number" min={1} max={500} value={form.max_articles_per_sync} onChange={(e) => setForm({ ...form, max_articles_per_sync: Number(e.target.value) })} />
            </div>
            <label className="flex flex-row items-center gap-2 text-sm">
              <input type="checkbox" checked={form.auto_publish} onChange={(e) => setForm({ ...form, auto_publish: e.target.checked })} className="size-4 accent-primary" />
              Auto-publish
            </label>
            <Button type="submit">Add</Button>
          </form>
        )}

        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-border bg-surface-alt text-left text-xs font-medium uppercase tracking-wider text-muted-foreground">
              <th className="px-4 py-2.5">Source</th>
              <th className="px-4 py-2.5">Frequency</th>
              <th className="px-4 py-2.5">Publish</th>
              <th className="px-4 py-2.5">Active</th>
              <th className="px-4 py-2.5">Last sync</th>
              <th className="px-4 py-2.5"></th>
            </tr>
          </thead>
          <tbody>
            {sources.map((s) => (
              <tr key={s.id} className="border-b border-border last:border-0">
                <td className="px-4 py-2.5">
                  <strong>{s.name}</strong>
                  <div className="text-sm text-muted-foreground">{s.url}</div>
                </td>
                <td className="px-4 py-2.5">{s.frequency}</td>
                <td className="px-4 py-2.5">{s.auto_publish ? "auto" : "review"}</td>
                <td className="px-4 py-2.5">
                  <Button variant="ghost" size="sm" onClick={() => patch(s.id, { is_active: !s.is_active })}>
                    {s.is_active ? "✓ active" : "✗ inactive"}
                  </Button>
                </td>
                <td className="px-4 py-2.5">
                  <div className="text-sm text-muted-foreground">
                    {s.last_synced_at ? new Date(s.last_synced_at).toLocaleString() : "never"}
                    {s.last_sync_status && ` · ${s.last_sync_status}`}
                  </div>
                  {s.last_sync_detail && (
                    <div className="text-sm text-muted-foreground">{s.last_sync_detail}</div>
                  )}
                </td>
                <td className="px-4 py-2.5">
                  <div className="flex flex-wrap gap-1">
                    <Button variant="ghost" size="sm" onClick={() => syncNow(s.id)} disabled={s.last_sync_status === "running"}>
                      {s.last_sync_status === "running" ? "Syncing…" : "Sync now"}
                    </Button>
                    <Button variant="ghost" size="sm" className="text-red-600 hover:bg-red-50 dark:hover:bg-red-950/40" onClick={() => remove(s.id)}>Delete</Button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </CardContent>
    </Card>
  );
}
