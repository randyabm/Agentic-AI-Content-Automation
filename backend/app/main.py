import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware

from app.api.router import api_router
from app.core.config import get_settings, validate_production_secrets
from app.db.migrations import run_migrations
from app.db.session import Base, SessionLocal, engine
from app.services import storage
from app.services.seed import seed

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Dev bootstrap: create tables and seed defaults. Alembic migrations will
    # replace create_all once the schema stabilizes.
    import app.models  # noqa: F401 — register all models on Base

    # Bootstrap order matters. create_all builds the CURRENT model schema — on a
    # brand-new database that is the complete schema, so the delta SQL migrations
    # (which only evolve an *existing, historically-created* DB) are redundant and
    # can conflict (e.g. 001 ALTERs `users` before it exists). We detect a fresh DB
    # (no base table yet), run create_all, and tell the migration runner the schema
    # is already current so it records the existing migrations as applied instead of
    # executing them. On an established DB create_all is a no-op and only newly added
    # migrations are applied.
    from sqlalchemy import inspect

    fresh_database = not inspect(engine).has_table("users")
    Base.metadata.create_all(bind=engine)
    run_migrations(engine, schema_already_current=fresh_database)
    db = SessionLocal()
    try:
        seed(db)
    finally:
        db.close()
    try:
        storage.ensure_bucket()
    except Exception:
        logger.warning("Object storage is not reachable; logo uploads will fail until it is")
    yield


settings = get_settings()
validate_production_secrets(settings)
app = FastAPI(title=settings.app_name, version="0.1.0", lifespan=lifespan)

# Large JSON payloads (campaign detail with all posts/elements) compress ~10x;
# images/videos are served pre-encoded and skip gzip via the size threshold check.
app.add_middleware(GZipMiddleware, minimum_size=1024)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(api_router)


@app.get("/health")
def health():
    return {"status": "ok"}
