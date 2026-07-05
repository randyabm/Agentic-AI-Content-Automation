import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Plus } from "lucide-react";
import { api } from "../api";
import { TextareaZoom } from "../components/TextareaZoom";
import { useAuth } from "../auth";
import { ArticleModal } from "../components/ArticleModal";
import type { Article, ArticleListItem, Client } from "../types";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { TableSkeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";

type AddMode = "url" | "text" | null;
type SortKey = "title" | "type" | "client" | "author" | "date" | "status";
type SortDir = "asc" | "desc";

export default function Articles() {
  const { user } = useAuth();
  const canEdit = user?.role === "admin" || user?.role === "editor";
  const [searchParams, setSearchParams] = useSearchParams();

  const [items, setItems] = useState<ArticleListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [clients, setClients] = useState<Client[]>([]);
  const [allTags, setAllTags] = useState<string[]>([]);
  const [q, setQ] = useState("");
  const [entryType, setEntryType] = useState("");
  const [statusFilter, setStatusFilter] = useState("active");
  const [reviewOnly, setReviewOnly] = useState(false);
  const [clientId, setClientId] = useState(searchParams.get("client_id") ?? "");
  const [tag, setTag] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("date");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [addMode, setAddMode] = useState<AddMode>(null);
  const [selected, setSelected] = useState<Article | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const pollRef = useRef<number | null>(null);

  const clientsById = useMemo(
    () => new Map(clients.map((c) => [c.id, c.company_name])),
    [clients],
  );

  const sortValue = useCallback(
    (a: ArticleListItem, key: SortKey): string => {
      switch (key) {
        case "title": return a.title.toLowerCase();
        case "type": return a.entry_type;
        case "client": return ((a.client_id && clientsById.get(a.client_id)) || "").toLowerCase();
        case "author": return a.author.toLowerCase();
        case "date": return a.publication_date ?? "";
        case "status": return a.needs_review ? "needs review" : a.status;
      }
    },
    [clientsById],
  );

  const sortedItems = useMemo(() => {
    const dir = sortDir === "asc" ? 1 : -1;
    return [...items].sort((a, b) => {
      const va = sortValue(a, sortKey);
      const vb = sortValue(b, sortKey);
      if (va === "" && vb !== "") return 1;
      if (vb === "" && va !== "") return -1;
      return va < vb ? -dir : va > vb ? dir : 0;
    });
  }, [items, sortKey, sortDir, sortValue]);

  function toggleSort(key: SortKey) {
    if (key === sortKey) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir(key === "date" ? "desc" : "asc");
    }
  }

  const load = useCallback(async () => {
    const params = new URLSearchParams();
    if (q) params.set("q", q);
    if (entryType) params.set("entry_type", entryType);
    if (statusFilter) params.set("article_status", statusFilter);
    if (reviewOnly) params.set("needs_review", "true");
    if (clientId) params.set("client_id", clientId);
    if (tag) params.set("tag", tag);
    const list = await api<ArticleListItem[]>(`/articles?${params.toString()}`);
    setItems(list);
    return list;
  }, [q, entryType, statusFilter, reviewOnly, clientId, tag]);

  useEffect(() => {
    load().catch((e) => setError(e.message)).finally(() => setLoading(false));
  }, [load]);

  useEffect(() => {
    api<Client[]>("/clients").then(setClients).catch(() => {});
    api<ArticleListItem[]>("/articles?limit=500")
      .then((list) => {
        const tags = new Set<string>();
        list.forEach((a) => a.tags.forEach((t) => tags.add(t)));
        setAllTags([...tags].sort((a, b) => a.localeCompare(b)));
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    const current = searchParams.get("client_id") ?? "";
    if (clientId !== current) {
      const next = new URLSearchParams(searchParams);
      if (clientId) next.set("client_id", clientId);
      else next.delete("client_id");
      setSearchParams(next, { replace: true });
    }
  }, [clientId, searchParams, setSearchParams]);

  useEffect(() => {
    const pending = items.some((a) => a.summary.startsWith("[Fetching"));
    if (pending && pollRef.current === null) {
      pollRef.current = window.setInterval(async () => {
        const list = await load().catch(() => []);
        if (!list.some((a) => a.summary.startsWith("[Fetching")) && pollRef.current) {
          window.clearInterval(pollRef.current);
          pollRef.current = null;
        }
      }, 3000);
    }
    return () => {
      if (pollRef.current) {
        window.clearInterval(pollRef.current);
        pollRef.current = null;
      }
    };
  }, [items, load]);

  async function openArticle(id: string) {
    setError("");
    try {
      setSelected(await api<Article>(`/articles/${id}`));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load article");
    }
  }

  async function action(id: string, path: string, method = "POST") {
    setError("");
    setNotice("");
    try {
      await api(`/articles/${id}${path}`, { method });
      setSelected(null);
      await load();
      setNotice("Done.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Action failed");
    }
  }

  return (
    <div>
      <PageHeader
        title="Article Library"
        actions={canEdit && (
          <>
            <Button variant="ghost" onClick={() => setAddMode(addMode === "url" ? null : "url")}>
              <Plus size={14} /> From URL
            </Button>
            <Button onClick={() => setAddMode(addMode === "text" ? null : "text")}>
              <Plus size={14} /> Paste text
            </Button>
          </>
        )}
      />

      {addMode === "url" && <AddFromUrl onDone={() => { setAddMode(null); load(); }} onError={setError} />}
      {addMode === "text" && <AddFromText onDone={() => { setAddMode(null); load(); }} onError={setError} />}

      <Card className="mb-4">
        <CardContent className="flex flex-wrap items-center gap-3 py-4">
          <Input placeholder="Search title, author, summary, tags…" value={q} onChange={(e) => setQ(e.target.value)} className="min-w-[220px] flex-1" />
          <select value={entryType} onChange={(e) => setEntryType(e.target.value)} className="h-10 rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring">
            <option value="">All types</option>
            <option value="auto">Auto</option>
            <option value="manual">Manual</option>
          </select>
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="h-10 rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring">
            <option value="">All statuses</option>
            <option value="active">Active</option>
            <option value="archived">Archived</option>
          </select>
          <select value={clientId} onChange={(e) => setClientId(e.target.value)} className="h-10 rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring">
            <option value="">All clients</option>
            {clients.map((c) => (<option key={c.id} value={c.id}>{c.company_name}</option>))}
          </select>
          <select value={tag} onChange={(e) => setTag(e.target.value)} className="h-10 rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring">
            <option value="">All tags</option>
            {allTags.map((t) => (<option key={t} value={t}>{t}</option>))}
          </select>
          <label className="flex flex-row items-center gap-2 text-sm">
            <input type="checkbox" checked={reviewOnly} onChange={(e) => setReviewOnly(e.target.checked)} className="size-4 accent-primary" />
            Needs review only
          </label>
        </CardContent>
      </Card>

      {error && (
        <div className="mb-4 rounded-lg border-l-4 border-red-600 bg-red-50 p-3 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300">{error}</div>
      )}
      {notice && (
        <div className="mb-4 rounded-lg border-l-4 border-emerald-600 bg-emerald-50 p-3 text-sm text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300">{notice}</div>
      )}

      {loading ? (
        <TableSkeleton rows={6} cols={7} />
      ) : items.length === 0 ? (
        <p className="text-sm text-muted-foreground">No articles match these filters.</p>
      ) : (
        <Card>
          <CardContent className="p-0">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b border-border bg-surface-alt text-left text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  <SortHeader label="Title" sortKey="title" current={sortKey} dir={sortDir} onSort={toggleSort} />
                  <SortHeader label="Type" sortKey="type" current={sortKey} dir={sortDir} onSort={toggleSort} />
                  <SortHeader label="Client" sortKey="client" current={sortKey} dir={sortDir} onSort={toggleSort} />
                  <SortHeader label="Author" sortKey="author" current={sortKey} dir={sortDir} onSort={toggleSort} />
                  <SortHeader label="Date" sortKey="date" current={sortKey} dir={sortDir} onSort={toggleSort} />
                  <th className="px-4 py-2.5">Tags</th>
                  <SortHeader label="Status" sortKey="status" current={sortKey} dir={sortDir} onSort={toggleSort} />
                </tr>
              </thead>
              <tbody>
                {sortedItems.map((a) => (
                  <tr
                    key={a.id}
                    onClick={() => openArticle(a.id)}
                    className="cursor-pointer border-b border-border last:border-0 hover:bg-muted/50"
                  >
                    <td className="max-w-[24rem] px-4 py-2.5 font-semibold">{a.title}</td>
                    <td className="px-4 py-2.5">
                      <Badge variant={a.entry_type === "auto" ? "secondary" : "success"}>{a.entry_type}</Badge>
                    </td>
                    <td className="px-4 py-2.5 text-xs text-muted-foreground">{(a.client_id && clientsById.get(a.client_id)) || "—"}</td>
                    <td className="px-4 py-2.5 text-xs text-muted-foreground">{a.author || "—"}</td>
                    <td className="px-4 py-2.5 text-xs text-muted-foreground">{a.publication_date ?? "—"}</td>
                    <td className="px-4 py-2.5">
                      <div className="flex flex-wrap gap-1.5">
                        {a.tags.slice(0, 3).map((t) => (
                          <Badge key={t} variant="secondary">{t}</Badge>
                        ))}
                        {a.tags.length > 3 && (
                          <span className="text-xs text-muted-foreground">+{a.tags.length - 3}</span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-2.5">
                      {a.needs_review && <Badge variant="destructive">needs review</Badge>}
                      {a.status === "archived" && <Badge>archived</Badge>}
                      {!a.needs_review && a.status === "active" && (
                        <span className="text-xs text-muted-foreground">active</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}

      {selected && (
        <ArticleModal
          article={selected}
          canEdit={canEdit}
          isAdmin={user?.role === "admin"}
          onClose={() => setSelected(null)}
          onAction={action}
        />
      )}
    </div>
  );
}

function SortHeader({
  label, sortKey, current, dir, onSort,
}: {
  label: string;
  sortKey: SortKey;
  current: SortKey;
  dir: SortDir;
  onSort: (key: SortKey) => void;
}) {
  const active = current === sortKey;
  return (
    <th
      onClick={() => onSort(sortKey)}
      aria-sort={active ? (dir === "asc" ? "ascending" : "descending") : "none"}
      className="cursor-pointer select-none whitespace-nowrap px-4 py-2.5"
    >
      {label}
      <span className="text-[0.7em]">{active ? (dir === "asc" ? " ▲" : " ▼") : ""}</span>
    </th>
  );
}

function AddFromUrl({ onDone, onError }: { onDone: () => void; onError: (m: string) => void }) {
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await api("/articles/from-url", { method: "POST", body: { url } });
      onDone();
    } catch (err) {
      onError(err instanceof Error ? err.message : "Could not add article");
    } finally {
      setBusy(false);
    }
  }
  return (
    <Card className="mb-4">
      <CardContent className="py-4">
        <form onSubmit={submit} className="flex flex-wrap items-end gap-4">
          <div className="flex-1 min-w-[220px] space-y-1.5">
            <Label htmlFor="add-url">Article URL</Label>
            <Input id="add-url" type="url" placeholder="https://company.com/blog/post" value={url} onChange={(e) => setUrl(e.target.value)} required />
          </div>
          <Button type="submit" disabled={busy}>{busy ? "Fetching…" : "Fetch & extract"}</Button>
        </form>
      </CardContent>
    </Card>
  );
}

function AddFromText({ onDone, onError }: { onDone: () => void; onError: (m: string) => void }) {
  const [form, setForm] = useState({ title: "", author: "", publication_date: "", source_url: "", tags: "", body: "" });
  const [busy, setBusy] = useState(false);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await api("/articles/from-text", {
        method: "POST",
        body: {
          title: form.title,
          author: form.author,
          publication_date: form.publication_date || null,
          source_url: form.source_url,
          tags: form.tags.split(",").map((t) => t.trim()).filter(Boolean),
          body: form.body,
        },
      });
      onDone();
    } catch (err) {
      onError(err instanceof Error ? err.message : "Could not add article");
    } finally {
      setBusy(false);
    }
  }
  return (
    <Card className="mb-4">
      <CardContent className="py-4">
        <form onSubmit={submit} className="space-y-3">
          <div className="grid grid-cols-1 gap-x-4 gap-y-3 sm:grid-cols-2 lg:grid-cols-3">
            <div className="space-y-1.5">
              <Label htmlFor="add-text-title">Title</Label>
              <Input id="add-text-title" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} required />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="add-text-author">Author</Label>
              <Input id="add-text-author" value={form.author} onChange={(e) => setForm({ ...form, author: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="add-text-date">Publication date</Label>
              <Input id="add-text-date" type="date" value={form.publication_date} onChange={(e) => setForm({ ...form, publication_date: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="add-text-source">Source URL</Label>
              <Input id="add-text-source" type="url" value={form.source_url} onChange={(e) => setForm({ ...form, source_url: e.target.value })} />
            </div>
            <div className="space-y-1.5 sm:col-span-2 lg:col-span-1">
              <Label htmlFor="add-text-tags">Tags (comma-separated)</Label>
              <Input id="add-text-tags" value={form.tags} onChange={(e) => setForm({ ...form, tags: e.target.value })} />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>Body</Label>
            <TextareaZoom label="Body" rows={8} value={form.body} onChange={(v) => setForm({ ...form, body: v })} />
          </div>
          <div className="flex gap-2">
            <Button type="submit" disabled={busy}>{busy ? "Saving…" : "Save article"}</Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
