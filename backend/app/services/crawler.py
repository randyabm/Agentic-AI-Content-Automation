"""Domain-bounded BFS website crawler (PRD §3.3–3.4).

Uses httpx + BeautifulSoup. The fetch step is isolated behind `fetch_page` so a
Playwright-based fetcher can be swapped in later for JavaScript-heavy sites.
"""
import logging
import re
from collections import deque
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


@dataclass
class CrawlConfig:
    max_depth: int = 5
    max_pages: int = 200
    timeout_seconds: int = 10
    excluded_patterns: list[str] = field(default_factory=list)
    user_agent: str = "AIMarketingPlatformBot/1.0"


@dataclass
class CrawledPage:
    url: str
    title: str
    text: str


def fetch_page(client: httpx.Client, url: str) -> httpx.Response | None:
    try:
        response = client.get(url, follow_redirects=True)
        if response.status_code == 200 and "text/html" in response.headers.get("content-type", ""):
            return response
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


def crawl_site(
    start_url: str,
    config: CrawlConfig,
    on_progress=None,
) -> list[CrawledPage]:
    """BFS crawl limited to the start URL's domain. Calls on_progress(pages_crawled, queued)."""
    start = urldefrag(start_url)[0].rstrip("/")
    domain = urlparse(start).netloc
    visited: set[str] = set()
    pages: list[CrawledPage] = []
    queue: deque[tuple[str, int]] = deque([(start, 0)])

    headers = {"User-Agent": config.user_agent, "Accept-Language": "en;q=0.9,*;q=0.5"}
    with httpx.Client(timeout=config.timeout_seconds, headers=headers) as client:
        while queue and len(pages) < config.max_pages:
            url, depth = queue.popleft()
            if url in visited:
                continue
            visited.add(url)

            response = fetch_page(client, url)
            if response is None:
                continue

            soup = BeautifulSoup(response.text, "lxml")
            title = soup.title.get_text(strip=True) if soup.title else ""
            pages.append(CrawledPage(url=url, title=title, text=_extract_text(soup)))
            if on_progress:
                on_progress(len(pages), len(queue))

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
                    queue.append((link, depth + 1))

    return pages
