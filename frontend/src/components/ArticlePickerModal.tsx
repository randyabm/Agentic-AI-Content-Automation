import { useMemo, useState } from "react";
import type { ArticleListItem } from "../types";

interface Props {
  articles: ArticleListItem[];
  onSelect: (article: ArticleListItem) => void;
  onClose: () => void;
}

function sortKey(a: ArticleListItem): number {
  const raw = a.publication_date ?? a.created_at;
  if (!raw) return 0;
  const t = Date.parse(raw);
  return isNaN(t) ? 0 : t;
}

function formatDate(value: string | null): string {
  if (!value) return "—";
  const t = Date.parse(value);
  if (isNaN(t)) return value;
  return new Date(t).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

export function ArticlePickerModal({ articles, onSelect, onClose }: Props) {
  const [query, setQuery] = useState("");
  const [highlighted, setHighlighted] = useState<ArticleListItem | null>(null);

  // Newest first — explicit descending by publication_date, fallback to created_at
  const sorted = useMemo(
    () => [...articles].sort((a, b) => sortKey(b) - sortKey(a)),
    [articles],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return sorted;
    return sorted.filter(
      (a) =>
        a.title.toLowerCase().includes(q) ||
        a.author.toLowerCase().includes(q) ||
        a.tags.some((t) => t.toLowerCase().includes(q)),
    );
  }, [sorted, query]);

  const preview = highlighted ?? filtered[0] ?? null;

  return (
    <div
      className="modal-overlay"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="modal article-picker-modal" style={{ padding: 0, display: "flex", flexDirection: "column" }}>
        {/* Header */}
        <div className="modal-header" style={{ padding: "1rem 1.25rem", borderBottom: "1px solid var(--border)", flexShrink: 0 }}>
          <h2 style={{ fontSize: "1rem" }}>Select reference article</h2>
          <button type="button" className="btn-icon" onClick={onClose} aria-label="Close">✕</button>
        </div>

        {/* Body — two panels, fills remaining height */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", flex: 1, minHeight: 0, overflow: "hidden" }}>

          {/* Left: search + list */}
          <div style={{ display: "flex", flexDirection: "column", borderRight: "1px solid var(--border)", overflow: "hidden" }}>
            <div style={{ padding: "0.75rem 1rem", borderBottom: "1px solid var(--border)", flexShrink: 0 }}>
              <input
                autoFocus
                type="search"
                placeholder="Search by title, author or tag…"
                value={query}
                onChange={(e) => { setQuery(e.target.value); setHighlighted(null); }}
                style={{ width: "100%", fontSize: "0.85rem" }}
              />
            </div>
            <div style={{ overflowY: "auto", flex: 1 }}>
              {filtered.length === 0 && (
                <p className="muted" style={{ padding: "1rem", fontSize: "0.85rem" }}>No articles match.</p>
              )}
              {filtered.map((a) => {
                const active = (highlighted ?? filtered[0])?.id === a.id;
                return (
                  <button
                    type="button"
                    key={a.id}
                    onClick={() => setHighlighted(a)}
                    style={{
                      display: "block",
                      width: "100%",
                      textAlign: "left",
                      padding: "0.6rem 1rem",
                      background: active ? "var(--primary-soft)" : "transparent",
                      border: "none",
                      borderBottom: "1px solid var(--border)",
                      borderLeft: active ? "3px solid var(--primary)" : "3px solid transparent",
                      cursor: "pointer",
                    }}
                  >
                    <div style={{ fontSize: "0.83rem", fontWeight: 600, color: "var(--text)", lineHeight: 1.3, marginBottom: "0.2rem" }}>
                      {a.title}
                    </div>
                    <div style={{ fontSize: "0.75rem", color: "var(--muted)" }}>
                      {formatDate(a.publication_date ?? a.created_at)}
                      {a.author ? ` · ${a.author}` : ""}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Right: detail (scrollable) + action buttons (always visible) */}
          <div style={{ display: "flex", flexDirection: "column", overflow: "hidden" }}>
            {preview ? (
              <>
                {/* Scrollable detail area */}
                <div style={{ flex: 1, overflowY: "auto", padding: "1.25rem", display: "flex", flexDirection: "column", gap: "0.75rem" }}>
                  <div>
                    <div style={{ fontSize: "0.95rem", fontWeight: 600, color: "var(--text)", lineHeight: 1.4, marginBottom: "0.3rem" }}>
                      {preview.title}
                    </div>
                    <div style={{ fontSize: "0.78rem", color: "var(--muted)" }}>
                      {formatDate(preview.publication_date ?? preview.created_at)}
                      {preview.author ? ` · ${preview.author}` : ""}
                    </div>
                  </div>

                  {preview.tags.length > 0 && (
                    <div style={{ display: "flex", flexWrap: "wrap", gap: "0.3rem" }}>
                      {preview.tags.map((t) => (
                        <span key={t} style={{ fontSize: "0.72rem", padding: "2px 8px", borderRadius: "99px", background: "var(--surface-alt)", border: "1px solid var(--border)", color: "var(--muted)" }}>
                          {t}
                        </span>
                      ))}
                    </div>
                  )}

                  {preview.summary && (
                    <p style={{ fontSize: "0.82rem", color: "var(--muted)", lineHeight: 1.6, margin: 0 }}>
                      {preview.summary}
                    </p>
                  )}

                  {preview.source_url && (
                    <a href={preview.source_url} target="_blank" rel="noreferrer" style={{ fontSize: "0.78rem", color: "var(--primary)" }}>
                      Ver fuente ↗
                    </a>
                  )}
                </div>

                {/* Action bar — always pinned at the bottom */}
                <div style={{ flexShrink: 0, padding: "0.875rem 1.25rem", borderTop: "1px solid var(--border)", display: "flex", gap: "0.5rem", background: "var(--surface)" }}>
                  <button type="button" className="btn btn-primary" onClick={() => onSelect(preview)}>
                    Use this article
                  </button>
                  <button type="button" className="btn" onClick={onClose}>
                    Cancel
                  </button>
                </div>
              </>
            ) : (
              <p className="muted" style={{ padding: "1.25rem", fontSize: "0.85rem" }}>
                Select an article on the left to preview it.
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
