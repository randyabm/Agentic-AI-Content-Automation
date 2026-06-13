"""Campaign export (PRD §5.7): ZIP per platform, PDF, structured JSON, and copy CSV.

v1.1 produces content for manual export; direct publishing is planned for v2.0.
"""
import csv
import io
import json
import logging
import zipfile

from fpdf import FPDF
from fpdf.enums import XPos, YPos
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.campaign import Campaign, CampaignElement, CampaignPlatform, Post, PostImage, PostVideo
from app.models.client import Client
from app.services import storage
from app.services.compositing import composite_post_image

logger = logging.getLogger(__name__)


def _ordered_posts(db: Session, campaign: Campaign) -> list[Post]:
    return list(
        db.scalars(
            select(Post).where(Post.campaign_id == campaign.id).order_by(Post.platform, Post.position)
        ).all()
    )


def _post_visuals(db: Session, post: Post) -> tuple[list[PostImage], list[PostVideo]]:
    """The element renditions a post publishes: those matching its platform's ratio."""
    element = db.get(CampaignElement, post.element_id) if post.element_id else None
    if element is None:
        return [], []
    ratio = (element.platform_ratios or {}).get(post.platform.value)
    images = [i for i in element.images if not ratio or i.aspect_ratio == ratio]
    videos = [v for v in element.videos if not ratio or v.aspect_ratio == ratio]
    return images, videos


def _final_image_bytes(db: Session, image: PostImage, client: Client) -> bytes | None:
    """Prefer a stored composite; otherwise composite on the fly; else the raw base."""
    if image.composited_object_key:
        try:
            return storage.get_object(image.composited_object_key)[0]
        except Exception:  # noqa: BLE001
            pass
    if not image.base_object_key:
        return None
    if image.canvas_state:
        try:
            return composite_post_image(db, image, client)
        except Exception as exc:  # noqa: BLE001
            logger.warning("Composite failed for image %s: %s", image.id, exc)
    try:
        return storage.get_object(image.base_object_key)[0]
    except Exception:  # noqa: BLE001
        return None


def _ascii(text: str) -> str:
    """fpdf2 core fonts are latin-1 only; drop characters they can't encode."""
    return (text or "").encode("latin-1", "replace").decode("latin-1")


def campaign_payload(db: Session, campaign: Campaign, client: Client) -> dict:
    posts = _ordered_posts(db, campaign)
    platforms = {
        cp.platform.value: cp
        for cp in db.scalars(select(CampaignPlatform).where(CampaignPlatform.campaign_id == campaign.id)).all()
    }
    return {
        "campaign": {
            "id": campaign.id,
            "name": campaign.name,
            "objective": campaign.objective.value,
            "central_theme": campaign.central_theme,
            "content_language": campaign.content_language,
            "creativity_level": campaign.creativity_level,
            "start_date": campaign.start_date.isoformat() if campaign.start_date else None,
            "end_date": campaign.end_date.isoformat() if campaign.end_date else None,
        },
        "client": {"id": client.id, "company_name": client.company_name},
        "platforms": [
            {
                "platform": p.platform.value,
                "hashtag_mix": p.hashtag_mix,
            }
            for p in platforms.values()
        ],
        "posts": [
            _post_payload(db, post)
            for post in posts
        ],
    }


def _post_payload(db: Session, post: Post) -> dict:
    images, videos = _post_visuals(db, post)
    return {
        "platform": post.platform.value,
        "position": post.position,
        "headline": post.headline,
        "copy": post.copy,
        "cta": post.cta,
        "hashtags": post.hashtags,
        "best_time": post.best_time,
        "rationale": post.rationale,
        "images": [
            {
                "slot_index": img.slot_index,
                "aspect_ratio": img.aspect_ratio,
                "prompt": img.prompt,
                "negative_prompt": img.negative_prompt,
                "has_image": bool(img.base_object_key),
            }
            for img in images
        ],
        "videos": [
            {
                "aspect_ratio": vid.aspect_ratio,
                "duration_seconds": vid.duration_seconds,
                "prompt": vid.prompt,
                "status": vid.status.value,
                "has_video": bool(vid.base_object_key),
            }
            for vid in videos
        ],
    }


def export_json(db: Session, campaign: Campaign, client: Client) -> tuple[bytes, str, str]:
    payload = campaign_payload(db, campaign, client)
    data = json.dumps(payload, indent=2, ensure_ascii=False).encode("utf-8")
    return data, f"campaign_{campaign.id}.json", "application/json"


def export_csv(db: Session, campaign: Campaign, client: Client) -> tuple[bytes, str, str]:
    buf = io.StringIO()
    writer = csv.writer(buf)
    writer.writerow(["Platform", "Post #", "Headline", "Copy", "CTA", "Hashtags", "Best time"])
    for post in _ordered_posts(db, campaign):
        writer.writerow([
            post.platform.value,
            post.position + 1,
            post.headline,
            post.copy,
            post.cta,
            " ".join(post.hashtags),
            post.best_time,
        ])
    return buf.getvalue().encode("utf-8-sig"), f"campaign_{campaign.id}_copy.csv", "text/csv"


def export_zip(db: Session, campaign: Campaign, client: Client) -> tuple[bytes, str, str]:
    """ZIP grouped by platform: final composited images + a copy CSV per platform."""
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        posts = _ordered_posts(db, campaign)
        by_platform: dict[str, list[Post]] = {}
        for post in posts:
            by_platform.setdefault(post.platform.value, []).append(post)

        for platform, plist in by_platform.items():
            rows = io.StringIO()
            writer = csv.writer(rows)
            writer.writerow(["Post #", "Headline", "Copy", "CTA", "Hashtags", "Best time"])
            for post in plist:
                writer.writerow([
                    post.position + 1, post.headline, post.copy, post.cta,
                    " ".join(post.hashtags), post.best_time,
                ])
                images, videos = _post_visuals(db, post)
                for img in images:
                    data = _final_image_bytes(db, img, client)
                    if data:
                        name = f"{platform}/post{post.position + 1}_img{img.slot_index + 1}.png"
                        zf.writestr(name, data)
                for vidx, vid in enumerate(videos):
                    if not vid.base_object_key:
                        continue
                    try:
                        vdata = storage.get_object(vid.base_object_key)[0]
                        zf.writestr(f"{platform}/post{post.position + 1}_video{vidx + 1}.mp4", vdata)
                    except Exception:  # noqa: BLE001 — a missing video must not abort the export
                        pass
            zf.writestr(f"{platform}/copy.csv", rows.getvalue())

        zf.writestr(
            "campaign.json",
            json.dumps(campaign_payload(db, campaign, client), indent=2, ensure_ascii=False),
        )
    return buf.getvalue(), f"campaign_{campaign.id}.zip", "application/zip"


def export_pdf(db: Session, campaign: Campaign, client: Client) -> tuple[bytes, str, str]:
    pdf = FPDF(unit="mm", format="A4")
    pdf.set_auto_page_break(auto=True, margin=15)
    pdf.add_page()

    def line(text: str, height: float = 5) -> None:
        # new_x=LMARGIN keeps the cursor at the left margin so the next full-width
        # cell has room (fpdf2's default leaves x at the right margin).
        pdf.multi_cell(0, height, _ascii(text), new_x=XPos.LMARGIN, new_y=YPos.NEXT)

    pdf.set_font("Helvetica", "B", 18)
    line(campaign.name, 10)
    pdf.set_font("Helvetica", "", 11)
    line(
        f"Client: {client.company_name}  |  Objective: {campaign.objective.value}  |  "
        f"Language: {campaign.content_language}",
        6,
    )
    if campaign.central_theme:
        line(f"Theme: {campaign.central_theme}", 6)
    pdf.ln(2)

    for post in _ordered_posts(db, campaign):
        pdf.set_font("Helvetica", "B", 13)
        pdf.set_text_color(40, 40, 120)
        line(f"{post.platform.value.upper()} - Post {post.position + 1}", 7)
        pdf.set_text_color(0, 0, 0)

        # Image preview (first slot with an image).
        for img in _post_visuals(db, post)[0]:
            data = _final_image_bytes(db, img, client)
            if data:
                try:
                    pdf.image(io.BytesIO(data), w=80)
                    pdf.ln(1)
                except Exception:  # noqa: BLE001
                    pass
                break

        if post.headline:
            pdf.set_font("Helvetica", "B", 11)
            line(post.headline, 6)
        pdf.set_font("Helvetica", "", 10)
        line(post.copy)
        if post.cta:
            pdf.set_font("Helvetica", "I", 10)
            line(f"CTA: {post.cta}")
        if post.hashtags:
            pdf.set_text_color(80, 80, 80)
            line(" ".join(post.hashtags))
            pdf.set_text_color(0, 0, 0)
        if post.rationale:
            pdf.set_font("Helvetica", "I", 9)
            pdf.set_text_color(110, 110, 110)
            line(f"Rationale: {post.rationale}")
            pdf.set_text_color(0, 0, 0)
        pdf.ln(3)

    out = bytes(pdf.output())
    return out, f"campaign_{campaign.id}.pdf", "application/pdf"


EXPORTERS = {
    "json": export_json,
    "csv": export_csv,
    "zip": export_zip,
    "pdf": export_pdf,
}
