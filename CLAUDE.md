# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Internal AI Marketing Platform: client intelligence, competitive analysis, and AI-powered social campaign generation. Spec lives in `prd_extracted.md` (extracted from the PRD docx); README maps modules to PRD sections. All v1.1 modules are implemented; video generation is a beyond-PRD extra.

## Environment

**The development environment is the remote server at https://marketingaidev.randybeltran.xyz — do NOT use local Docker for development.** All changes must be committed and deployed to the server to be tested.

Server: `192.168.0.239` (home lab), user `deplyuser`, accessed via SSH. Stack runs under `~/app/` with `docker-compose.prod.yml`. Data lives in Docker volumes `pgdata` and `miniodata` on the server — do not wipe these.

## Deploying changes

After making and committing any change, deploy with one command from this machine:

```bash
# SSH credentials are in .env / API KEYS.md (never committed)
plink -ssh -pw "<SERVER_PW>" -hostkey "<SERVER_HOSTKEY>" deplyuser@192.168.0.239 "cd ~/app && bash deploy.sh master && docker compose -f docker-compose.prod.yml restart nginx cloudflared"
```

`deploy.sh` does: `git pull origin competitor-pipeline-speedup` → `docker compose build api worker beat frontend` → `docker compose up -d`.

**The nginx restart after deploy is mandatory** — nginx caches container IPs and new containers get new IPs after each rebuild.

**Schema changes** (new columns): deploy first, then:

```bash
plink ... deplyuser@192.168.0.239 "docker exec -it app-db-1 psql -U marketing marketing"
```

**Check logs** if something breaks after deploy:

```bash
plink ... deplyuser@192.168.0.239 "docker logs app-api-1 --tail 30"
plink ... deplyuser@192.168.0.239 "docker compose -f ~/app/docker-compose.prod.yml ps"
```

Services on the server: `app-api-1` (FastAPI :8000 internal), `app-worker-1` (Celery), `app-beat-1` (Celery beat), `app-frontend-1` (Vite :5173 internal), `app-db-1` (Postgres), `app-redis-1`, `app-minio-1` (:9000 internal), `app-nginx-1` (reverse proxy :80 internal), `app-cloudflared-1` (Cloudflare Tunnel → public domain).

Requires `~/app/.env` on the server (gitignored) with `JWT_SECRET`, `APP_ENCRYPTION_KEY`, `ANTHROPIC_API_KEY`, `OPENROUTER_API_KEY`, `VITE_API_URL=https://marketingaidev.randybeltran.xyz/api`, `CLOUDFLARE_TUNNEL_TOKEN`, admin credentials.

- There is no test suite, linter config, or CI at present.
- The Celery worker does not hot-reload — `deploy.sh` rebuilds and restarts it automatically.
- Frontend changes: `deploy.sh` rebuilds the frontend container.

## Schema changes

There is no Alembic. `Base.metadata.create_all` runs at API startup, which creates **new tables only** — it will not add columns to existing tables. When a model gains a column, deploy first, then apply a manual `ALTER TABLE` in the production DB (see deploy instructions above for the psql command).

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
