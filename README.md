# AI Marketing Platform

Internal web application for client intelligence, competitive analysis, and AI-powered
social media campaign generation. Built from `AI_Marketing_Platform_PRD_v1.1.docx`.

## Current status

| Module | Status |
|--------|--------|
| Module 6 — Users & roles (JWT auth, RBAC, audit log, password reset) | ✅ Implemented |
| Module 7 — LLM config & global settings (encrypted API keys, image model list) | ✅ Implemented |
| Module 1 — Client management (crawler + Claude extraction, review/confirm flow) | ✅ Implemented |
| Module 2 — Competitive intelligence | ✅ Implemented |
| Module 5 — Internal article library | ✅ Implemented |
| Module 3 — Campaign generation (Editorial + Visual agents, image editor, export) | ✅ Implemented |
| Module 4 — Article-to-content | ✅ Implemented |

Module 3 (Phase 4) covers: per-platform campaign configuration (§5.2–5.3), Brand Memory
per client (§5.3.3, versioned), the Editorial and Visual agents (§5.4), AI image
generation via the admin-curated Gemini/OpenRouter models (§5.5.4), the Image Editor for
manual logo placement and custom asset layers (§5.5), and export to ZIP / PDF / JSON / CSV
(§5.7).

Module 4 (Phase 5) reuses the campaign pipeline in an article-driven mode (§6): it
generates posts from a Library article, an external URL, or pasted text, with a content
angle (informational / opinion / promotional / educational) and per-platform link
handling (§6.4 — e.g. LinkedIn link in the first comment, "Link in bio" on Instagram/
TikTok). Launch it from the Campaigns page or the "Create content" button on any library
article. All Module 3 editing, image, and export tooling applies to the result.

The whole v1.1 PRD scope is now implemented. (Direct publishing to social platforms is
the planned v2.0 follow-up.)

**Beyond the PRD — video generation:** each post can have video slots (prompt seeded
from the post's image prompt, editable, with history). Generation runs async in Celery
against an admin-curated video model list (System Settings → Video generation models).
OpenRouter has no video models, so each entry targets its own provider — Google Veo
(Gemini API), fal.ai, or Replicate — with its own API key (stored encrypted). Until an
Admin adds a key, generation fails gracefully with a clear message; users can also
upload their own MP4/WebM/MOV. Videos are included in the ZIP export and the JSON.

## Stack

- **Backend:** Python FastAPI + SQLAlchemy + Celery (Redis) + httpx/BeautifulSoup crawler
- **Frontend:** React + TypeScript (Vite)
- **Database:** PostgreSQL · **Storage:** MinIO (S3-compatible) · **Email (dev):** Mailpit
- **LLMs:** Anthropic Claude (default) or OpenAI/OpenRouter per text function; OpenRouter
  (Gemini) or OpenAI (gpt-image-1 / DALL-E) for images; Google Veo, OpenAI Sora, fal.ai,
  or Replicate for video. Admins curate the image/video model lists; users pick a model
  at generation time. (Competitor identification stays Anthropic-only — it relies on the
  server-side web search tool.)

## Getting started

1. Copy `.env.example` to `.env` and fill in secrets (`JWT_SECRET`, `APP_ENCRYPTION_KEY`,
   `ANTHROPIC_API_KEY`, `OPENROUTER_API_KEY`, admin credentials).
2. Start the stack:

   ```bash
   docker compose up --build
   ```

3. Open:
   - Frontend: http://localhost:5173
   - API docs: http://localhost:8000/docs
   - Mailpit (dev email): http://localhost:8025
   - MinIO console: http://localhost:9001

On first startup the API seeds the admin user (`ADMIN_EMAIL` / `ADMIN_PASSWORD`),
one LLM config per function (Claude, key encrypted with AES-256-GCM), the default
image models, and global settings (crawler parameters etc.).

## Security notes

- LLM API keys are stored AES-256-GCM encrypted in the database (PRD §10.2); the UI
  only ever shows a masked hint.
- RBAC is enforced server-side on every endpoint.
- `.env` and `API KEYS.md` are gitignored. Rotate any key that has been shared in plain text.
