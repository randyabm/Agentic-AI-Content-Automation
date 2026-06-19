# Social Publishing + Multi-Tenancy — Implementation Plan

Status: **proposed** (not yet built). Owner: Randy. Engine: **Zernio** (publishing middleman). Target: generate campaigns → schedule (manual or AI auto-pilot) → publish to client social accounts.

---

## 1. Decisions locked in

| Topic | Decision |
|---|---|
| Publishing engine | **Zernio** — single app-wide API key, backend-only. Zernio is the middleman for OAuth tokens **and** publishing. Zernio *profile* = our **client**; Zernio *account* = a connected **channel**. |
| Platforms (v1) | Instagram, Facebook Pages, LinkedIn, X, TikTok, YouTube (Zernio supports more — easy to add later). |
| Tenancy | **True multi-tenant SaaS**. Every tenant (company/organization) only sees its own clients, campaigns, channels, posts. |
| Roles | **Platform System Admin** (us — SolomoIT) configures AI keys, image/video models, the Zernio key, global settings. Each **Organization** then has: **Org Admin**, **Analyst/Account Manager**, **Creative**, **Reviewer/Approver**, (Viewer). |
| Approval | Content must be **approved by a Reviewer** before it can be scheduled/published. |
| Media hosting | Zernio fetches media by URL. We expose a **backend-mediated, signed, expiring public media endpoint** (no direct MinIO exposure). |
| Scheduling | Two selectable modes per campaign: **Manual** (calendar) and **Auto-pilot** (AI best-time per platform → user approves the proposed calendar). Plus **Publish now**. |

---

## 2. Role / permission model

Two independent axes:

- **Platform axis** — `User.is_platform_admin` (system admin = us). Org-less (`org_id = NULL`). Sees the System Settings: LLM configs, image/video model lists, **Zernio key**, global settings. NOT a member of any org and cannot see org content.
- **Org axis** — `User.org_id` + `User.org_role`:
  - `org_admin` — manage members, roles, client access, org-level settings within the org.
  - `analyst` — create clients, connect social channels, set up campaigns.
  - `creative` — generate/edit images & copy, draft posts. **Cannot publish** — submits for review.
  - `reviewer` — review & approve/reject posts; only **approved** posts can be scheduled/published.
  - `viewer` — read-only.

> The existing flat `UserRole(admin/editor/viewer)` is replaced by this two-axis model. Existing users get backfilled into a default org (see migration).

---

## 3. Data model changes

### New
- **`Organization`** — `id, name, slug, status, created_at`. (Per-org Zernio settings optional; default uses the app-wide key.)
- **`SocialAccount`** — `id, client_id, platform, zernio_account_id, zernio_profile_id, handle/display_name, avatar_url, status(connected/expired/revoked/error), last_verified_at, connected_by, created_at`.
- **`ScheduledPost`** — `id, post_id, post_image_id|post_video_id (the rendition), social_account_id, scheduled_at(UTC), timezone, status(draft/scheduled/publishing/published/partial/failed), zernio_post_id, published_url, error, created_by, created_at, updated_at`.

### Modified
- **`User`** — add `is_platform_admin: bool`, `org_id: FK→organizations (nullable)`, `org_role: enum`. (Migrate off old `role`.)
- **`Client`** — add `org_id: FK→organizations`, `zernio_profile_id: str`.
- **`Post`** — add `approval_status: enum(draft/pending_review/approved/rejected)`, `reviewed_by`, `reviewed_at`, `review_note`.
- **Settings** — split conceptually: platform-global keys (incl. `ZERNIO_API_KEY`, encrypted) gated to system admin; org-level settings table or org-scoped rows.

All new tables imported in `models/__init__.py`; columns added via manual `ALTER TABLE` (no Alembic). **Migration step:** create a default Organization, assign all existing clients + users to it, promote the current admin to `org_admin`, and create the SolomoIT system-admin user.

### Tenant isolation
`Client.org_id` is the tenant root; everything else (campaigns, competitors, articles, posts, channels) inherits via `client_id`. A new dependency `require_org_access(resource)` in `deps.py` enforces `resource.client.org_id == current_user.org_id` on every client-scoped route. System admin endpoints are separately gated by `require_platform_admin`.

---

## 4. Backend services & jobs

- **`services/zernio.py`** — thin Zernio API client: `connect_url(profile_id, platform)`, `create_post(...)`, `get_post(id)`, `list_accounts(profile_id)`, `verify_account(...)`, webhook signature verify (HMAC-SHA256, `X-Zernio-Signature`). Reads app-wide key from settings.
- **`services/publishing.py`** — orchestration: resolve the chosen rendition → signed direct media URL → build Zernio payload (`content`, `platforms:[{platform, accountId}]`, `mediaItems:[{type,url}]` — **NOT `media_urls`, which is silently ignored**; URL must be direct/non-redirecting and within per-platform size limits, `scheduledFor`/`publishNow`) → call Zernio → persist `zernio_post_id`/status on `ScheduledPost`.
- **`services/scheduling.py`** — auto-pilot: take a campaign's posts + target channels, derive a proposed calendar using Editorial Agent best-time hints + per-platform heuristics, return it for user approval; on approval, create `ScheduledPost` rows.
- **`services/media_proxy.py`** (or a route) — issue/verify signed expiring tokens for `GET /media/public/{token}` that streams a MinIO object. Backend-mediated; MinIO never exposed.
- **Celery**: `publish_scheduled_post(scheduled_post_id)` task + Beat sweep `publish_due_posts` (reuses the existing `check-due-article-sources` pattern) that picks up `scheduled & scheduled_at<=now & post approved`. Retries with backoff on Zernio 5xx/429.
- **Webhook route** `POST /webhooks/zernio` — verify signature, update `ScheduledPost` status + `published_url` on `post.published/failed/partial`.

---

## 5. API routes (new `routes/publishing.py` + `routes/orgs.py`)

- Orgs/members: CRUD org, invite/assign members & roles (org_admin); system-admin org list.
- Channels: `GET /clients/{id}/channels`, `POST /clients/{id}/channels/connect/{platform}` → returns Zernio connect URL; OAuth return handled by Zernio → `GET .../channels/sync`; `POST .../channels/{id}/verify`; `DELETE .../channels/{id}`.
- Approval: `POST /posts/{id}/submit`, `POST /posts/{id}/approve`, `POST /posts/{id}/reject`.
- Scheduling: `POST /campaigns/{id}/schedule` (manual rows), `POST /campaigns/{id}/autopilot/preview`, `POST /campaigns/{id}/autopilot/commit`, `POST /scheduled-posts/{id}/publish-now`, `DELETE /scheduled-posts/{id}`, `GET /campaigns/{id}/calendar`.

## 6. Frontend

- **System Admin area** (platform admin only): Zernio key + existing LLM/image/video/global settings.
- **Org settings**: members & roles (org admin).
- **Client → Channels tab**: connect / verify / disconnect each platform with status badges.
- **Campaign → Schedule view**: a weekly **calendar**; manual drag/set date+time per channel; **Auto-pilot** button → preview proposed calendar → approve; **Publish now**; status column (scheduled/published w/ live link/failed).
- **Approval queue**: reviewer sees pending posts, approves/rejects; creatives see review status.
- `types.ts` kept in sync with new schemas.

---

## 7. Phased roadmap (build order, risk-first)

- **Phase 0 — Multi-tenancy & roles** *(highest risk; do first, carefully)*: Organization model, two-axis roles, system-admin vs org-admin split, tenant isolation in `deps.py`, data backfill migration, approval-status scaffolding on Post. Ship + verify isolation before anything else.
- **Phase 1 — Zernio connection**: Zernio key in system settings, `SocialAccount` model, `services/zernio.py`, connect/verify/sync flow, Client **Channels** UI.
- **Phase 2 — Publishing core**: signed media proxy, `services/publishing.py`, **Publish now**, Zernio status webhook.
- **Phase 3 — Manual scheduling**: `ScheduledPost`, calendar UI, Celery Beat sweep + publish task, retries.
- **Phase 4 — Approval workflow + Auto-pilot**: enforce approved-before-publish, reviewer queue, AI best-time preview/commit.

---

## 7b. Build progress

- **Phase 0a–0c — DONE & verified live**: `Organization` model, two-axis roles (`is_platform_admin` + `OrgRole`), `Client.org_id` + `zernio_profile_id`, `Post` approval fields; migration `backend/migrations/001_multitenancy.sql` applied; idempotent backfill in `seed.py` (Default org, platform admin, existing clients/users assigned); RBAC deps in `api/deps.py` (`assert_client_access`, `require_client`, `require_platform_admin`, `require_org_admin`, `org_client_filter`).
- **Phase 0d — DONE & verified booting**: tenant isolation enforced in `clients.py`, `competitors.py` (router-level `require_client`), `campaigns.py` (`_get_campaign_or_404` / `_get_image_or_404` / `_get_video_or_404` enforce + `list_campaigns` scoped + `create_campaign` client check), and `articles.py` (library scoped via client→org; null-client articles are a shared pool). Platform admin has cross-org god-mode. Verified: API boots, platform-admin reads return 200 with data.
  - *Follow-up:* add `Article.org_id` for strict isolation of null-client articles; org-scope `article-sources` (currently global admin). Expose `org`/`org_role` in the auth schema + `types.ts` (Phase 0e).
- **Phase 0e — DONE & verified live**: `UserOut`/`/auth/me` expose `is_platform_admin`/`org_id`/`org_role`; new `routes/orgs.py` (platform admin lists/creates orgs + bootstraps a first org admin; org admins manage members/roles within their own org, cross-org reads 404); post approval endpoints `submit`/`approve`/`reject` gated by `require_contributor`/`require_reviewer` (platform admin allowed). Frontend: `types.ts` org context, **Team** + **Organizations** pages, role-gated nav/routing (`platformOnly`/`orgAdminOnly`), and an approval bar (status badge + submit/approve/reject) on each post. Verified: `tsc`+vite build clean; isolation test (a 2nd org sees 0 of the 1st org's clients, 404 on its members, 403 on platform-only list); approval flow submit→pending_review→approve→approved with reviewer recorded.

- **Phase 0 hardening — strict admin-tier separation (DONE & verified)**: system/functional config (LLM configs, provider API keys, image/video models, global-settings *writes*, article-sources) is now gated on `require_platform_admin` (was legacy `role=='admin'`). Removed platform-admin god-mode over client content — the super-admin has **no** brand/client access. Seed now makes the env admin a *pure* super-admin (org-less) and creates a dedicated `orgadmin@<domain>` (password = ADMIN_PASSWORD) to own the Default org. Model-list **reads** stay open to all authed users (creatives need them); settings **reads** open (non-secret UI flags). Frontend nav/routes split: super-admin → Organizations/Users/System Settings; org users → Clients/Campaigns/Articles/Team. Verified: org admin gets 403 on `/llm-configs` & `/provider-credentials`, super-admin sees 0 clients.

**➡ Phase 0 COMPLETE.**

- **Phase 1 — Zernio connection (DONE & verified live)**: `SocialAccount` model (new table, auto-created), `services/zernio.py` (httpx client: key storage in encrypted `ProviderCredential('zernio')`, profiles, accounts, connect URL, account health summarizer, create/get post), config `zernio_api_key`/`zernio_api_url` + seed from env. Platform-admin endpoints `GET/PUT /integrations/zernio` (masked) + `POST /integrations/zernio/test`. Org-facing `routes/channels.py` under `/clients/{id}/channels` (router-level `require_client`): `connect/{platform}` (hosted-OAuth URL), `sync` (mirror accounts+health), `{id}/verify`, `DELETE`. Frontend: **Integrations** tab in System Settings (Zernio key, masked, test) and a **Channels** tab on the client (connect/sync/verify/remove with status + token-expiry). Verified: key set/masked/test (1 live profile); channel `sync` pulled the real FB Page with true health; super-admin 404 on channels, org admin 403 on the key.
  - *Not yet live-tested:* the hosted-OAuth `connect` round-trip (opens a browser) — endpoint wired, returns Zernio URL.

- **Phase 2 — Publishing core (DONE & verified)**: signed expiring **media proxy** (`services/media_links.py` JWT token + `GET /media/public/{token}` streaming MinIO, no auth — config `public_base_url`); **`ScheduledPost`** model (new table; immediate = `scheduled_at` NULL, also reused by Phase 3); **`services/publishing.py`** (compose text, resolve image rendition by platform ratio, signed `mediaItems` URL, `publishNow`, parse Zernio result → status/permalink); **publish-now** `POST /campaigns/{id}/posts/{pid}/publish` (gated: post must be **approved** + a connected channel for the platform); **Zernio webhook** `POST /webhooks/zernio` (HMAC verify when `zernio_webhook_secret` set → updates ScheduledPost). Frontend: **Publish now** button on approved posts with permalink/status. Verified: media proxy 200 (valid token) / 404 (bad); publish guards 409 (unapproved) & 400 (no channel). Uses the same `create_post` proven live in Phase 0.
  - *Prod caveat:* `public_base_url` must be internet-reachable for Zernio to fetch the media (localhost isn't) — set it to the real domain in prod.

- **Phase 3 — Manual scheduling + calendar (DONE & verified)**: local-hold scheduling — `publishing.schedule_post` records a `ScheduledPost(status=scheduled, scheduled_at)` **without** calling Zernio; the Celery Beat task **`social.publish_due`** (`publish_due_posts`, every 60s) sweeps due rows, **re-checks approval + channel-connected at send time**, mints a fresh signed media URL, and hands each to Zernio (`publishing.send_scheduled_post`). Dispatch logic shared with publish-now via `_dispatch`. Endpoints: `POST /campaigns/{id}/posts/{pid}/schedule` (approved + connected + future-time guards), `GET /clients/{id}/calendar` (enriched agenda: platform, channel, campaign, preview, status), `PATCH /scheduled-posts/{id}` (reschedule), `DELETE /scheduled-posts/{id}` (cancel) — all tenant-scoped via client→org. Frontend: **Schedule…** action + datetime picker on approved posts, and a **Calendar** tab on the client (agenda grouped by day, reschedule/cancel, permalinks). Verified: routes registered; beat fires + worker runs the sweep every minute; due-sweep marked a real due row `failed` on the approval guard (no Zernio call); full API flow — approve → past-time 400 → future schedule → calendar enrichment → cancel — all green; frontend builds clean.
  - *Design note:* we hold scheduled posts locally (not Zernio's `scheduledFor`) so approval/channel are re-validated at send time, cancel/reschedule are pure-local, and the signed media token is always fresh when Zernio fetches it.

- **Phase 4 — AI best-time auto-pilot + reviewer queue (DONE & verified)**: **`services/autopilot.py`** — deterministic best-time engine (`propose_schedule`): per-platform engagement-window table (`BEST_WINDOWS`), seeded by each post's Editorial-AI `best_time` hint (`parse_hint_time`), spreads posts across the campaign window (`per_day`), skips weekends for weekday-only platforms (LinkedIn), guarantees strictly-future, collision-free, timezone-correct slots (`zoneinfo`). Endpoints on the campaign: `POST /autopilot/preview` (proposes — nothing persisted; returns proposals + skipped-with-reason) and `POST /autopilot/commit` (writes the user-edited calendar to `ScheduledPost` via `schedule_post`, re-validating approved + connected + future per item). **Reviewer queue**: `GET /review-queue` (org-scoped, `require_reviewer`) lists `pending_review` posts across the org enriched with campaign/client/platform/preview. Frontend: **AI auto-schedule** button on ready campaigns → `AutopilotModal` (editable proposed times + rationale + skipped list → commit), and a **Review Queue** page/nav for reviewers + org admins (approve/reject inline). Verified: engine unit test (AI hint honored, LinkedIn weekend→Monday, tz-correct, future, spaced); full API flow — approve 3 + submit 1 → preview (3 proposals, 1 skipped "Awaiting approval") → commit (3 scheduled) → calendar shows 3 → review-queue shows the 1 pending; frontend builds clean.
  - *Design note:* the engine is deterministic (no live LLM call at schedule time) for robustness + rate-limit safety; "AI best-time" comes from the editorial agent's `best_time` hints surfaced per slot. An LLM-refinement pass could be layered on later behind the same preview/commit contract.

**➡ Social publishing (Phases 0–4) COMPLETE.** Possible follow-ups: LLM-refined auto-pilot, live hosted-OAuth `connect` round-trip test, `Article.org_id` for strict null-client isolation, prod `public_base_url`.

## 8. Open risks / to validate

- **MinIO reachability in production** — the signed media endpoint must be internet-reachable for Zernio to fetch; confirm prod ingress.
- **Zernio account verification** — "we have accounts, need to verify they work": Phase 1 `verify` button calls Zernio to confirm each token is live; surfaces expired/revoked.
- **Per-platform publish constraints still apply** (IG needs Business/Creator, TikTok video specs, YouTube as video, X media limits) — Zernio enforces, but our UI should pre-validate rendition type vs channel.
- **Token/secret handling** — Zernio key encrypted via `core/crypto.py`, masked in UI, never logged.
- **Backfill correctness** — existing single-tenant data must land in one default org without leaking across the new boundary.
