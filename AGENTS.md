# AGENTS.md

Architecture notes for AI agents working on this repo. This documents the
adjustments layered on top of the original PRD build (`prd_extracted.md`). Read
`CLAUDE.md` first for how to run the stack; this file records *what changed and why*.

## Provider credentials (one key per provider)

Originally every LLM function and every image/video model stored its own encrypted
API key. Now there is a **single key per provider**, shared everywhere.

- Model `ProviderCredential` (`models/llm.py`), unique by canonical provider:
  `anthropic | openai | openrouter | google | fal | replicate`.
- `services/providers.py` is the registry: `credential_provider()` normalizes a
  per-domain provider string to its canonical key (e.g. `openai_sora` → `openai`,
  `google_veo` → `google`), `resolve_api_key()` returns the credential key (falling
  back to the entity's own legacy key), and `list_models()` proxies each provider's
  model-list API so the UI offers a **dropdown instead of a typed model ID**
  (anthropic/openai/openrouter/google supported; fal/replicate fall back to manual).
- Endpoints: `GET/PUT /provider-credentials`, `GET /providers/{provider}/models?kind=text|image|video`.
- `seed.py::_seed_provider_credentials` migrates existing keys into central
  credentials on boot (no reconfiguration needed).
- Key resolution is wired through `extraction.complete_text`, `competitor_intel`,
  `image_gen`, `video_gen` (transient `resolved_api_key` stashed on the cfg/model).

## System Settings UI

`pages/SystemSettings.tsx` is now **tabbed**: Providers & Keys · LLM Functions ·
Image Models · Video Models · Article Sources · Global. LLM functions and image/
video models are edited with a provider dropdown + auto-fetched model dropdown
(`ModelSelect`, with a manual fallback). No per-row API key fields.

## Image pipeline (element-centric, one visual per element)

Per `CampaignElement`, `PostImage` rows exist for each `(slot_index, aspect_ratio)`
— carousel slides are `slot_index`, ratio variants are `aspect_ratio`.

- **Base ratio + auto-derived ratios.** Within a slide, the highest-priority ratio
  (`_RATIO_PRIORITY` in `workers/tasks.py`, mirrors `frontend/src/ratios.ts`; 1:1
  first) is the base. Generating it auto-triggers `derive_element_ratios`, which
  recreates the *other ratios of the same slide only* (never other slides) via AI
  image-to-image reframe (`image_gen.generate_image_from`), falling back to
  `image_gen.reframe_local` (keeps the full image centred, fills the extension with
  a blurred zoomed copy — **never crops**).
- **Logo baked into generation.** When generating, the client logo bytes are passed
  to the model (`generate_image(logo_bytes=...)`) as the last input image with an
  instruction to render it small/undistorted in a corner. The AI draws the logo in.
  `canvas_state.logo_enabled` (default true) is the per-image toggle. If the
  image-to-image endpoint fails (OpenAI 520s), generation falls back to plain
  text-to-image and the logo is **composited as an overlay** instead
  (`logo_placement.compute_logo_geom` = Claude vision picks the spot;
  `compositing.py` burns it in, with optional scrim). Derived ratios copy the base's
  logo treatment so all ratios stay consistent. `compositing.py` only overlays a
  logo when one is explicitly present in `canvas_state` (manual editor or fallback).
- **Reference images.** `reference_images` table (campaign-scoped); uploaded via the
  Reference images panel and passed to `generate_image(reference_bytes=...)` so
  visuals match a real product. Only the direct/base generation uses references.
- **Safe margins.** `_SAFE_MARGINS` is appended to every image prompt so text/logos
  don't get clipped at the edges (gpt-image-1 clipped headlines asked to sit "at the top").
- **Frontend:** `ElementVisual` renders one image with Slide tabs (carousel) then
  ratio pills; `ImageSlot` remounts per image (`key`) so each shows its own prompt.
  Click an image → lightbox; hover → edit/download/expand icons. While any ratio of a
  slide is generating, generation is locked on all of them.

## Video pipeline (same presentation, manual variants)

Mirrors images but variants are **manual** (cost). Requires **ffmpeg** (installed in
`backend/Dockerfile`).

- `services/video_edit.py`: `extract_first_frame`, `overlay_logo` (logo burned in at
  the vision-decided spot), `reframe_video` (blurred-extend, no crop).
- `run_video_generation` overlays the logo after generation; `PostVideo.logo_enabled`
  (column added via manual `ALTER TABLE`) toggles it.
- Other ratios are NOT auto-derived. The user clicks "Generate other ratios" →
  `POST .../videos/{id}/derive-ratios` → `derive_video_ratios` reframes the base clip
  locally with ffmpeg. References are not used for video.
- **Frontend:** `VideoVisual` groups videos by ratio with the same pill switcher.

## Robustness

- OpenAI image endpoints retry transient 5xx (Cloudflare **520** on `/images/edits`)
  via `image_gen._openai_image_post` (6 attempts, backoff). On final failure, base
  generation falls back to text-to-image (+ overlaid logo) rather than failing.
- Campaign list exposes `visuals_generating` so the list shows "Generating visuals…"
  while a `ready` campaign still renders images/videos; element cards and the campaign
  detail hide stale visuals while regenerating.

## Design system

The frontend follows the **ThreadWeave** design system (`DESIGN.md`): Crimson Text
serif headings + Inter body, Indigo/Amber/Teal palette, soft-shadow cards, modern
icon buttons. **Platform brand icons** come from `@icons-pack/react-simple-icons`
(+ Lucide for UI glyphs) via `components/PlatformIcon.tsx` — LinkedIn is an inline
SVG (Simple Icons dropped it). lucide-react 1.18 removed brand icons, so do NOT use
it for platform logos.

## Schema changes applied by hand (no Alembic)

`create_all` only creates new tables. Columns added to existing tables need a manual
`ALTER TABLE` (see `CLAUDE.md`). Applied so far: `post_videos.logo_enabled boolean
NOT NULL DEFAULT true`; `clients.avatar_object_key varchar(500) NOT NULL DEFAULT ''`
(client profile photo, shown as the author avatar in post previews via
`GET/POST /clients/{id}/avatar`). New tables (`provider_credentials`,
`reference_images`) are created automatically.
