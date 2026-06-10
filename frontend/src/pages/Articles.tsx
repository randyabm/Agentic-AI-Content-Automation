import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../api";
import { useAuth } from "../auth";
import type { Article, ArticleListItem } from "../types";

type AddMode = "url" | "text" | null;

export default function Articles() {
  const { user } = useAuth();
  const canEdit = user?.role === "admin" || user?.role === "editor";

  const [items, setItems] = useState<ArticleListItem[]>([]);
  const [q, setQ] = useState("");
  const [entryType, setEntryType] = useState("");
  const [statusFilter, setStatusFilter] = useState("active");
  const [reviewOnly, setReviewOnly] = useState(false);
  const [addMode, setAddMode] = useState<AddMode>(null);
  const [selected, setSelected] = useState<Article | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const pollRef = useRef<number | null>(null);

  const load = useCallback(async () => {
    const params = new URLSearchParams();
    if (q) params.set("q", q);
    if (entryType) params.set("entry_type", entryType);
    if (statusFilter) params.set("article_status", statusFilter);
    if (reviewOnly) params.set("needs_review", "true");
    const list = await api<ArticleListItem[]>(`/articles?${params.toString()}`);
    setItems(list);
    return list;
  }, [q, entryType, statusFilter, reviewOnly]);

  useEffect(() => {
    load().catch((e) => setError(e.message));
  }, [load]);

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
        <div className="card-grid">
          {items.map((a) => (
            <div key={a.id} className="card client-card" onClick={() => openArticle(a.id)} style={{ cursor: "pointer" }}>
              <h3>{a.title}</h3>
              <div className="article-meta">
                <span className={`tag ${a.entry_type === "auto" ? "" : "tag-green"}`}>{a.entry_type}</span>
                {a.needs_review && <span className="tag tag-red">needs review</span>}
                {a.status === "archived" && <span className="tag">archived</span>}
              </div>
              <p className="muted small">
                {a.author && `${a.author} · `}
                {a.publication_date ?? "no date"}
              </p>
              <p className="muted small clamp-3">{a.summary}</p>
              <div className="article-meta">
                {a.tags.slice(0, 4).map((t) => <span key={t} className="tag">{t}</span>)}
              </div>
            </div>
          ))}
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
            {article.needs_review && (
              <button className="btn btn-primary" onClick={() => onAction(article.id, "/approve")}>Approve</button>
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
