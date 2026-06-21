# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Internal AI Marketing Platform: client intelligence, competitive analysis, and AI-powered social campaign generation. Spec lives in `prd_extracted.md` (extracted from the PRD docx); README maps modules to PRD sections. All v1.1 modules are implemented; video generation is a beyond-PRD extra.

## Environment

**The development environment is the remote server at https://marketingaidev.randybeltran.xyz — do NOT use local Docker for development.** All changes must be committed and deployed to the server to be tested.

Server: `192.168.0.239` (home lab), user `deplyuser`, accessed via SSH. Stack runs under `~/app/` with `docker-compose.prod.yml`. Data lives in Docker volumes `pgdata` and `miniodata` on the server — do not wipe these.

## Deploying changes

**No manual deploy command needed.** A GitHub webhook triggers the server to deploy automatically on every push.

```
git commit && git push origin <branch>
→ GitHub calls https://marketingaidev.randybeltran.xyz/webhook/github
→ server runs deploy.sh <branch> + restarts nginx and cloudflared
```

- Push to `master` → deploys master (normal workflow)
- Push to any other branch → deploys that branch (useful for testing from mobile)
- If no branch can be detected, falls back to master

`deploy.sh` does: `git pull origin <branch>` → `docker compose build api worker beat frontend` → `docker compose up -d`. nginx and cloudflared are always restarted after build — nginx caches container IPs which change on each rebuild.

Deploy logs land in `/tmp/deploy.log` on the server. Check them if something breaks:

```bash
plink -ssh -pw "<SERVER_PW>" -hostkey "<SERVER_HOSTKEY>" deplyuser@192.168.0.239 "cat /tmp/deploy.log | tail -30"
```

**Schema changes** (new columns): push first (auto-deploys), then run the ALTER TABLE manually:

```bash
plink ... deplyuser@192.168.0.239 "docker exec -it app-db-1 psql -U marketing marketing"
```

**Check container logs** if something breaks:

```bash
plink ... deplyuser@192.168.0.239 "docker logs app-api-1 --tail 30"
plink ... deplyuser@192.168.0.239 "docker compose -f ~/app/docker-compose.prod.yml ps"
```

Services on the server: `app-api-1` (FastAPI :8000 internal), `app-worker-1` (Celery), `app-beat-1` (Celery beat), `app-frontend-1` (Vite :5173 internal), `app-db-1` (Postgres), `app-redis-1`, `app-minio-1` (:9000 internal), `app-nginx-1` (reverse proxy :80 internal), `app-cloudflared-1` (Cloudflare Tunnel → public domain), `app-webhook-1` (GitHub webhook listener :9002 internal).

Requires `~/app/.env` on the server (gitignored) with `JWT_SECRET`, `APP_ENCRYPTION_KEY`, `ANTHROPIC_API_KEY`, `OPENROUTER_API_KEY`, `VITE_API_URL=https://marketingaidev.randybeltran.xyz/api`, `CLOUDFLARE_TUNNEL_TOKEN`, `GITHUB_WEBHOOK_SECRET`, admin credentials.

- There is no test suite, linter config, or CI at present.
- The Celery worker does not hot-reload — `deploy.sh` rebuilds and restarts it automatically.
- Frontend changes: `deploy.sh` rebuilds the frontend container.

## Schema changes

`Base.metadata.create_all` runs at API startup and creates **new tables only** — it does not add columns to existing tables.

For any DDL change (new column, index, constraint, etc.) create a numbered SQL file in `migrations/`:

```
migrations/001_add_foo_to_bar.sql
```

The migration runner (`backend/app/db/migrations.py`) applies all unapplied `.sql` files in order at startup, recording each in `schema_migrations`. Just push — no SSH or manual psql needed.

**Rules:** never edit an already-applied migration; add a new one instead. Use `IF NOT EXISTS` / `IF EXISTS` where possible. See `migrations/README.md` for full conventions.

## Architecture

**Backend** (`backend/app/`) — FastAPI + SQLAlchemy 2 + Celery:
- `api/routes/*` — thin route handlers; RBAC enforced server-side via `api/deps.py`. All routers registered in `api/router.py`.
- `models/` — one file per domain; **every new model must be imported in `models/__init__.py`** or create_all won't see it.
- `services/` — the business logic. Key ones: `extraction.py` / `competitor_intel.py` / `article_intel.py` (Claude-driven analysis), `campaign_gen.py` (Editorial + Visual agents), `image_gen.py` / `video_gen.py` (provider-abstracted generation), `compositing.py` (logo/layer compositing with Pillow), `export.py` (ZIP/PDF/JSON/CSV), `platforms.py` (per-platform specs: ratios, char limits, link handling), `crawler.py`, `storage.py` (MinIO/S3).
- `workers/tasks.py` — all Celery tasks (crawling, generation, video). Long-running AI work goes through Celery, never inline in a request.
- `core/crypto.py` — AES-256-GCM for stored API keys; DB never holds plaintext keys and the UI only shows masked hints.

**LLM provider abstraction**: text functions are configurable per-function (Anthropic Claude default, or OpenAI/OpenRouter) via the `llm` model/config rows; image and video models are admin-curated lists (System Settings) where each entry carries its own provider + encrypted API key. Competitor identification is Anthropic-only (relies on the server-side web search tool). The Anthropic org is rate-limited to 30k input tokens/min — keep prompt corpora ≤100k chars and retry on 429.

**Campaign domain model** (element-centric): a campaign's *elements* own the shared visuals (one image per aspect ratio); *posts* are per-platform copy that reference an element. Ratios are derived from the selected platforms automatically, with manual override (`frontend/src/ratios.ts`, `services/platforms.py`). Module 4 (article-to-content) reuses the same campaign pipeline in an article-driven mode.

**Frontend** (`frontend/src/`) — React 18 + TypeScript + Vite 8 (Node 26), react-router, no state library. `api.ts` is the single fetch wrapper (JWT from `auth.tsx`); `types.ts` mirrors backend schemas by hand — keep it in sync when changing `backend/app/schemas/`.

**UI design system** (in-progress migration): standardizing on **shadcn/ui + Tailwind CSS v4**. Base components live in `frontend/src/components/ui/` (Button, Input, Textarea, Label, Card, Badge, Tabs, Dialog, Select, Separator, Tooltip, DropdownMenu, Toaster). Add more with `npx shadcn@latest add <name>` (config in `components.json`). The brand palette (ThreadWeave indigo/amber/teal) is mapped to shadcn CSS variables in `src/index.css`. Class merging helper: `cn()` from `@/lib/utils`; `@` aliases `src/`. Toasts via `toast()` from `sonner` (host mounted in `main.tsx`). The legacy hand-written `styles.css` is imported into a lower `legacy` cascade layer so Tailwind utilities win — older screens still render unchanged until migrated. Prefer shadcn components for all **new** UI; migrate legacy screens opportunistically.

## Conventions

- New backend feature = model + schema + route + service (+ Celery task if slow), wired through `models/__init__.py` and `api/router.py`, plus seed updates if it needs defaults.
- `API KEYS.md` and `.env` are gitignored secrets — never commit or print their contents.
- **Textareas**: never use a bare `<textarea>` in the frontend. Always use `<TextareaZoom>` imported from `frontend/src/components/TextareaZoom.tsx`. It renders a read-only preview that opens a full-size editable mini-modal on click. Props: `label` (shown as modal title), `value`, `onChange`, `rows` (optional, default 2), `placeholder` (optional), `readOnly` (optional). The only exception is inside `TextareaZoom` itself.

## Social Publishing: Direct Platform APIs

**Status**: Facebook Pages ✅; Instagram Business Account ✅; Twitter/LinkedIn (TBD).

### Architecture

Direct publishing to platforms (not Zernio middleman). Facebook and Instagram share the **same Meta app and OAuth endpoint** — they differ only in scopes and account filtering.

- **Single Meta App**: `2078337289753964` (both Facebook Pages and Instagram Business)
- **Single OAuth Endpoint**: `https://www.facebook.com/v19.0/dialog/oauth`
- **Different Scopes**: Platform-specific (Facebook Pages vs. Instagram Business)
- **Different Account Types**: Facebook returns Pages; Instagram filters for linked IG accounts

OAuth app credentials stored encrypted in `ProviderCredential` rows (`provider='oauth_facebook'`). Per-user tokens stored encrypted in `SocialAccount` rows. Media URLs are signed JWTs bound to MinIO objects; platforms download them via public endpoint.

**Critical environment variable** (must be set in `~/app/.env`):
```
PUBLIC_BASE_URL=https://marketingaidev.randybeltran.xyz/api
```
Used to build signed media URLs that platforms fetch asynchronously. If missing, defaults to `http://localhost:8000` (unreachable) → publishing fails with image/auth errors.

### Facebook Setup

**App**: `2078337289753964` (Solomoit-Test1, developers.facebook.com)
- **Redirect URI**: `https://marketingaidev.randybeltran.xyz/api/auth/facebook/callback`
- **App Domains**: `marketingaidev.randybeltran.xyz`
- **Product**: Facebook Login (for Pages + OAuth)

**Scopes**: `pages_manage_posts,pages_read_engagement,pages_show_list`

**Flow**:
1. User OAuth → Meta redirects to `facebook.com/v19.0/dialog/oauth`
2. Backend exchanges code for long-lived token (60 days)
3. Lists connected Facebook Pages (+ their tokens)
4. User picks a Page → `SocialAccount` created with Page token + ID
5. Publish: `POST {page_id}/photos` with caption + signed image URL

### Instagram Business Flow

**App**: `2078337289753964` (same Meta app as Facebook)
- **Redirect URIs** (both in Settings → Basic → Facebook Login → Valid OAuth Redirect URIs):
  - `https://marketingaidev.randybeltran.xyz/api/auth/facebook/callback`
  - `https://marketingaidev.randybeltran.xyz/api/auth/instagram/callback`
- **Products**: Facebook Login + Instagram API (both required)

**Scopes**: `instagram_business_basic,instagram_business_content_publish,pages_show_list,pages_read_engagement`

**Flow**:
1. User OAuth → redirects to `facebook.com/v19.0/dialog/oauth` (same endpoint as Facebook!)
2. Backend exchanges code for long-lived token (60 days)
3. Calls `GET /me/accounts?fields=instagram_business_account{...}` → filters for linked IG accounts
4. User picks an IG account → `SocialAccount` created with IG account ID + token
5. Publish: two-step (POST `{ig_account_id}/media` → POST `.../media_publish`) with caption + signed image URL

### Code Paths

- **OAuth + token exchange**: `backend/app/services/direct_social.py`
  - `get_connect_url()` — routes Facebook or Instagram to same endpoint with different scopes
  - `exchange_code()` — routes to `_exchange_facebook(code, platform)` for both
  - `_exchange_facebook(code, platform)` — filters accounts based on platform
- **Publishing**: `backend/app/services/publishing.py::_dispatch_direct()` → `direct_social.py::publish()`
- **Settings UI**: `frontend/src/pages/SystemSettings.tsx` → **Integrations** tab (single "Facebook & Instagram" card)
- **Media proxy**: `backend/app/api/routes/media.py::public_media({token})`
- **Channel management**: `backend/app/api/routes/channels.py`

### Debugging

- Check API logs: `docker logs app-api-1 --tail 50` (look for "Publishing to Facebook" | "Publishing to Instagram" + URL)
- Verify media endpoint: `curl "https://marketingaidev.randybeltran.xyz/api/media/public/{token}"` should return image data
- Token refresh: logged at publish time if token expires within 7 days
- Instagram two-step media: both requests logged separately
