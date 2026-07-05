import { Link } from "react-router-dom";
import { X } from "lucide-react";
import type { Article } from "../types";
import { useConfirm } from "@/components/ui/dialogs";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

export function ArticleModal({
  article,
  canEdit,
  isAdmin,
  onClose,
  onAction,
}: {
  article: Article;
  canEdit: boolean;
  isAdmin: boolean;
  onClose: () => void;
  onAction: (id: string, path: string, method?: string) => void;
}) {
  const confirm = useConfirm();
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-slate-900/45 p-6 backdrop-blur-sm" onClick={onClose}>
      <div
        className="w-full max-w-[760px] overflow-y-auto rounded-xl bg-surface p-6 max-h-[88vh]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-start justify-between gap-4">
          <h2 className="m-0 text-xl font-semibold">{article.title}</h2>
          <Button variant="ghost" size="sm" onClick={onClose}><X size={14} /></Button>
        </div>
        <p className="text-sm text-muted-foreground">
          {article.author && `${article.author} · `}
          {article.publication_date ?? "no date"} ·{" "}
          <Badge variant={article.entry_type === "auto" ? "secondary" : "success"}>{article.entry_type}</Badge>
          {article.needs_review && (
            <Badge variant="destructive" className="ml-1">needs review</Badge>
          )}
        </p>
        {article.source_url && (
          <a href={article.source_url} target="_blank" rel="noreferrer" className="text-sm text-muted-foreground hover:underline">
            {article.source_url}
          </a>
        )}
        <div className="my-1.5 flex flex-wrap gap-1.5">
          {article.tags.map((t) => <Badge key={t} variant="secondary">{t}</Badge>)}
        </div>
        <h4>Summary</h4>
        <p>{article.summary}</p>
        <h4>Body</h4>
        <div className="max-h-[40vh] overflow-y-auto whitespace-pre-wrap rounded-lg border border-border bg-surface-alt p-3 leading-relaxed">
          {article.body}
        </div>
        {canEdit && (
          <div className="mt-3 flex flex-wrap gap-2 border-t border-border pt-4">
            <Button asChild>
              <Link to={`/campaigns?from_article=${article.id}`}>Create content</Link>
            </Button>
            {article.needs_review && (
              <Button variant="ghost" onClick={() => onAction(article.id, "/approve")}>Approve</Button>
            )}
            {article.status === "active" && (
              <Button variant="ghost" onClick={() => onAction(article.id, "/archive")}>Archive</Button>
            )}
            {isAdmin && (
              <Button
                variant="ghost"
                className="text-red-600 hover:bg-red-50 dark:hover:bg-red-950/40"
                onClick={async () => {
                  const ok = await confirm({
                    title: "Delete article",
                    description: "This permanently deletes the article from the library.",
                    confirmLabel: "Delete",
                    destructive: true,
                  });
                  if (ok) onAction(article.id, "", "DELETE");
                }}
              >
                Delete
              </Button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
