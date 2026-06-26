import { useMemo, useState } from "react";
import type { ArticleListItem } from "../types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

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
      className="fixed inset-0 z-50 grid place-items-center bg-slate-900/45 p-6 backdrop-blur-sm"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="flex w-full max-w-[760px] flex-col overflow-hidden rounded-xl bg-surface max-h-[80vh]">
        {/* Header */}
        <div className="flex flex-shrink-0 items-center justify-between gap-4 border-b border-border px-5 py-4">
          <h2 className="m-0 text-base font-semibold">Select reference article</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="cursor-pointer rounded-md border-none bg-transparent px-1.5 py-0.5 text-base hover:bg-bg"
          >
            ✕
          </button>
        </div>

        {/* Body — two panels, fills remaining height */}
        <div className="grid flex-1 grid-cols-2 overflow-hidden" style={{ minHeight: 0 }}>

          {/* Left: search + list */}
          <div className="flex flex-col overflow-hidden border-r border-border">
            <div className="flex-shrink-0 border-b border-border px-4 py-3">
              <Input
                autoFocus
                type="search"
                placeholder="Search by title, author or tag…"
                value={query}
                onChange={(e) => { setQuery(e.target.value); setHighlighted(null); }}
                className="text-sm"
              />
            </div>
            <div className="flex-1 overflow-y-auto">
              {filtered.length === 0 && (
                <p className="p-4 text-sm text-muted-foreground">No articles match.</p>
              )}
              {filtered.map((a) => {
                const active = (highlighted ?? filtered[0])?.id === a.id;
                return (
                  <button
                    type="button"
                    key={a.id}
                    onClick={() => setHighlighted(a)}
                    className={`block w-full cursor-pointer border-b border-border bg-transparent px-4 py-2.5 text-left ${active ? "border-l-[3px] border-l-primary bg-accent" : "border-l-[3px] border-l-transparent"}`}
                  >
                    <div className="mb-0.5 text-[0.83rem] font-semibold leading-tight">
                      {a.title}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {formatDate(a.publication_date ?? a.created_at)}
                      {a.author ? ` · ${a.author}` : ""}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Right: detail (scrollable) + action buttons (always visible) */}
          <div className="flex flex-col overflow-hidden">
            {preview ? (
              <>
                <div className="flex flex-1 flex-col gap-3 overflow-y-auto p-5">
                  <div>
                    <div className="mb-1 text-[0.95rem] font-semibold leading-snug">
                      {preview.title}
                    </div>
                    <div className="text-[0.78rem] text-muted-foreground">
                      {formatDate(preview.publication_date ?? preview.created_at)}
                      {preview.author ? ` · ${preview.author}` : ""}
                    </div>
                  </div>

                  {preview.tags.length > 0 && (
                    <div className="flex flex-wrap gap-1">
                      {preview.tags.map((t) => (
                        <span key={t} className="rounded-full border border-border bg-surface-alt px-2 py-0.5 text-[0.72rem] text-muted-foreground">
                          {t}
                        </span>
                      ))}
                    </div>
                  )}

                  {preview.summary && (
                    <p className="m-0 text-[0.82rem] leading-relaxed text-muted-foreground">
                      {preview.summary}
                    </p>
                  )}

                  {preview.source_url && (
                    <a href={preview.source_url} target="_blank" rel="noreferrer" className="text-[0.78rem] text-primary hover:underline">
                      Ver fuente ↗
                    </a>
                  )}
                </div>

                <div className="flex flex-shrink-0 gap-2 border-t border-border bg-surface px-5 py-3.5">
                  <Button onClick={() => onSelect(preview)}>Use this article</Button>
                  <Button variant="ghost" onClick={onClose}>Cancel</Button>
                </div>
              </>
            ) : (
              <p className="p-5 text-sm text-muted-foreground">
                Select an article on the left to preview it.
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
