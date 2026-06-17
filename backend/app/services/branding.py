"""Best-effort recovery of a client's visual branding (site icon + logo) during
website analysis.

For WordPress sites the REST API index exposes `site_icon_url` and `site_logo`
(a media ID) directly. For any site we fall back to the HTML `<link rel="icon">`
favicon for the profile photo. The logo has no reliable non-WordPress source, so
it is left to the default when the site is not WordPress.
"""
import io
import logging
from urllib.parse import urljoin, urlparse

import httpx
from bs4 import BeautifulSoup
from PIL import Image
from sqlalchemy.orm import Session

from app.services.wordpress import discover_wp_api

logger = logging.getLogger(__name__)

MAX_IMAGE_BYTES = 5 * 1024 * 1024


def extract_brand_colors(image_bytes: bytes, max_colors: int = 5) -> list[str]:
    """Derive the dominant brand colors (hex) from a logo/icon image.

    Skips transparent pixels and near-white/near-black, returns the most frequent
    distinct colors. Best-effort: returns [] if the image can't be read.
    """
    try:
        img = Image.open(io.BytesIO(image_bytes)).convert("RGBA")
        img.thumbnail((128, 128))
        pixels = [(r, g, b) for r, g, b, a in img.getdata() if a > 128]
        if not pixels:
            return []
        # Quantize on the opaque pixels to find dominant colors.
        flat = Image.new("RGB", (len(pixels), 1))
        flat.putdata(pixels)
        quant = flat.quantize(colors=max(8, max_colors * 4)).convert("RGB")
        counts = sorted(quant.getcolors(maxcolors=100000) or [], reverse=True)
        result: list[str] = []
        for _count, (r, g, b) in counts:
            if r > 240 and g > 240 and b > 240:  # near-white
                continue
            if r < 18 and g < 18 and b < 18:  # near-black
                continue
            hex_code = f"#{r:02x}{g:02x}{b:02x}"
            # Skip colors very close to one already chosen.
            if any(abs(r - int(c[1:3], 16)) + abs(g - int(c[3:5], 16)) + abs(b - int(c[5:7], 16)) < 40 for c in result):
                continue
            result.append(hex_code)
            if len(result) >= max_colors:
                break
        return result
    except Exception as exc:  # noqa: BLE001
        logger.info("Brand color extraction failed: %s", exc)
        return []


def _to_png(data: bytes, content_type: str) -> tuple[bytes, str]:
    """Normalize a raster image to RGBA PNG so it composites cleanly onto
    generated campaign visuals, preserving any existing transparency.

    SVG is returned untouched (Pillow can't rasterize it); the campaign
    compositor already skips SVG layers.
    """
    if content_type == "image/svg+xml":
        return data, content_type
    try:
        img = Image.open(io.BytesIO(data))
        img.seek(0)  # ICO/multi-size: Pillow exposes the largest frame first
        img = img.convert("RGBA")
        buf = io.BytesIO()
        img.save(buf, format="PNG")
        return buf.getvalue(), "image/png"
    except Exception as exc:  # noqa: BLE001 — fall back to the original bytes
        logger.info("PNG normalization failed (%s): %s", content_type, exc)
        return data, content_type


def _user_agent(db: Session) -> str:
    from app.models.setting import Setting

    setting = db.get(Setting, "crawler_user_agent")
    return setting.value if setting else "AIMarketingPlatformBot/1.0"


def _download_image(db: Session, url: str | None) -> tuple[bytes, str] | None:
    """Fetch an image URL, returning (bytes, content_type) or None."""
    if not url:
        return None
    headers = {"User-Agent": _user_agent(db)}
    try:
        with httpx.Client(timeout=20, headers=headers, follow_redirects=True) as client:
            response = client.get(url)
        content_type = response.headers.get("content-type", "").split(";")[0].strip()
        if (
            response.status_code == 200
            and content_type.startswith("image/")
            and 0 < len(response.content) <= MAX_IMAGE_BYTES
        ):
            return _to_png(response.content, content_type)
    except httpx.HTTPError as exc:
        logger.info("Branding image download failed for %s: %s", url, exc)
    return None


def _wp_branding_urls(db: Session, api_base: str) -> tuple[str | None, str | None]:
    """Read site_icon_url and the site_logo media URL from the WP REST index."""
    headers = {"User-Agent": _user_agent(db), "Accept": "application/json"}
    icon_url: str | None = None
    logo_url: str | None = None
    try:
        with httpx.Client(timeout=20, headers=headers, follow_redirects=True) as client:
            index = client.get(f"{api_base}/").json()
            icon_url = index.get("site_icon_url") or None
            logo_id = index.get("site_logo")
            if logo_id:
                media = client.get(f"{api_base}/wp/v2/media/{logo_id}").json()
                logo_url = (media.get("source_url") or "") or None
    except (httpx.HTTPError, ValueError) as exc:
        logger.info("WordPress branding lookup failed at %s: %s", api_base, exc)
    return icon_url, logo_url


def _fetch_home(db: Session, site_url: str) -> tuple[BeautifulSoup | None, str]:
    """Fetch the homepage once; favicon and logo fallbacks both parse it."""
    headers = {"User-Agent": _user_agent(db)}
    try:
        with httpx.Client(timeout=20, headers=headers, follow_redirects=True) as client:
            response = client.get(site_url)
        if response.status_code == 200:
            return BeautifulSoup(response.text, "lxml"), str(response.url)
    except httpx.HTTPError as exc:
        logger.info("Homepage fetch failed for %s: %s", site_url, exc)
    return None, site_url


def _favicon_from_soup(soup: BeautifulSoup, base: str) -> str | None:
    """Best-effort favicon from the homepage's <link rel="...icon..."> tags."""
    best: str | None = None
    for link in soup.find_all("link", rel=True, href=True):
        rels = " ".join(link["rel"]).lower() if isinstance(link["rel"], list) else str(link["rel"]).lower()
        if "icon" in rels:
            href = urljoin(base, link["href"])
            # Prefer apple-touch-icon (usually larger) over a tiny .ico.
            if "apple-touch" in rels:
                return href
            best = best or href
    if best:
        return best
    parsed = urlparse(base)
    return f"{parsed.scheme}://{parsed.netloc}/favicon.ico"


def _logo_from_soup(soup: BeautifulSoup, base: str) -> str | None:
    """Best-effort site logo for sites that don't set the WordPress custom logo.

    Priority avoids partner/client logos further down the page: the theme's logo
    class, then the image inside the link back to the homepage, then the first
    image in the <header>.
    """
    parsed = urlparse(base)
    home_roots = {f"{parsed.scheme}://{parsed.netloc}", base.rstrip("/")}

    # 1. Standard theme logo classes (WordPress custom-logo, common "site-logo").
    for img in soup.find_all("img", src=True):
        classes = " ".join(img.get("class") or []).lower()
        if "custom-logo" in classes or "site-logo" in classes:
            return urljoin(base, img["src"])
    # 2. Logo wrapped in the link that points back to the homepage.
    for a in soup.find_all("a", href=True):
        if urljoin(base, a["href"]).rstrip("/") in home_roots:
            img = a.find("img", src=True)
            if img:
                return urljoin(base, img["src"])
    # 3. First image inside the page header.
    header = soup.find("header")
    if header:
        img = header.find("img", src=True)
        if img:
            return urljoin(base, img["src"])
    return None


def fetch_site_branding(db: Session, site_url: str) -> dict[str, tuple[bytes, str] | None]:
    """Return downloaded {"avatar": (bytes, ct)|None, "logo": (bytes, ct)|None}.

    Avatar = site icon; logo = site logo. WordPress is the reliable source for
    both; for sites that leave them unset we fall back to the homepage's favicon
    (avatar) and header/home-link logo image (logo).
    """
    icon_url: str | None = None
    logo_url: str | None = None
    api_base = discover_wp_api(db, site_url)
    if api_base:
        icon_url, logo_url = _wp_branding_urls(db, api_base)
    if not icon_url or not logo_url:
        soup, base = _fetch_home(db, site_url)
        if soup is not None:
            if not icon_url:
                icon_url = _favicon_from_soup(soup, base)
            if not logo_url:
                logo_url = _logo_from_soup(soup, base)
    return {"avatar": _download_image(db, icon_url), "logo": _download_image(db, logo_url)}
