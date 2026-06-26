from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import Text, func, or_, select
from sqlalchemy.orm import Session

from app.api.deps import get_current_user, org_client_filter, require_editor, require_platform_admin
from app.db.session import get_db
from app.models.article import (
    Article,
    ArticleEntryType,
    ArticleSource,
    ArticleSourceSyncStatus,
    ArticleStatus,
)
from app.models.client import Client
from app.models.user import User
from app.schemas.article import (
    ArticleFromText,
    ArticleFromUrl,
    ArticleListItem,
    ArticleOut,
    ArticleSourceCreate,
    ArticleSourceOut,
    ArticleSourceUpdate,
    ArticleUpdate,
)
from app.services import audit
from app.workers.tasks import import_article_from_url, sync_source

router = APIRouter(prefix="/articles", tags=["articles"])


def _get_article_or_404(db: Session, article_id: str, user: User) -> Article:
    """Load an article, enforcing that a client-associated article belongs to the
    caller's org. Articles with no client (manually added to the shared global
    pool) are visible to everyone.

    NOTE: strict isolation of null-client articles needs an `Article.org_id`
    column (tracked as a follow-up); today they are treated as a shared pool.
    """
    article = db.get(Article, article_id)
    if article is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Article not found")
    if article.client_id is not None:
        client = db.get(Client, article.client_id)
        if client is None or client.org_id != user.org_id:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Article not found")
    return article


# --- Library browsing & search (PRD §7.6) ---


@router.get("", response_model=list[ArticleListItem])
def list_articles(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
    q: str = Query("", description="Keyword across title, author, summary, tags"),
    entry_type: ArticleEntryType | None = None,
    article_status: ArticleStatus | None = None,
    needs_review: bool | None = None,
    client_id: str | None = None,
    tag: str | None = None,
    limit: int = Query(100, le=500),
    offset: int = 0,
):
    query = select(Article)
    # Tenant isolation: client-associated articles only within the caller's org;
    # null-client (shared global pool) articles remain visible to all.
    scope = org_client_filter(user)
    if scope is not None:
        query = query.outerjoin(Client, Article.client_id == Client.id).where(
            or_(Client.org_id == user.org_id, Article.client_id.is_(None))
        )
    if q:
        like = f"%{q.lower()}%"
        query = query.where(
            or_(
                func.lower(Article.title).like(like),
                func.lower(Article.author).like(like),
                func.lower(Article.summary).like(like),
                func.lower(func.cast(Article.tags, Text)).like(like),
            )
        )
    if entry_type is not None:
        query = query.where(Article.entry_type == entry_type)
    if article_status is not None:
        query = query.where(Article.status == article_status)
    if needs_review is not None:
        query = query.where(Article.needs_review.is_(needs_review))
    if client_id:
        query = query.where(Article.client_id == client_id)
    if tag:
        query = query.where(func.cast(Article.tags, Text).like(f'%"{tag}"%'))
    query = query.order_by(Article.created_at.desc()).limit(limit).offset(offset)
    return db.scalars(query).all()


@router.get("/{article_id}", response_model=ArticleOut)
def get_article(article_id: str, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    return _get_article_or_404(db, article_id, user)


# --- Manual entry (PRD §7.2.2) ---


@router.post("/from-url", response_model=ArticleOut, status_code=status.HTTP_202_ACCEPTED)
def add_from_url(body: ArticleFromUrl, db: Session = Depends(get_db), actor: User = Depends(require_editor)):
    url = str(body.url).rstrip("/")
    if db.scalar(select(Article).where(Article.source_url == url)):
        raise HTTPException(status.HTTP_409_CONFLICT, "An article with this URL is already in the library")
    article = Article(
        title=url,
        source_url=url,
        entry_type=ArticleEntryType.manual,
        summary="[Fetching and extracting…]",
    )
    db.add(article)
    db.commit()
    import_article_from_url.delay(article.id)
    audit.record(db, actor, "article.add_url", "article", article.id, {"url": url})
    return article


@router.post("/from-text", response_model=ArticleOut, status_code=status.HTTP_201_CREATED)
def add_from_text(body: ArticleFromText, db: Session = Depends(get_db), actor: User = Depends(require_editor)):
    article = Article(
        title=body.title,
        author=body.author,
        publication_date=body.publication_date,
        source_url=body.source_url.rstrip("/"),
        body=body.body,
        tags=body.tags,
        entry_type=ArticleEntryType.manual,
        status=ArticleStatus.active,
    )
    db.add(article)
    db.commit()
    audit.record(db, actor, "article.add_text", "article", article.id, {"title": body.title})
    return article


@router.patch("/{article_id}", response_model=ArticleOut)
def update_article(
    article_id: str, body: ArticleUpdate, db: Session = Depends(get_db), actor: User = Depends(require_editor)
):
    article = _get_article_or_404(db, article_id, actor)
    changes = body.model_dump(exclude_unset=True)
    for field, value in changes.items():
        setattr(article, field, value)
    db.commit()
    audit.record(db, actor, "article.update", "article", article.id, {"fields": list(changes.keys())})
    return article


@router.post("/{article_id}/approve", response_model=ArticleOut)
def approve_article(article_id: str, db: Session = Depends(get_db), actor: User = Depends(require_editor)):
    """Approve an auto-synced article that was queued for review (PRD §7.4)."""
    article = _get_article_or_404(db, article_id, actor)
    article.needs_review = False
    db.commit()
    audit.record(db, actor, "article.approve", "article", article.id)
    return article


@router.post("/{article_id}/archive", response_model=ArticleOut)
def archive_article(article_id: str, db: Session = Depends(get_db), actor: User = Depends(require_editor)):
    article = _get_article_or_404(db, article_id, actor)
    article.status = ArticleStatus.archived
    db.commit()
    audit.record(db, actor, "article.archive", "article", article.id)
    return article


@router.delete("/{article_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_article(article_id: str, db: Session = Depends(get_db), actor: User = Depends(require_editor)):
    """Permanently delete an article in the caller's org (PRD §7.6)."""
    article = _get_article_or_404(db, article_id, actor)
    db.delete(article)
    db.commit()
    audit.record(db, actor, "article.delete", "article", article_id)


# --- Auto-sync source configuration (PRD §7.4) — Admin only ---

sources_router = APIRouter(prefix="/article-sources", tags=["article-sources"])


@sources_router.get("", response_model=list[ArticleSourceOut])
def list_sources(db: Session = Depends(get_db), _: User = Depends(require_platform_admin)):
    return db.scalars(select(ArticleSource).order_by(ArticleSource.created_at)).all()


@sources_router.post("", response_model=ArticleSourceOut, status_code=status.HTTP_201_CREATED)
def create_source(body: ArticleSourceCreate, db: Session = Depends(get_db), actor: User = Depends(require_platform_admin)):
    source = ArticleSource(
        name=body.name or str(body.url),
        url=str(body.url),
        frequency=body.frequency,
        max_articles_per_sync=body.max_articles_per_sync,
        auto_publish=body.auto_publish,
        duplicate_detection=body.duplicate_detection,
        is_active=body.is_active,
    )
    db.add(source)
    db.commit()
    audit.record(db, actor, "article_source.create", "article_source", source.id, {"url": source.url})
    return source


@sources_router.patch("/{source_id}", response_model=ArticleSourceOut)
def update_source(
    source_id: str, body: ArticleSourceUpdate, db: Session = Depends(get_db), actor: User = Depends(require_platform_admin)
):
    source = db.get(ArticleSource, source_id)
    if source is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Source not found")
    changes = body.model_dump(exclude_unset=True)
    if "url" in changes:
        changes["url"] = str(changes["url"])
    for field, value in changes.items():
        setattr(source, field, value)
    db.commit()
    audit.record(db, actor, "article_source.update", "article_source", source.id)
    return source


@sources_router.delete("/{source_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_source(source_id: str, db: Session = Depends(get_db), actor: User = Depends(require_platform_admin)):
    source = db.get(ArticleSource, source_id)
    if source is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Source not found")
    db.delete(source)
    db.commit()
    audit.record(db, actor, "article_source.delete", "article_source", source_id)


@sources_router.post("/{source_id}/sync", response_model=ArticleSourceOut, status_code=status.HTTP_202_ACCEPTED)
def trigger_sync(source_id: str, db: Session = Depends(get_db), actor: User = Depends(require_platform_admin)):
    """Run an on-demand sync now (PRD §7.2.1 'or on demand')."""
    source = db.get(ArticleSource, source_id)
    if source is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Source not found")
    if source.last_sync_status == ArticleSourceSyncStatus.running:
        raise HTTPException(status.HTTP_409_CONFLICT, "A sync is already running for this source")
    source.last_sync_status = ArticleSourceSyncStatus.running
    db.commit()
    sync_source.delay(source.id)
    audit.record(db, actor, "article_source.sync", "article_source", source.id)
    return source
