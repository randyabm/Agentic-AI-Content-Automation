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
| Module 4 — Article-to-content | Phase 5 |

Module 3 (Phase 4) covers: per-platform campaign configuration (§5.2–5.3), Brand Memory
per client (§5.3.3, versioned), the Editorial and Visual agents (§5.4), AI image
generation via the admin-curated Gemini/OpenRouter models (§5.5.4), the Image Editor for
manual logo placement and custom asset layers (§5.5), and export to ZIP / PDF / JSON / CSV
(§5.7).

## Stack

- **Backend:** Python FastAPI + SQLAlchemy + Celery (Redis) + httpx/BeautifulSoup crawler
- **Frontend:** React + TypeScript (Vite)
- **Database:** PostgreSQL · **Storage:** MinIO (S3-compatible) · **Email (dev):** Mailpit
- **LLMs:** Anthropic Claude for text agents; OpenRouter (Gemini image models) for image generation.
  Admins curate the image model list; users pick a model at generation time.

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
