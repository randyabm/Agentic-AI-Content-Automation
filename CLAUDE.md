# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Internal AI Marketing Platform: client intelligence, competitive analysis, and AI-powered social campaign generation. Spec lives in `prd_extracted.md` (extracted from the PRD docx); README maps modules to PRD sections. All v1.1 modules are implemented; video generation is a beyond-PRD extra.

## Running

Everything runs in Docker Compose (no local venv/node setup expected):

```bash
docker compose up --build
```

Services: `api` (FastAPI, hot-reload via volume mount, :8000), `worker` (Celery), `beat` (Celery beat — periodic article-source sync), `frontend` (Vite dev server, :5173), `db` (Postgres :5432), `redis`, `minio` (:9000/:9001), `mailpit` (:8025).

Requires a `.env` (gitignored) with `JWT_SECRET`, `APP_ENCRYPTION_KEY`, `ANTHROPIC_API_KEY`, `OPENROUTER_API_KEY`, admin credentials. On first boot the API seeds the admin user, per-function LLM configs, default image/video model lists, and global settings (`app/services/seed.py`).

- Restart a backend code path: API reloads automatically; the **Celery worker does not hot-reload** — `docker compose restart worker` after changing `app/workers/` or services used by tasks.
- Frontend: after any frontend change, clear `node_modules/.vite` and restart the frontend container, then verify the served module (Vite cache is sticky in Docker).
- Frontend build/typecheck: `docker compose exec frontend npm run build` (`tsc -b && vite build`).
- There is no test suite, linter config, or CI at present.

## Schema changes

There is no Alembic. `Base.metadata.create_all` runs at API startup, which creates **new tables only** — it will not add columns to existing tables. When a model gains a column, apply a manual `ALTER TABLE` in Postgres (`docker compose exec db psql -U marketing marketing`).

## Architecture

**Backend** (`backend/app/`) — FastAPI + SQLAlchemy 2 + Celery:
- `api/routes/*` — thin route handlers; RBAC enforced server-side via `api/deps.py`. All routers registered in `api/router.py`.
- `models/` — one file per domain; **every new model must be imported in `models/__init__.py`** or create_all won't see it.
- `services/` — the business logic. Key ones: `extraction.py` / `competitor_intel.py` / `article_intel.py` (Claude-driven analysis), `campaign_gen.py` (Editorial + Visual agents), `image_gen.py` / `video_gen.py` (provider-abstracted generation), `compositing.py` (logo/layer compositing with Pillow), `export.py` (ZIP/PDF/JSON/CSV), `platforms.py` (per-platform specs: ratios, char limits, link handling), `crawler.py`, `storage.py` (MinIO/S3).
- `workers/tasks.py` — all Celery tasks (crawling, generation, video). Long-running AI work goes through Celery, never inline in a request.
- `core/crypto.py` — AES-256-GCM for stored API keys; DB never holds plaintext keys and the UI only shows masked hints.

**LLM provider abstraction**: text functions are configurable per-function (Anthropic Claude default, or OpenAI/OpenRouter) via the `llm` model/config rows; image and video models are admin-curated lists (System Settings) where each entry carries its own provider + encrypted API key. Competitor identification is Anthropic-only (relies on the server-side web search tool). The Anthropic org is rate-limited to 30k input tokens/min — keep prompt corpora ≤100k chars and retry on 429.

**Campaign domain model** (element-centric): a campaign's *elements* own the shared visuals (one image per aspect ratio); *posts* are per-platform copy that reference an element. Ratios are derived from the selected platforms automatically, with manual override (`frontend/src/ratios.ts`, `services/platforms.py`). Module 4 (article-to-content) reuses the same campaign pipeline in an article-driven mode.

**Frontend** (`frontend/src/`) — React 18 + TypeScript + Vite, react-router, no state library or UI framework. `api.ts` is the single fetch wrapper (JWT from `auth.tsx`); `types.ts` mirrors backend schemas by hand — keep it in sync when changing `backend/app/schemas/`. Styling is plain CSS in `styles.css`.

## Conventions

- New backend feature = model + schema + route + service (+ Celery task if slow), wired through `models/__init__.py` and `api/router.py`, plus seed updates if it needs defaults.
- `API KEYS.md` and `.env` are gitignored secrets — never commit or print their contents.
- **Textareas**: never use a bare `<textarea>` in the frontend. Always use `<TextareaZoom>` imported from `frontend/src/components/TextareaZoom.tsx`. It renders a read-only preview that opens a full-size editable mini-modal on click. Props: `label` (shown as modal title), `value`, `onChange`, `rows` (optional, default 2), `placeholder` (optional), `readOnly` (optional). The only exception is inside `TextareaZoom` itself.
