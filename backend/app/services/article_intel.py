"""Article ingestion (PRD §7): single-article extraction and blog-section
discovery for the Internal Article Library.
"""
import logging
import re
from datetime import date
from urllib.parse import urldefrag, urljoin, urlparse

import httpx
from bs4 import BeautifulSoup
from sqlalchemy.orm import Session

from app.services.crawler import SKIP_EXTENSIONS, fetch_page
from app.services.extraction import (
    ExtractionError,
    build_corpus,
    complete_text,
    get_llm_config,
    parse_json_value,
)
from app.models.llm import LLMFunction
from app.services.crawler import CrawledPage

logger = logging.getLogger(__name__)

# The LLM returns only small metadata fields — never the full body — so the JSON
# response stays well within max_tokens. The body is taken from the cleaned crawl
# text instead, which avoids truncated/invalid JSON on long articles.
ARTICLE_INSTRUCTIONS = """\
You are given the crawled text of a single web page. Determine whether it is a genuine
article/blog post (not a category index, product page, contact page, or navigation page),
then extract its metadata. Answer ONLY with a single JSON object:

{
  "is_article": boolean,
  "title": string,
  "author": string (empty string if none found),
  "publication_date": string in YYYY-MM-DD format (empty string if none found),
  "summary": string (a 200-400 word summary of the article in English),
  "tags": [string, ...] (3-8 topic tags in English)
}

If it is not an article, set "is_article" to false and leave the other fields empty.
Write the summary and tags in English even if the source is in another language.
Do not include the article body — only the fields above.
"""

# Path fragments that are almost never individual articles.
NON_ARTICLE_HINTS = (
    "/category/", "/categories/", "/tag/", "/tags/", "/author/", "/page/",
    "/about", "/contact", "/privacy", "/terms", "/login", "/signup", "/search",
    "/cart", "/checkout", "/pricing", "/feed",
)


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


def fetch_clean_page(db: Session, url: str) -> CrawledPage:
    headers = {"User-Agent": _user_agent(db)}
    with httpx.Client(timeout=20, headers=headers, follow_redirects=True) as client:
        response = fetch_page(client, url)
    if response is None:
        raise ExtractionError(f"Could not fetch the page at {url}")
    soup = BeautifulSoup(response.text, "lxml")
    for tag in soup(["script", "style", "noscript", "svg", "iframe"]):
        tag.decompose()
    title = soup.title.get_text(strip=True) if soup.title else ""
    text = "\n".join(line.strip() for line in soup.get_text("\n").splitlines() if line.strip())
    return CrawledPage(url=str(response.url), title=title, text=text)


def extract_article(db: Session, page: CrawledPage) -> dict:
    """Run the article_analysis LLM over a single page and return structured fields."""
    cfg = get_llm_config(db, LLMFunction.article_analysis)
    corpus = build_corpus([page])
    raw = complete_text(cfg, cfg.system_prompt, f"{ARTICLE_INSTRUCTIONS}\n\nPAGE CONTENT:\n\n{corpus}")
    data = parse_json_value(raw)
    return {
        "is_article": bool(data.get("is_article", True)),
        "title": str(data.get("title", "")).strip() or page.title,
        "author": str(data.get("author", "")).strip(),
        "publication_date": _parse_date(str(data.get("publication_date", ""))),
        "summary": str(data.get("summary", "")).strip(),
        "body": page.text,  # full cleaned text from the crawler, not the LLM
        "tags": [str(t).strip() for t in data.get("tags", []) if str(t).strip()],
    }


def _looks_like_article(path: str, section_path: str) -> bool:
    """Heuristic: a link is a candidate article if it is either a child of the
    section path, or a root-level page whose slug looks like a post title.

    Blog platforms commonly list posts at `/section/` but serve them at the site
    root (e.g. `/what-is-x-and-why-it-matters/`). Post slugs are long and
    multi-word, while nav/product pages are short (`/solutions/`, `/pricing/`).
    The LLM `is_article` check is the second gate, so this can be permissive.
    """
    if path == section_path:
        return False
    if path.startswith(section_path + "/") and len(path) > len(section_path) + 1:
        return True
    last_segment = path.rstrip("/").rsplit("/", 1)[-1]
    # 5+ words in the slug strongly suggests an article title.
    return last_segment.count("-") >= 4


def discover_article_urls(db: Session, section_url: str, limit: int) -> list[str]:
    """Fetch a blog/section page and return candidate article URLs."""
    section = urldefrag(section_url)[0].rstrip("/")
    domain = urlparse(section).netloc
    section_path = urlparse(section).path.rstrip("/")
    headers = {"User-Agent": _user_agent(db)}
    candidates: list[str] = []
    seen: set[str] = set()

    with httpx.Client(timeout=20, headers=headers, follow_redirects=True) as client:
        response = fetch_page(client, section)
        if response is None:
            raise ExtractionError(f"Could not fetch the source section at {section_url}")
        soup = BeautifulSoup(response.text, "lxml")
        for anchor in soup.find_all("a", href=True):
            link = urldefrag(urljoin(str(response.url), anchor["href"]))[0].rstrip("/")
            parsed = urlparse(link)
            path = parsed.path.rstrip("/")
            if (
                parsed.scheme in ("http", "https")
                and parsed.netloc == domain
                and link not in seen
                and not link.lower().endswith(SKIP_EXTENSIONS)
                and not any(h in link.lower() for h in NON_ARTICLE_HINTS)
                and not re.search(r"/page/\d+", link)
                and _looks_like_article(path, section_path)
            ):
                seen.add(link)
                candidates.append(link)
            if len(candidates) >= limit * 3:  # over-collect; LLM filters non-articles later
                break
    return candidates
