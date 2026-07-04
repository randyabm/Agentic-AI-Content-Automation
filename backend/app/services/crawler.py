"""Domain-bounded BFS website crawler (PRD §3.3–3.4).

Uses httpx + BeautifulSoup. The fetch step is isolated behind `fetch_page` so a
Playwright-based fetcher can be swapped in later for JavaScript-heavy sites.

Crawling is level-synchronous BFS: each depth level is fetched concurrently with a
thread pool, and newly discovered links are ordered so high-signal pages (about,
products, services, pricing…) are visited first. This keeps wall-clock time low and
makes the `max_pages` budget land on the most useful pages.
"""
import logging
import re
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field
from urllib.parse import urldefrag, urljoin, urlparse

import httpx
from bs4 import BeautifulSoup

logger = logging.getLogger(__name__)

SKIP_EXTENSIONS = (
    ".pdf", ".jpg", ".jpeg", ".png", ".gif", ".svg", ".webp", ".ico",
    ".zip", ".rar", ".mp4", ".mp3", ".avi", ".mov", ".css", ".js",
    ".xml", ".json", ".woff", ".woff2", ".ttf",
)

# High-signal URL path fragments for profile extraction; matching pages are crawled
# first so a tight max_pages budget captures the most useful content.
PRIORITY_PATTERNS = (
    "about", "about-us", "company", "who-we-are", "our-story", "team",
    "product", "products", "service", "services", "solution", "solutions",
    "pricing", "plans", "features", "what-we-do",
    # Spanish-language equivalents (clients/competitors are often LATAM/ES sites)
    "nosotros", "quienes-somos", "empresa", "productos", "servicios", "soluciones", "precios",
)


@dataclass
class CrawlConfig:
    max_depth: int = 5
    max_pages: int = 200
    timeout_seconds: int = 10
    concurrency: int = 8
    excluded_patterns: list[str] = field(default_factory=list)
    user_agent: str = "AIMarketingPlatformBot/1.0"


@dataclass
class CrawledPage:
    url: str
    title: str
    text: str


def fetch_page(client: httpx.Client, url: str) -> httpx.Response | None:
    from app.core.ssrf import SSRFError, assert_url_is_safe

    try:
        assert_url_is_safe(url)
    except SSRFError as exc:
        logger.warning("Blocked SSRF-unsafe URL %s: %s", url, exc)
        return None
    try:
        response = client.get(url, follow_redirects=True)
        # A redirect could land on an internal address; re-check the final URL.
        assert_url_is_safe(str(response.url))
        if response.status_code == 200 and "text/html" in response.headers.get("content-type", ""):
            return response
    except SSRFError as exc:
        logger.warning("Blocked SSRF-unsafe redirect from %s: %s", url, exc)
    except httpx.HTTPError as exc:
        logger.warning("Fetch failed for %s: %s", url, exc)
    return None


def _extract_text(soup: BeautifulSoup) -> str:
    for tag in soup(["script", "style", "noscript", "svg", "iframe"]):
        tag.decompose()
    text = soup.get_text(separator="\n")
    lines = [line.strip() for line in text.splitlines()]
    return "\n".join(line for line in lines if line)


def _is_excluded(url: str, patterns: list[str]) -> bool:
    path = urlparse(url).path
    for pattern in patterns:
        try:
            if re.search(pattern, path):
                return True
        except re.error:
            logger.warning("Invalid excluded-path regex skipped: %s", pattern)
    return False


def _priority(url: str) -> int:
    """Lower sorts first. Shorter paths and high-signal pages are preferred."""
    path = urlparse(url).path.lower()
    has_signal = any(fragment in path for fragment in PRIORITY_PATTERNS)
    return (0 if has_signal else 1, path.count("/"), len(path))


def crawl_site(
    start_url: str,
    config: CrawlConfig,
    on_progress=None,
) -> list[CrawledPage]:
    """BFS crawl limited to the start URL's domain, fetching each depth level
    concurrently. Calls on_progress(pages_crawled, queued)."""
    start = urldefrag(start_url)[0].rstrip("/")
    domain = urlparse(start).netloc
    visited: set[str] = {start}
    pages: list[CrawledPage] = []
    current_level: list[str] = [start]

    headers = {"User-Agent": config.user_agent, "Accept-Language": "en;q=0.9,*;q=0.5"}
    with httpx.Client(timeout=config.timeout_seconds, headers=headers) as client:
        depth = 0
        while current_level and len(pages) < config.max_pages:
            # Only fetch as many as the remaining page budget allows; current_level is
            # already priority-ordered, so this keeps the most useful pages.
            batch = current_level[: config.max_pages - len(pages)]
            workers = max(1, min(config.concurrency, len(batch)))
            with ThreadPoolExecutor(max_workers=workers) as pool:
                responses = list(pool.map(lambda u: (u, fetch_page(client, u)), batch))

            next_links: list[str] = []
            for url, response in responses:
                if response is None:
                    continue
                soup = BeautifulSoup(response.text, "lxml")
                title = soup.title.get_text(strip=True) if soup.title else ""
                pages.append(CrawledPage(url=url, title=title, text=_extract_text(soup)))
                if on_progress:
                    # Queued estimate: links discovered for the next level so far.
                    on_progress(len(pages), len(next_links))

                if depth >= config.max_depth:
                    continue
                for anchor in soup.find_all("a", href=True):
                    link = urldefrag(urljoin(str(response.url), anchor["href"]))[0].rstrip("/")
                    parsed = urlparse(link)
                    if (
                        parsed.scheme in ("http", "https")
                        and parsed.netloc == domain
                        and link not in visited
                        and not link.lower().endswith(SKIP_EXTENSIONS)
                        and not _is_excluded(link, config.excluded_patterns)
                    ):
                        visited.add(link)
                        next_links.append(link)

            current_level = sorted(next_links, key=_priority)
            depth += 1

    return pages
