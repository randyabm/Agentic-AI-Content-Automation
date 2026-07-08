from celery import Celery

from app.core.config import get_settings

settings = get_settings()

celery_app = Celery(
    "marketing_platform",
    broker=settings.redis_url,
    backend=settings.redis_url,
    include=["app.workers.tasks"],
)

celery_app.conf.update(
    task_track_started=True,
    task_time_limit=60 * 30,        # hard cap 30 min per job
    task_soft_time_limit=60 * 25,
    worker_prefetch_multiplier=1,
    timezone="UTC",
    beat_schedule={
        # Sweep every 30 minutes; each source runs only when its own
        # frequency interval (daily/weekly) has actually elapsed.
        "check-due-article-sources": {
            "task": "article_sync.check_due",
            "schedule": 30 * 60.0,
        },
        # Watchdog: scan for jobs stuck in an in-progress state and mark them
        # failed so the UI never shows an eternal spinner.
        "watchdog-sweep": {
            "task": "watchdog.sweep",
            "schedule": 10 * 60.0,  # every 10 minutes
        },
        # Social scheduling: send any scheduled post whose time has arrived.
        "publish-due-posts": {
            "task": "social.publish_due",
            "schedule": 60.0,  # every minute — minute-level scheduling granularity
        },
        # Approval safety: flag scheduled posts that passed their time without
        # being approved (they will never publish on their own).
        "missed-approval-sweep": {
            "task": "social.missed_approval_sweep",
            "schedule": 15 * 60.0,  # every 15 minutes
        },
    },
)
