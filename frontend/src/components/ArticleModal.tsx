import { Link } from "react-router-dom";
import type { Article } from "../types";

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
          <a href={article.source_url} target="_blank" rel="noreferrer" className="muted small">
            {article.source_url}
          </a>
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
              <button
                className="btn btn-ghost danger"
                onClick={() => {
                  if (window.confirm("Permanently delete this article?")) onAction(article.id, "", "DELETE");
                }}
              >
                Delete
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
