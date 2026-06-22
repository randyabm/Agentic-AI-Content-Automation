# Campaign Kanban Board + Configurable RBAC — Implementation Plan

Status: **proposed** (not yet built). Owner: Randy.

Goal: replace the flat campaigns grid with a Canva/Trello-style **Kanban board** where campaigns
move through a review→approval→scheduling workflow, gated by a **configurable per-role permission
matrix** that the Org Admin controls. Separate the people who *edit*, *approve copy*, *approve
graphics*, and *publish*.

This builds on the existing post-level approval flow (`ApprovalStatus`, `submit`/`approve`/`reject`
in `backend/app/api/routes/campaigns.py`) and the existing drag-and-drop `PipelineBoard.tsx`.

---

## 1. Decisions locked in

| Topic | Decision |
|---|---|
| Board columns | `Sin asignar / Borrador` → `En revisión` → `Aprobada` → `Programada` → `(Publicada)`. Generation happens inside Borrador (it's fast). |
| Board unit | The **campaign** is the card. Its column is a **roll-up** of its posts' approval/scheduling state — it does not duplicate the post-level `PipelineBoard` (which stays per-post in the calendar). |
| Approval gates | **Two independent tracks per campaign: Copy and Media (images/videos).** Different people sign off each, in parallel. Campaign reaches `Aprobada` only when *both* are complete across all its posts. |
| RBAC model | **Capability-based.** Capabilities are decoupled from roles; each of the **5 existing roles is an editable bundle** of capabilities. Granularity = **per-role** (no custom roles, no per-user overrides in v1). |
| Who configures | The **Org Admin** edits the matrix and assigns one role per member. |
| Separation of duties | `approve_copy` ≠ `approve_media` ≠ `publish` ≠ `edit_media` — all distinct capabilities. |
| Backward compatibility | Seed the matrix with today's effective defaults so nothing changes behavior until an admin edits it. |
| View toggle | Keep a **Board / Grid** toggle (like the calendar's board/list views); board is the default. |

Build order: **Piece 1 (RBAC matrix) → Piece 2 (dual approval) → Piece 3 (Kanban board).**

---

## 2. Piece 1 — Configurable RBAC matrix

### 2.1 Capabilities (stable keys)

```
view_content          # see campaigns & content
edit_campaign         # create/edit campaign setup (client, objective, platforms, elements)
edit_copy             # generate/edit post copy
edit_media            # generate/edit images & videos
submit_review         # send a campaign/post to review
approve_copy          # approve/reject copy
approve_media         # approve/reject images & videos
schedule              # place approved content on the calendar
publish               # publish now / send to connected channels
manage_channels       # connect/manage social channels
manage_members        # manage org members & role assignments
configure_permissions # edit this matrix
```

### 2.2 Default matrix (seeded; editable by Org Admin)

| Capability | Viewer | Creative | Reviewer | Analyst | Org admin |
|---|:--:|:--:|:--:|:--:|:--:|
| view_content | ✓ | ✓ | ✓ | ✓ | ✓ |
| edit_campaign | – | – | – | ✓ | ✓ |
| edit_copy | – | ✓ | – | ✓ | ✓ |
| edit_media | – | ✓ | – | – | ✓ |
| submit_review | – | ✓ | – | ✓ | ✓ |
| approve_copy | – | – | ✓ | – | ✓ |
| approve_media | – | – | ✓ | – | ✓ |
| schedule | – | – | – | ✓ | ✓ |
| publish | – | – | – | – | ✓ |
| manage_channels | – | – | – | ✓ | ✓ |
| manage_members | – | – | – | – | ✓ |
| configure_permissions | – | – | – | – | ✓ |

`org_admin` is always implicitly allowed everything (cannot be locked out of `configure_permissions`).

### 2.3 Data model

- New enum `Capability(str, enum.Enum)` (the keys above) in `backend/app/models/`.
- New table **`role_permissions`**: `id, org_id (FK→organizations), role (OrgRole), capability (Capability),
  allowed (bool), updated_at`. One row per (org, role, capability). Unique on `(org_id, role, capability)`.
- Seeded for every org from the default matrix (on org creation + a backfill migration for existing orgs).
- Register in `models/__init__.py`. SQL migration under `migrations/0NN_role_permissions.sql`.

### 2.4 Enforcement (backend)

- New dependency `require_capability(*caps)` in `api/deps.py`: loads the actor's org's
  `role_permissions` for `actor.org_role`, checks the capability; platform admin + org_admin bypass.
  Cache the per-(org,role) capability set (short TTL or invalidate on matrix write).
- **Refactor existing guards** route-by-route to capabilities (keep behavior identical to defaults):
  - `require_reviewer` (approve endpoints) → `require_capability("approve_copy" | "approve_media")` per track.
  - `require_editor` (schedule/publish in `scheduling.py`) → split: schedule routes → `schedule`;
    publish routes → `publish`.
  - `require_content_editor` (analyst/creative) → `edit_campaign` / `edit_copy` / `edit_media` as fits each route.
  - `require_contributor` → `submit_review` / `view_content` as fits.
  - `require_org_admin` (members) → `manage_members`; matrix endpoints → `configure_permissions`.
- This is the **highest-risk** step (touches many routes). Do it mechanically, one router at a time,
  asserting the default matrix reproduces current access.

### 2.5 API

- `GET /org/permissions` — the matrix (capabilities catalog + current allow grid). `view` for members,
  edit requires `configure_permissions`.
- `PUT /org/permissions` — set `{role, capability, allowed}` cells (org_admin only). Audited.
- Extend `GET /me` (or `/auth/me`) to include the **current user's resolved capability set**, so the
  frontend can show/hide actions and gate board drags.

### 2.6 Frontend

- New **Org Settings → Permissions** screen: the matrix grid (rows = capabilities, columns = the 5
  roles, cells = toggles), Org-Admin-only, with a reset-to-defaults action.
- Member management: assign exactly one role per member (likely already exists — wire role list).
- A small `useCapabilities()` helper (from the `/me` payload) replacing ad-hoc role checks like the
  current `canEdit`/`canReview` props in `PipelineBoard.tsx`.

---

## 3. Piece 2 — Dual approval gate (copy + media)

- Today approval is a single `Post.approval_status`. Reinterpret/extend so a campaign has **two
  tracks**:
  - **Copy track** — per `Post` (reuse `Post.approval_status`: draft/pending_review/approved/rejected).
  - **Media track** — new approval state on the visual. Add `approval_status` to `PostImage`/`PostVideo`
    (or a single per-element approval). Migration adds the column(s) with default `draft`.
- New endpoints mirroring the copy ones, gated by `approve_media`:
  `POST /campaigns/{id}/media/{image_id}/approve|reject` (+ submit if needed).
- **Publish guard** updated: a post is publishable only when its copy is `approved` **and** all its
  media is `approved` (extends the existing check in `_publish_guards`).
- Reviewers can be operationally specialized (one person does copy, another does media) purely by
  which capability their role has — no custom roles needed in v1.

---

## 4. Piece 3 — Campaign Kanban board

### 4.1 Columns & roll-up

Column for a campaign is derived from its posts/media:
- `Borrador` — generating, or not yet submitted.
- `En revisión` — submitted; copy and/or media still pending.
- `Aprobada` — all copy approved **and** all media approved.
- `Programada` — approved **and** at least one post scheduled (rolls up from `ScheduledPost`).
- `Publicada` — all scheduled posts published.

`Sin asignar` = the Borrador bucket (campaigns not yet in the workflow). (Optionally split a literal
"unscheduled" lane later, mirroring `ScheduleablePostsSidebar`.)

### 4.2 Drag rules (gated by capability)

| Drag | Requires | Action |
|---|---|---|
| Borrador → En revisión | `submit_review` | submit the campaign's posts for review |
| En revisión → Aprobada | `approve_copy` + `approve_media` | (or done per-track on the card; board move only when both complete) |
| En revisión → Borrador | `approve_copy`/`approve_media` | reject with note |
| Aprobada → Programada | `schedule` | opens the scheduling/calendar flow |

Reuse `dnd-kit` and the column/drag scaffolding from `PipelineBoard.tsx`.

### 4.3 Card & screen

- Compact card: client avatar + name + platform icons + date + status dot; generated-image thumbnail
  when available (via the `/display` variants); hover quick actions (open, regenerate, duplicate, delete).
- In `En revisión`, the card shows the two tracks (Copy ✓/pending, Media ✓/pending) with inline
  approve/reject for users who have the capability.
- Top bar keeps existing client filter + search; **status stops being a filter** (it's the columns).
- **Board / Grid toggle** retains the current grid for anyone who prefers it.
- Replaces the grid in `frontend/src/pages/Campaigns.tsx`.

---

## 5. Migrations

1. `role_permissions` table + backfill defaults for every existing org.
2. Media approval column(s) on `post_images` / `post_videos` (default `draft`); backfill existing
   `ready` media to `approved` so current campaigns stay publishable.
3. No destructive changes; all additive (`IF NOT EXISTS`).

---

## 6. Risks & open questions

- **Route refactor risk** (2.4): broad surface. Mitigation: per-router, default matrix == current behavior.
- Roll-up performance on the board: compute campaign column server-side (one query per board load).
- Open: should `Analyst` get `publish` by default, or only `Org admin`? (Default table says Org admin only.)
- Open: backfill — existing campaigns are all `ready`; do they land in `Aprobada` or `Borrador` on first
  board load? (Proposal: treat `ready` media/copy as approved → `Aprobada`.)
- Future (not v1): custom named roles, per-user overrides, a literal "unscheduled" lane.
