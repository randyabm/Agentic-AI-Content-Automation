"""
Minimal SQL migration runner.

Scans backend/migrations/*.sql in filename order, applies any that have not
been recorded in the schema_migrations table, and records each one atomically.

Usage: call run_migrations(engine) once at startup, before create_all.
"""
import logging
from pathlib import Path

from sqlalchemy import text
from sqlalchemy.engine import Engine

logger = logging.getLogger(__name__)

# backend/app/db/migrations.py -> parents[2] is the backend/ dir (the image
# WORKDIR /code in the container). Migration SQL lives in backend/migrations/ so
# it's inside the Docker build context and copied into the image.
MIGRATIONS_DIR = Path(__file__).resolve().parents[2] / "migrations"

_CREATE_TRACKING_TABLE = """
CREATE TABLE IF NOT EXISTS schema_migrations (
    filename TEXT PRIMARY KEY,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
"""


def run_migrations(engine: Engine, *, schema_already_current: bool = False) -> None:
    """Apply pending *.sql migrations, recording each in schema_migrations.

    `schema_already_current=True` means the caller just ran
    ``Base.metadata.create_all`` against a brand-new database, so the current
    model schema is already in place. The delta SQL migrations only exist to
    *evolve an existing, historically-created* database; on a fresh DB they are
    redundant and can conflict (e.g. migration 001 does ``ALTER TABLE users``
    before the table exists, or 010 does a bare ``CREATE TABLE``). In that case
    we record every migration as applied WITHOUT executing it, so they are never
    re-run (and future migrations still apply normally once the DB is established).
    """
    if not MIGRATIONS_DIR.exists():
        return

    sql_files = sorted(MIGRATIONS_DIR.glob("*.sql"))
    if not sql_files:
        return

    with engine.connect() as conn:
        conn.execute(text(_CREATE_TRACKING_TABLE))
        conn.commit()

        applied = {
            row[0]
            for row in conn.execute(text("SELECT filename FROM schema_migrations"))
        }

    for path in sql_files:
        name = path.name
        if name in applied:
            continue
        with engine.connect() as conn:
            if schema_already_current:
                # Fresh schema from create_all covers everything: record it as
                # applied so it's skipped on future boots without conflicting.
                logger.info("Recording migration as already-applied (fresh schema): %s", name)
            else:
                logger.info("Applying migration: %s", name)
                sql = path.read_text(encoding="utf-8")
                conn.execute(text(sql))
            conn.execute(
                text("INSERT INTO schema_migrations (filename) VALUES (:name)"),
                {"name": name},
            )
            conn.commit()
            if not schema_already_current:
                logger.info("Migration applied: %s", name)
