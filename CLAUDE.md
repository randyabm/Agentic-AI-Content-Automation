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

`deploy.sh` does: `git fetch origin <branch>` → `git checkout -f -B <branch> origin/<branch>` (force-switches the working tree to the pushed branch, so **any** branch push deploys that branch's exact code) → `docker compose build api worker beat frontend` → `docker compose up -d`. nginx and cloudflared are always restarted after build — nginx caches container IPs which change on each rebuild.

Deploy logs land in `/tmp/deploy.log` on the server. Check them if something breaks:

```bash
plink -ssh -pw "$env:SERVER_PW" -hostkey "$env:SERVER_HOSTKEY" "$env:SERVER_USER@$env:SERVER_HOST" "cat /tmp/deploy.log | tail -30"
```

(These vars — `SERVER_HOST`, `SERVER_USER`, `SERVER_PW`, `SERVER_HOSTKEY` — are exported by the PowerShell profile at `~/Documents/WindowsPowerShell/Microsoft.PowerShell_profile.ps1`. If `plink` says the vars are empty, open a fresh PowerShell window so the profile loads. `plink ...` below is shorthand for the same command.)

**Schema changes** (new columns): add a numbered SQL file in `backend/migrations/` and push — the runner applies it on startup automatically (see "Schema changes" below). Manual psql is only needed to inspect or hot-fix the live DB:

```bash
plink ... "$env:SERVER_USER@$env:SERVER_HOST" "docker exec -it app-db-1 psql -U marketing marketing"
```

**Check container logs** if something breaks:

```bash
plink ... "$env:SERVER_USER@$env:SERVER_HOST" "docker logs app-api-1 --tail 30"
plink ... "$env:SERVER_USER@$env:SERVER_HOST" "docker compose -f ~/app/docker-compose.prod.yml ps"
```

Services on the server: `app-api-1` (FastAPI :8000 internal), `app-worker-1` (Celery), `app-beat-1` (Celery beat), `app-frontend-1` (Vite :5173 internal), `app-db-1` (Postgres), `app-redis-1`, `app-minio-1` (:9000 internal), `app-nginx-1` (reverse proxy :80 internal), `app-cloudflared-1` (Cloudflare Tunnel → public domain), `app-webhook-1` (GitHub webhook listener :9002 internal).

## Branching & merging workflow

**Rule.** When the user asks to merge a branch (e.g. `merge nav`, `une feature/x a master`, `merge X into Y`), the agent MUST follow this exact sequence — and MUST NOT delete the source branch until the validation step succeeds and the user explicitly confirms.

1. **Parse intent.** Identify the source branch and the target branch.
   - If the source is unambiguous (e.g. `feature/nav`, `fix/calendar-bug`) use it.
   - If ambiguous (e.g. `merge nav` could be `feature/nav` / `fix/nav` / `release/nav`), ask the user before doing anything. Never guess.
2. **Pre-checks.** Abort and report if any of these is true:
   - `git status` shows staged or unstaged TRACKED changes on the current branch. (Untracked files like `PLAN_*.md` are OK — leave them alone.)
   - `master` is behind `origin/master` (offer `git pull --ff-only origin master`).
3. **Merge.** `git fetch origin <branch>` → `git checkout master` → `git pull --ff-only origin master` → `git merge --no-ff <branch> -m "Merge <branch> into master"`. On conflict: `git merge --abort` + report and ask. Do not attempt to resolve.
4. **Push** `origin master` automatically (this repo's deploy is webhook-triggered on push).
5. **Validate (MANDATORY before asking about deletion).** All of these must pass:
   - `git log --oneline -1 origin/master` shows the merge commit with the right message.
   - `git rev-list -n1 origin/master ^<branch>~1` (or `^<base-sha>`) returns a non-empty SHA → proves the branch's commits are reachable from `origin/master`.
   - `git status` is clean on `master`.
   Report the merge SHA, the list of brought-in commits, and the reachability check result to the user.
6. **Ask the user** (via the question tool / `useConfirm`) whether to delete the merged branch. Default scope is **local + remote**.
7. **On delete confirmation**: `git branch -d <branch>` (use `-d`, not `-D` — the validation step already proved the commits are in master, but `-d` is a safety belt). If remote is in scope: `git push origin --delete <branch>`.

Requires `~/app/.env` on the server (gitignored) with `JWT_SECRET`, `APP_ENCRYPTION_KEY`, `ANTHROPIC_API_KEY`, `OPENROUTER_API_KEY`, `VITE_API_URL=https://marketingaidev.randybeltran.xyz/api`, `CLOUDFLARE_TUNNEL_TOKEN`, `GITHUB_WEBHOOK_SECRET`, admin credentials.

- There is no test suite, linter config, or CI at present.
- The Celery worker does not hot-reload — `deploy.sh` rebuilds and restarts it automatically.
- Frontend changes: `deploy.sh` rebuilds the frontend container.
- Frontend build: `cd frontend && npm run build` (runs `tsc -b && vite build`). Install deps: `npm install`.
- When adding shadcn components: `npx shadcn@latest add <name>` (answer `n` to overwrite prompts for existing files). Config in `components.json`.

## Schema changes

`Base.metadata.create_all` runs at API startup and creates **new tables only** — it does not add columns to existing tables.

For any DDL change (new column, index, constraint, etc.) create a numbered SQL file in **`backend/migrations/`** (NOT the repo-root `migrations/` folder):

```
backend/migrations/006_add_foo_to_bar.sql
```

**Why `backend/migrations/` and not `migrations/`:** the Docker build context is `backend/` (copied to `/code` in the container), so only `backend/migrations/` ships in the image. The runner's `MIGRATIONS_DIR` resolves to `Path(__file__).resolve().parents[2] / "migrations"` = `backend/migrations` locally and `/code/migrations` in the container. The repo-root `migrations/` folder is legacy/dead — files placed there are never copied into the image and never applied.

The migration runner (`backend/app/db/migrations.py`) applies all unapplied `.sql` files in order at startup, recording each by filename in `schema_migrations` (columns: `filename`, `applied_at`). Just push — no SSH or manual psql needed.

**Rules:** never edit an already-applied migration; add a new one instead. Use `IF NOT EXISTS` / `IF EXISTS` where possible.

## Architecture

**Backend** (`backend/app/`) — FastAPI + SQLAlchemy 2 + Celery:
- `api/routes/*` — thin route handlers; RBAC enforced server-side via `api/deps.py`. All routers registered in `api/router.py`.
- `models/` — one file per domain; **every new model must be imported in `models/__init__.py`** or create_all won't see it.
- `services/` — the business logic. Key ones: `extraction.py` / `competitor_intel.py` / `article_intel.py` (Claude-driven analysis), `campaign_gen.py` (Editorial + Visual agents), `image_gen.py` / `video_gen.py` (provider-abstracted generation), `compositing.py` (logo/layer compositing with Pillow), `export.py` (ZIP/PDF/JSON/CSV), `platforms.py` (per-platform specs: ratios, char limits, link handling), `crawler.py`, `storage.py` (MinIO/S3), `display_variants.py` (WebP display variant generation), `publishing.py` + `autopilot.py` (social scheduling/publishing), `direct_social.py` (Facebook/Instagram direct API publishing), `media_links.py` (signed JWT media URLs).
- `workers/tasks.py` — all Celery tasks (crawling, generation, video, publishing). Long-running AI work goes through Celery, never inline in a request.
- `core/crypto.py` — AES-256-GCM for stored API keys; DB never holds plaintext keys and the UI only shows masked hints.
- `scripts/` — one-off maintenance scripts (e.g. `backfill_display_variants.py`). Run via `docker exec app-api-1 python -m scripts.<name>`.

**LLM provider abstraction**: text functions are configurable per-function (Anthropic Claude default, or OpenAI/OpenRouter) via the `llm` model/config rows; image and video models are admin-curated lists (System Settings) where each entry carries its own provider + encrypted API key. Competitor identification is Anthropic-only (relies on the server-side web search tool). The Anthropic org is rate-limited to 30k input tokens/min — keep prompt corpora ≤100k chars and retry on 429.

**Campaign domain model** (element-centric): a campaign's *elements* own the shared visuals (one image per aspect ratio); *posts* are per-platform copy that reference an element. Ratios are derived from the selected platforms automatically, with manual override (`frontend/src/ratios.ts`, `services/platforms.py`). Module 4 (article-to-content) reuses the same campaign pipeline in an article-driven mode.

**Provider credentials** (one key per provider): `ProviderCredential` model (`models/llm.py`), unique by canonical provider: `anthropic | openai | openrouter | google | fal | replicate`. `services/providers.py` is the registry: `credential_provider()` normalizes a per-domain provider string to its canonical key, `resolve_api_key()` returns the credential key, `list_models()` proxies each provider's model-list API so the UI offers a dropdown instead of a typed model ID. `seed.py::_seed_provider_credentials` migrates existing keys into central credentials on boot.

**System Settings UI** (`pages/SystemSettings.tsx`): tabbed — Providers & Keys · LLM Functions · Image Models · Video Models · Article Sources · Global. LLM functions and image/video models are edited with a provider dropdown + auto-fetched model dropdown (`ModelSelect`, with a manual fallback). No per-row API key fields.

## Image pipeline (element-centric, one visual per element)

Per `CampaignElement`, `PostImage` rows exist for each `(slot_index, aspect_ratio)` — carousel slides are `slot_index`, ratio variants are `aspect_ratio`.

- **Base ratio + auto-derived ratios.** Within a slide, the highest-priority ratio (`_RATIO_PRIORITY` in `workers/tasks.py`, mirrors `frontend/src/ratios.ts`; 1:1 first) is the base. Generating it auto-triggers `derive_element_ratios`, which recreates the *other ratios of the same slide only* (never other slides) via AI image-to-image reframe (`image_gen.generate_image_from`), falling back to `image_gen.reframe_local` (keeps the full image centred, fills the extension with a blurred zoomed copy — **never crops**).
- **Logo baked into generation.** When generating, the client logo bytes are passed to the model (`generate_image(logo_bytes=...)`) as the last input image with an instruction to render it small/undistorted in a corner. The AI draws the logo in. `canvas_state.logo_enabled` (default true) is the per-image toggle. If the image-to-image endpoint fails (OpenAI 520s), generation falls back to plain text-to-image and the logo is **composited as an overlay** instead (`logo_placement.compute_logo_geom` = Claude vision picks the spot; `compositing.py` burns it in, with optional scrim). Derived ratios copy the base's logo treatment so all ratios stay consistent.
- **Reference images.** `reference_images` table (campaign-scoped); uploaded via the Reference images panel and passed to `generate_image(reference_bytes=...)` so visuals match a real product. Only the direct/base generation uses references.
- **Safe margins.** `_SAFE_MARGINS` is appended to every image prompt so text/logos don't get clipped at the edges.
- **Frontend:** `ElementVisual` renders one image with Slide tabs (carousel) then ratio pills; `ImageSlot` remounts per image (`key`) so each shows its own prompt. Click an image → lightbox; hover → edit/download/expand icons. While any ratio of a slide is generating, generation is locked on all of them.

## Video pipeline (same presentation, manual variants)

Mirrors images but variants are **manual** (cost). Requires **ffmpeg** (installed in `backend/Dockerfile`).

- `services/video_edit.py`: `extract_first_frame`, `overlay_logo` (logo burned in at the vision-decided spot), `reframe_video` (blurred-extend, no crop).
- `run_video_generation` overlays the logo after generation; `PostVideo.logo_enabled` (column added via manual `ALTER TABLE`) toggles it.
- Other ratios are NOT auto-derived. The user clicks "Generate other ratios" → `POST .../videos/{id}/derive-ratios` → `derive_video_ratios` reframes the base clip locally with ffmpeg. References are not used for video.
- **Frontend:** `VideoVisual` groups videos by ratio with the same pill switcher.

## Robustness

- OpenAI image endpoints retry transient 5xx (Cloudflare **520** on `/images/edits`) via `image_gen._openai_image_post` (6 attempts, backoff). On final failure, base generation falls back to text-to-image (+ overlaid logo) rather than failing.
- Campaign list exposes `visuals_generating` so the list shows "Generating visuals…" while a `ready` campaign still renders images/videos; element cards and the campaign detail hide stale visuals while regenerating.

**Frontend** (`frontend/src/`) — React 18 + TypeScript + Vite 8 (Node 26), react-router, no state library. `api.ts` is the single fetch wrapper (JWT from `auth.tsx`); `types.ts` mirrors backend schemas by hand — keep it in sync when changing `backend/app/schemas/`.

**UI design system** (in-progress migration): standardizing on **shadcn/ui + Tailwind CSS v4**. Base components live in `frontend/src/components/ui/` (Button, Input, Textarea, Label, Card, Badge, Tabs, Dialog, Select, Separator, Tooltip, DropdownMenu, Popover, Toaster, Calendar, Sheet, ScrollArea, Table, DateTimePicker). Add more with `npx shadcn@latest add <name>` (config in `components.json`). The brand palette (ThreadWeave indigo/amber/teal) is mapped to shadcn CSS variables in `src/index.css`. Class merging helper: `cn()` from `@/lib/utils`; `@` aliases `src/`. Toasts via `toast()` from `sonner` (host mounted in `main.tsx`). Confirm/prompt dialogs via `useConfirm()`/`usePrompt()` from `@/components/ui/dialogs` (never use native `window.confirm`/`prompt`/`alert`). The legacy hand-written `styles.css` is imported into a lower `legacy` cascade layer so Tailwind utilities win — older screens still render unchanged until migrated. **Prefer shadcn components for all new UI; migrate legacy screens opportunistically. Avoid legacy CSS classes (`page-container`, `page-header`, `card`, `btn`, `muted`, `alert`, `tag`, `modal`) in new components — use Tailwind utilities + shadcn components instead.**

**Contrast rule (always):** every text must have a visible contrast against its background — never font and background the same/near colour. Note the token trap: shadcn's `--muted` (`#f5f5f4`) is a **background** token; legacy *muted text* uses **`--text-muted`** (`#57534e`). Don't use `var(--muted)` for text (it resolves to the near-white background colour and disappears). shadcn secondary text uses `--muted-foreground` (`#57534e`).

## Image loading performance (optimization layer)

Images served via authenticated FastAPI routes that read from MinIO (S3). Optimizations applied:

- **Browser cache headers**: All authenticated image routes (`/base`, `/composite`, `/display`, `/assets/*/file`, `/references/*/file`, `/videos/*/file`, `/clients/*/logo`, `/clients/*/avatar`) return `Cache-Control: private, max-age=86400, immutable` + `ETag`. The `If-None-Match` header is checked → returns `304 Not Modified` without re-reading from S3. Helper: `storage.image_response()` in `services/storage.py`.
- **Composite short-circuit**: The `/composite` route computes an ETag from `base_object_key + canvas_state`. If the ETag matches (canvas unchanged), returns 304 without recomputing PIL compositing.
- **WebP display variants**: `services/display_variants.py` generates 800px + 1600px WebP variants (`quality=85`) after every base upload, derived ratio, manual upload, and composite. Stored under separate keys (`display_base.webp`, `display_composite.webp`) — the original PNG/JPEG `base_object_key` and `composited_object_key` are **never touched** (social publishing reads those keys and Instagram/Facebook don't accept WebP).
- **Display route**: `GET /campaigns/{id}/images/{id}/display?w=800|1600` serves the WebP variant, falling back to the full-res base for legacy images. Frontend preview uses 800px; lightbox uses 1600px.
- **Backfill**: `scripts/backfill_display_variants.py` generates display variants for existing images. Run: `docker exec app-api-1 python -m scripts.backfill_display_variants`.
- **Frontend blob cache**: `frontend/src/lib/blobCache.ts` — module-level `Map<path, Promise<blobUrl>>` with LRU eviction (200 entries). Dedupes concurrent and repeat fetches; no re-download on component remount (tab switch, ratio change). `getBlobUrl(path)` is the entry point; `invalidateBlobUrl(path)` clears a specific entry; `clearBlobCache()` clears all (for logout). All image hooks (`useImageUrl`, `useBlobUrl`, `useProtectedImage`) use it.
- **`loading="lazy"`** on all non-critical `<img>` (thumbnails, avatars, preview images).

## Publishing calendar & scheduling

**Route**: `/calendar` (global nav item in sidebar, visible to all org users). Replaces the old per-client Calendar tab (removed from `ClientDetail`).

**Backend endpoints** (`api/routes/scheduling.py`):
- `GET /calendar` — cross-client calendar (org-scoped, all `ScheduledPost` rows enriched with client/campaign/channel context).
- `GET /scheduleable-posts` — posts without a `ScheduledPost` yet, used by the drag-to-schedule sidebar. By default only fully-ready posts (approved + connected channel). With `?include_blocked=1` it also returns not-yet-ready posts flagged with `blocked_reason` (`"Not approved yet"` or `"No connected <platform> channel"`) so they can be shown as **plan-only**. The campaign Schedule modal passes `include_blocked=1`; the global calendar does not.
- `GET /clients/{id}/calendar` — single-client calendar (still available).
- `GET /scheduled-posts/{id}/export-pack` — ZIP with captions, media, publishing instructions.
- `PATCH /scheduled-posts/{id}` — reschedule.
- `DELETE /scheduled-posts/{id}` — cancel.

**Frontend** (`pages/Calendar.tsx`):
- **4 views** via shadcn Tabs: Month grid, Week view, List/Agenda, Pipeline board (Kanban).
- **Month grid** (`CalendarMonthGrid.tsx`): 7×6 grid with post cards per day, `date-fns` for calculations, today highlight with ring, weekend shading, unscheduled posts section. Day cells are **droppable** — drop a post onto a day to schedule at 9:00 AM.
- **Week view** (`CalendarWeekView.tsx`): 7 columns × 14 hour rows (8am–9pm). Hour cells are **droppable** — drop onto a specific hour for exact-time scheduling.
- **List view** (`CalendarListView.tsx`): day-grouped agenda with Today/Tomorrow labels, overdue highlighting, shadcn Badge for status.
- **Pipeline board** (`PipelineBoard.tsx`): Kanban with 5 columns (Draft → Needs Approval → Approved → Scheduled → Published). **Drag-and-drop via @dnd-kit** — drag cards between columns to submit/approve/reject. Column headers are color-coded (slate/blue/violet/amber/emerald).
- **Post drawer** (`PostDrawer.tsx`): shadcn Sheet (right side panel) opened by clicking any post card. Shows: headline, caption, hashtags, status/approval badges, quick actions (copy caption, download media, export pack, view live post, open campaign), reschedule via DateTimePicker, cancel schedule, approval actions (submit/approve/reject).
- **Scheduleable posts sidebar** (`ScheduleablePostsSidebar.tsx`): left panel with draggable cards of unscheduled posts. Shows platform, client, headline, and AI `best_time` hint. Ready posts drag normally; **plan-only** posts (those with a `blocked_reason`) render as amber/dashed locked cards but are still draggable. Exports `SchedulePostOverlayCard` (the card shown in the `DragOverlay`). Drag onto month/week grid to schedule. Filters apply.
- **Drag-and-drop internals**: both the global calendar and the campaign modal use `collisionDetection={pointerWithin}` and a `DragOverlay` **portaled to `document.body`** (`createPortal`). This is required because Radix `DialogContent` centers with a CSS `transform`, which (a) breaks dnd-kit's default rect collision detection and (b) makes a `position:fixed` overlay anchor to the dialog box instead of the viewport. Source cards do **not** apply dnd-kit's `transform` (they just dim) — only the overlay moves.
- **Filters** (`CalendarFilters.tsx`): shadcn Select dropdowns for client, platform, status. Apply to all views + sidebar.
- **DateTimePicker** (`components/ui/date-picker.tsx`): Popover + shadcn Calendar + time input. Replaces the old text-prompt `YYYY-MM-DD HH:MM` reschedule UX.
- **Autopilot modal** (`AutopilotModal.tsx`): migrated to shadcn Dialog + DateTimePicker + Badge. Uses `local_label` from the API. Skeleton loader with spinner.
- **Dependencies**: `date-fns`, `@dnd-kit/core`, `@dnd-kit/sortable`, `@dnd-kit/utilities`. shadcn components: `calendar`, `sheet`, `scroll-area`, `table`.

**All calendar components use only shadcn/Tailwind — zero legacy CSS classes.**

**Approval workflow**: posts go draft → pending_review → approved → scheduled → published. Approval actions available in: the PostDrawer, the Pipeline board (drag), the inline approval bar in `CampaignDetail.tsx`, and the Review Queue page (`/review-queue`).

**Autopilot** (`services/autopilot.py`): deterministic best-time engine (no live LLM). Uses per-platform engagement windows (`BEST_WINDOWS`), respects weekday-only platforms (LinkedIn), campaign date range, per-day spacing. Seeded by editorial agent `best_time` hints. Frontend: "AI auto-schedule" button on ready campaigns → AutopilotModal.

**Campaign Schedule modal** (`components/CampaignSchedulerModal.tsx`): a per-campaign scheduler opened from the "Schedule" button on `CampaignDetail` (next to "AI auto-schedule"). Reuses the global calendar's two-pane layout (`ScheduleablePostsSidebar` + `CalendarMonthGrid`) but filters `/calendar` and `/scheduleable-posts?include_blocked=1` client-side to the one campaign. If the campaign has `start_date`/`end_date`, `CalendarMonthGrid`'s optional `minDate`/`maxDate`/`initialMonth` props highlight that window and disable drops outside it (and in the past). Dropping a post opens a "Pick a time" dialog (`DateTimePicker`, default 9:00 AM on the dropped day) before scheduling.

**Planning vs publishing**: scheduling is a *planning* step that can happen before approval and before a channel exists. The schedule endpoint (`POST /campaigns/{id}/posts/{post_id}/schedule`) requires neither approval nor a connected channel — a planned `ScheduledPost` may have `social_account_id = NULL` (column is nullable, see `backend/migrations/006`). The Beat sweep (`publish_due_posts`) is the gate: at due time it **skips** (leaves pending, does not fail) any post that isn't approved or has no connected channel, and only publishes once both are satisfied. Plan-only items show an amber lock in the month grid (`!item.channel_id`).

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

**Publishing flow**: `publishing._image_key()` resolves to `composited_object_key` or `base_object_key` → `media_links.public_media_url(key)` → `GET /media/public/{token}` → `storage.get_object(key)` → returns the **exact stored bytes** (PNG/JPEG) with the stored `Content-Type`. **The display WebP variants are never used for publishing** — they live under separate keys. Instagram/Facebook receive PNG/JPEG as expected.

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
