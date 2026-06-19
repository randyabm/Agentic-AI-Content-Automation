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

MIGRATIONS_DIR = Path(__file__).parent.parent.parent.parent / "migrations"

_CREATE_TRACKING_TABLE = """
CREATE TABLE IF NOT EXISTS schema_migrations (
    filename TEXT PRIMARY KEY,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
"""


def run_migrations(engine: Engine) -> None:
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
        logger.info("Applying migration: %s", name)
        sql = path.read_text(encoding="utf-8")
        with engine.connect() as conn:
            conn.execute(text(sql))
            conn.execute(
                text("INSERT INTO schema_migrations (filename) VALUES (:name)"),
                {"name": name},
            )
            conn.commit()
        logger.info("Migration applied: %s", name)
