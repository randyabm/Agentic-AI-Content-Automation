"""One-off backfill: generate WebP display variants for legacy PostImage rows.

Run inside the backend container:
    python -m scripts.backfill_display_variants

For every PostImage with a base_object_key but no display_base.webp in S3,
this script downloads the base, generates the 800px + 1600px WebP variants,
and uploads them. Composite display variants are generated on-demand by the
/composite and /display routes, so they are not backfilled here.
"""
import logging

from sqlalchemy import select

from app.db.session import SessionLocal
from app.models.campaign import PostImage, VideoStatus
from app.services import storage
from app.services.display_variants import generate_display_variants

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
logger = logging.getLogger(__name__)


def backfill() -> None:
    db = SessionLocal()
    try:
        images = db.scalars(
            select(PostImage).where(
                PostImage.base_object_key != "",
                PostImage.status == VideoStatus.ready,
            )
        ).all()
        logger.info("Found %d ready images to check", len(images))
        done = 0
        skipped = 0
        failed = 0
        for img in images:
            element = img.element
            campaign_id = element.campaign_id if element else None
            if not campaign_id:
                logger.warning("Image %s has no campaign — skipping", img.id)
                skipped += 1
                continue
            base_key = f"campaigns/{campaign_id}/images/{img.id}/display_base.webp"
            try:
                storage.get_object(base_key)
                skipped += 1
                continue
            except Exception:
                pass

            try:
                data, _ = storage.get_object(img.base_object_key)
                generate_display_variants(data, f"campaigns/{campaign_id}/images/{img.id}/display_base")
                done += 1
                logger.info("Generated display variants for image %s (%s)", img.id, img.aspect_ratio)
            except Exception as exc:
                failed += 1
                logger.error("Failed for image %s: %s", img.id, exc)
        logger.info("Done: %d generated, %d already had variants, %d failed", done, skipped, failed)
    finally:
        db.close()


if __name__ == "__main__":
    backfill()
