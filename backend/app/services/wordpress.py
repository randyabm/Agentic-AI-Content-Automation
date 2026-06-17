"""WordPress REST API ingestion.

Most client blogs run on WordPress, which exposes a public REST API at
`/wp-json/wp/v2/posts`. That returns title, author, date, content, excerpt and
terms (tags/categories) already structured — so we skip the crawl + slug
heuristics + per-article LLM metadata extraction entirely and only use the LLM
for the summary. See `article_intel.py` for the legacy scraping path that this
falls back to when a site is not WordPress.
"""
import html
import logging
from datetime import date
from urllib.parse import urlparse

import httpx
from bs4 import BeautifulSoup
from sqlalchemy.orm import Session

logger = logging.getLogger(__name__)


def _user_agent(db: Session) -> str:
    from app.models.setting import Setting

    setting = db.get(Setting, "crawler_user_agent")
    return setting.value if setting else "AIMarketingPlatformBot/1.0"


def _parse_date(value: str) -> date | None:
    value = (value or "").strip()
    if not value:
        return None
    try:
        return date.fromisoformat(value[:10])
    except ValueError:
        return None


def _html_to_text(raw: str) -> str:
    """Strip a WordPress `*.rendered` HTML field down to clean plain text."""
    if not raw:
        return ""
    soup = BeautifulSoup(raw, "lxml")
    for tag in soup(["script", "style", "noscript", "svg", "iframe"]):
        tag.decompose()
    return "\n".join(line.strip() for line in soup.get_text("\n").splitlines() if line.strip())


def _candidate_api_bases(site_url: str) -> list[str]:
    """WP REST API base candidates, most specific path first.

    Handles WordPress Multisite where the real blog lives under a subsite path
    (e.g. `https://site.com/au/wp-json`). The site root may exist too but expose
    a different (often near-empty) post set, so subsite candidates come first.
    """
    parsed = urlparse(site_url if "://" in site_url else f"https://{site_url}")
    root = f"{parsed.scheme}://{parsed.netloc}"
    segments = [s for s in parsed.path.split("/") if s]
    bases: list[str] = []
    for i in range(len(segments), -1, -1):
        prefix = "/" + "/".join(segments[:i]) if i else ""
        bases.append(f"{root}{prefix}/wp-json")
    return bases


def discover_wp_api(db: Session, site_url: str) -> str | None:
    """Return the best WP REST API base for the site, or None if not WordPress.

    Probes each candidate base (subsite paths first, then root) and picks the one
    advertising the most posts via the `X-WP-Total` header — so Multisite blogs
    under a subsite path win over a near-empty root install.
    """
    headers = {"User-Agent": _user_agent(db), "Accept": "application/json"}
    best: str | None = None
    best_total = -1
    with httpx.Client(timeout=20, headers=headers, follow_redirects=True) as client:
        for api_base in _candidate_api_bases(site_url):
            try:
                response = client.get(f"{api_base}/wp/v2/posts", params={"per_page": 1})
                if response.status_code != 200 or not isinstance(response.json(), list):
                    continue
                total = int(response.headers.get("X-WP-Total", 0))
            except (httpx.HTTPError, ValueError) as exc:
                logger.info("WordPress API not detected at %s: %s", api_base, exc)
                continue
            if total > best_total:
                best, best_total = api_base, total
    return best


def _map_post(post: dict) -> dict:
    embedded = post.get("_embedded", {}) or {}
    # Some sites disable the users endpoint, so the embedded author is an error
    # object with no "name" — that degrades to an empty author, which is fine.
    authors = embedded.get("author") or []
    author = html.unescape(str(authors[0].get("name", "")).strip()) if authors else ""

    tags: list[str] = []
    for group in embedded.get("wp:term", []) or []:
        for term in group or []:
            name = html.unescape(str(term.get("name", "")).strip())
            if name and name.lower() != "uncategorized" and name not in tags:
                tags.append(name)

    return {
        "title": html.unescape(str(post.get("title", {}).get("rendered", "")).strip()),
        "author": author,
        "publication_date": _parse_date(str(post.get("date", ""))),
        "url": str(post.get("link", "")).rstrip("/"),
        "body": _html_to_text(post.get("content", {}).get("rendered", "")),
        "excerpt": _html_to_text(post.get("excerpt", {}).get("rendered", "")),
        "tags": tags,
    }


def fetch_wp_posts(
    db: Session,
    api_base: str,
    limit: int,
    *,
    after_date: date | None = None,
    before_date: date | None = None,
) -> list[dict]:
    """Page through published posts (newest first) and map them to article dicts.

    Optional `after_date`/`before_date` are passed to the WP REST API `after`/`before`
    params (ISO8601), so the server does the date filtering before we receive results.
    """
    headers = {"User-Agent": _user_agent(db), "Accept": "application/json"}
    per_page = min(100, max(1, limit))
    posts: list[dict] = []
    page = 1
    with httpx.Client(timeout=30, headers=headers, follow_redirects=True) as client:
        while len(posts) < limit:
            params: dict = {
                "_embed": "1",
                "per_page": per_page,
                "page": page,
                "orderby": "date",
                "order": "desc",
            }
            if after_date:
                params["after"] = after_date.isoformat() + "T00:00:00"
            if before_date:
                params["before"] = before_date.isoformat() + "T23:59:59"
            response = client.get(f"{api_base}/wp/v2/posts", params=params)
            if response.status_code != 200:
                break
            batch = response.json()
            if not isinstance(batch, list) or not batch:
                break
            posts.extend(_map_post(p) for p in batch)
            total_pages = int(response.headers.get("X-WP-TotalPages", page))
            if page >= total_pages:
                break
            page += 1
    return posts[:limit]


def fetch_wp_post_by_url(db: Session, url: str) -> dict | None:
    """Resolve a single post by its URL via the WP API, or None if not WordPress."""
    api_base = discover_wp_api(db, url)
    if api_base is None:
        return None
    slug = urlparse(url).path.rstrip("/").rsplit("/", 1)[-1]
    if not slug:
        return None
    headers = {"User-Agent": _user_agent(db), "Accept": "application/json"}
    try:
        with httpx.Client(timeout=20, headers=headers, follow_redirects=True) as client:
            response = client.get(f"{api_base}/wp/v2/posts", params={"slug": slug, "_embed": "1"})
        if response.status_code == 200:
            batch = response.json()
            if isinstance(batch, list) and batch:
                return _map_post(batch[0])
    except (httpx.HTTPError, ValueError) as exc:
        logger.info("WordPress post lookup failed for %s: %s", url, exc)
    return None
