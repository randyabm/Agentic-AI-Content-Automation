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
)
