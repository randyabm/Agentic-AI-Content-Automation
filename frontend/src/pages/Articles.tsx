import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api } from "../api";
import { useAuth } from "../auth";
import type { Article, ArticleListItem, Client } from "../types";

type AddMode = "url" | "text" | null;
type SortKey = "title" | "type" | "client" | "author" | "date" | "status";
type SortDir = "asc" | "desc";

export default function Articles() {
  const { user } = useAuth();
  const canEdit = user?.role === "admin" || user?.role === "editor";
  const [searchParams, setSearchParams] = useSearchParams();

  const [items, setItems] = useState<ArticleListItem[]>([]);
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
      // Empty values (e.g. missing date) always sort to the bottom.
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
    load().catch((e) => setError(e.message));
  }, [load]);

  // One-time fetch to populate the client and tag filter dropdowns from the
  // full library (independent of the active filters).
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

  // Keep the client filter reflected in the URL so it is shareable / persists on reload.
  useEffect(() => {
    const current = searchParams.get("client_id") ?? "";
    if (clientId !== current) {
      const next = new URLSearchParams(searchParams);
      if (clientId) next.set("client_id", clientId);
      else next.delete("client_id");
      setSearchParams(next, { replace: true });
    }
  }, [clientId, searchParams, setSearchParams]);

  // Poll while any manual URL import is still extracting.
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
      <div className="page-header">
        <h1>Article Library</h1>
        {canEdit && (
          <div className="competitor-actions">
            <button className="btn btn-ghost" onClick={() => setAddMode(addMode === "url" ? null : "url")}>
              + From URL
            </button>
            <button className="btn btn-primary" onClick={() => setAddMode(addMode === "text" ? null : "text")}>
              + Paste text
            </button>
          </div>
        )}
      </div>

      {addMode === "url" && <AddFromUrl onDone={() => { setAddMode(null); load(); }} onError={setError} />}
      {addMode === "text" && <AddFromText onDone={() => { setAddMode(null); load(); }} onError={setError} />}

      <div className="card filters-bar">
        <input placeholder="Search title, author, summary, tags…" value={q} onChange={(e) => setQ(e.target.value)} />
        <select value={entryType} onChange={(e) => setEntryType(e.target.value)}>
          <option value="">All types</option>
          <option value="auto">Auto</option>
          <option value="manual">Manual</option>
        </select>
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
          <option value="">All statuses</option>
          <option value="active">Active</option>
          <option value="archived">Archived</option>
        </select>
        <select value={clientId} onChange={(e) => setClientId(e.target.value)}>
          <option value="">All clients</option>
          {clients.map((c) => (
            <option key={c.id} value={c.id}>{c.company_name}</option>
          ))}
        </select>
        <select value={tag} onChange={(e) => setTag(e.target.value)}>
          <option value="">All tags</option>
          {allTags.map((t) => (
            <option key={t} value={t}>{t}</option>
          ))}
        </select>
        <label className="checkbox-label">
          <input type="checkbox" checked={reviewOnly} onChange={(e) => setReviewOnly(e.target.checked)} />
          Needs review only
        </label>
      </div>

      {error && <div className="alert alert-error">{error}</div>}
      {notice && <div className="alert alert-success">{notice}</div>}

      {items.length === 0 ? (
        <p className="muted">No articles match these filters.</p>
      ) : (
        <div className="card">
          <table className="table articles-table">
            <thead>
              <tr>
                <SortHeader label="Title" sortKey="title" current={sortKey} dir={sortDir} onSort={toggleSort} />
                <SortHeader label="Type" sortKey="type" current={sortKey} dir={sortDir} onSort={toggleSort} />
                <SortHeader label="Client" sortKey="client" current={sortKey} dir={sortDir} onSort={toggleSort} />
                <SortHeader label="Author" sortKey="author" current={sortKey} dir={sortDir} onSort={toggleSort} />
                <SortHeader label="Date" sortKey="date" current={sortKey} dir={sortDir} onSort={toggleSort} />
                <th>Tags</th>
                <SortHeader label="Status" sortKey="status" current={sortKey} dir={sortDir} onSort={toggleSort} />
              </tr>
            </thead>
            <tbody>
              {sortedItems.map((a) => (
                <tr key={a.id} onClick={() => openArticle(a.id)} style={{ cursor: "pointer" }}>
                  <td className="article-title-cell">{a.title}</td>
                  <td><span className={`tag ${a.entry_type === "auto" ? "" : "tag-green"}`}>{a.entry_type}</span></td>
                  <td className="muted small">{(a.client_id && clientsById.get(a.client_id)) || "—"}</td>
                  <td className="muted small">{a.author || "—"}</td>
                  <td className="muted small">{a.publication_date ?? "—"}</td>
                  <td>
                    <div className="article-meta">
                      {a.tags.slice(0, 3).map((t) => <span key={t} className="tag">{t}</span>)}
                      {a.tags.length > 3 && <span className="muted small">+{a.tags.length - 3}</span>}
                    </div>
                  </td>
                  <td>
                    {a.needs_review && <span className="tag tag-red">needs review</span>}
                    {a.status === "archived" && <span className="tag">archived</span>}
                    {!a.needs_review && a.status === "active" && <span className="muted small">active</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
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
    <th className="sortable" onClick={() => onSort(sortKey)} aria-sort={active ? (dir === "asc" ? "ascending" : "descending") : "none"}>
      {label}
      <span className="sort-indicator">{active ? (dir === "asc" ? " ▲" : " ▼") : ""}</span>
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
    <form className="card form-inline" onSubmit={submit}>
      <label>
        Article URL
        <input type="url" placeholder="https://company.com/blog/post" value={url} onChange={(e) => setUrl(e.target.value)} required />
      </label>
      <button className="btn btn-primary" disabled={busy}>{busy ? "Fetching…" : "Fetch & extract"}</button>
    </form>
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
    <form className="card" onSubmit={submit}>
      <div className="form-grid">
        <label>Title<input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} required /></label>
        <label>Author<input value={form.author} onChange={(e) => setForm({ ...form, author: e.target.value })} /></label>
        <label>Publication date<input type="date" value={form.publication_date} onChange={(e) => setForm({ ...form, publication_date: e.target.value })} /></label>
        <label>Source URL<input type="url" value={form.source_url} onChange={(e) => setForm({ ...form, source_url: e.target.value })} /></label>
        <label>Tags (comma-separated)<input value={form.tags} onChange={(e) => setForm({ ...form, tags: e.target.value })} /></label>
      </div>
      <label>Body<textarea rows={8} value={form.body} onChange={(e) => setForm({ ...form, body: e.target.value })} required /></label>
      <div className="form-actions">
        <button className="btn btn-primary" disabled={busy}>{busy ? "Saving…" : "Save article"}</button>
      </div>
    </form>
  );
}

function ArticleModal({
  article, canEdit, isAdmin, onClose, onAction,
}: {
  article: Article;
  canEdit: boolean;
  isAdmin: boolean;
  onClose: () => void;
  onAction: (id: string, path: string, method?: string) => void;
}) {
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>{article.title}</h2>
          <button className="btn btn-ghost" onClick={onClose}>✕</button>
        </div>
        <p className="muted small">
          {article.author && `${article.author} · `}
          {article.publication_date ?? "no date"} ·{" "}
          <span className={`tag ${article.entry_type === "auto" ? "" : "tag-green"}`}>{article.entry_type}</span>
          {article.needs_review && <span className="tag tag-red"> needs review</span>}
        </p>
        {article.source_url && (
          <a href={article.source_url} target="_blank" rel="noreferrer" className="muted small">{article.source_url}</a>
        )}
        <div className="article-meta">{article.tags.map((t) => <span key={t} className="tag">{t}</span>)}</div>
        <h4>Summary</h4>
        <p>{article.summary}</p>
        <h4>Body</h4>
        <div className="article-body">{article.body}</div>
        {canEdit && (
          <div className="form-actions modal-actions">
            <Link className="btn btn-primary" to={`/campaigns?from_article=${article.id}`}>
              Create content
            </Link>
            {article.needs_review && (
              <button className="btn btn-ghost" onClick={() => onAction(article.id, "/approve")}>Approve</button>
            )}
            {article.status === "active" && (
              <button className="btn btn-ghost" onClick={() => onAction(article.id, "/archive")}>Archive</button>
            )}
            {isAdmin && (
              <button className="btn btn-ghost danger" onClick={() => {
                if (window.confirm("Permanently delete this article?")) onAction(article.id, "", "DELETE");
              }}>Delete</button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
