from datetime import date, datetime

from pydantic import BaseModel, ConfigDict, Field, HttpUrl

from app.models.article import ArticleEntryType, ArticleStatus, SyncFrequency


class ArticleFromUrl(BaseModel):
    """Add an article by URL — the system fetches and extracts it."""

    url: HttpUrl


class ArticleFromText(BaseModel):
    """Add an article by pasting its body; metadata is supplied manually."""

    title: str = Field(min_length=1)
    body: str = Field(min_length=1)
    author: str = ""
    publication_date: date | None = None
    source_url: str = ""
    tags: list[str] = []


class ArticleUpdate(BaseModel):
    title: str | None = None
    author: str | None = None
    publication_date: date | None = None
    source_url: str | None = None
    summary: str | None = None
    body: str | None = None
    tags: list[str] | None = None
    status: ArticleStatus | None = None


class ArticleOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    title: str
    author: str
    publication_date: date | None
    source_url: str
    summary: str
    body: str
    tags: list
    entry_type: ArticleEntryType
    status: ArticleStatus
    needs_review: bool
    source_id: str | None
    client_id: str | None
    last_used_in_campaign: datetime | None
    created_at: datetime
    updated_at: datetime


class ArticleListItem(BaseModel):
    """Lightweight projection for the library list (omits full body)."""

    model_config = ConfigDict(from_attributes=True)

    id: str
    title: str
    author: str
    publication_date: date | None
    source_url: str
    summary: str
    tags: list
    entry_type: ArticleEntryType
    status: ArticleStatus
    needs_review: bool
    client_id: str | None
    created_at: datetime


class WordPressImportRequest(BaseModel):
    """Import a client's articles via the WordPress REST API."""

    limit: int = Field(default=50, ge=1, le=200)


class WordPressImportResponse(BaseModel):
    detail: str
    api_base: str
    limit: int


class ArticleSourceCreate(BaseModel):
    name: str = ""
    url: HttpUrl
    frequency: SyncFrequency = SyncFrequency.weekly
    max_articles_per_sync: int = Field(default=50, ge=1, le=500)
    auto_publish: bool = False
    duplicate_detection: bool = True
    is_active: bool = True


class ArticleSourceUpdate(BaseModel):
    name: str | None = None
    url: HttpUrl | None = None
    frequency: SyncFrequency | None = None
    max_articles_per_sync: int | None = Field(default=None, ge=1, le=500)
    auto_publish: bool | None = None
    duplicate_detection: bool | None = None
    is_active: bool | None = None


class ArticleSourceOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    name: str
    url: str
    frequency: SyncFrequency
    max_articles_per_sync: int
    auto_publish: bool
    duplicate_detection: bool
    is_active: bool
    last_synced_at: datetime | None
    last_sync_status: str
    last_sync_detail: str
    created_at: datetime
