# ThreadWeave Design System

## Overview

ThreadWeave is a discussion-focused, nested, and community-driven design system for forum and discussion board platforms. It embraces depth through indentation, clear visual hierarchy for threaded conversations, and a sophisticated serif-meets-sans pairing.

## Colors

- **Primary** (#4338CA): Indigo — primary actions, active threads
- **Secondary** (#D97706): Amber — highlights, pinned posts
- **Tertiary** (#0F766E): Teal — moderator tools, resolved
- **Background** (#FAFAF9): Page background
- **Surface** (#FFFFFF): Thread cards, reply containers
- **Success** (#16A34A)
- **Warning** (#D97706)
- **Error** (#DC2626)
- **Info** (#2563EB)

## Do's and Don'ts
- Do indent nested replies by exactly 24px per level
- Don't exceed 5 nesting levels
- Do use Crimson Text for thread titles for a literary tone

---

# Implementation in this app

How the ThreadWeave system is applied across the AI Marketing Platform frontend
(`frontend/src/styles.css`, plain CSS variables — no UI framework).

## Typography

- **Headings / titles**: `Crimson Text` (serif) — literary tone, `--font-serif`.
- **Body / UI / buttons**: `Inter` (sans) — `--font-sans`.
- Both loaded from Google Fonts in `frontend/index.html`.

## Design tokens (CSS variables in `:root`)

- `--primary` #4338CA (indigo) · `--secondary` #D97706 (amber) · `--tertiary`
  #0F766E (teal).
- `--bg` #FAFAF9 (warm stone) · `--surface` #FFFFFF · `--border` #E7E5E4 ·
  `--text` #1C1917 · `--muted` #78716C.
- Soft elevation: `--shadow-sm/md/lg`; radii `--radius` 12px / `--radius-sm` 8px.

## Platform icons (brand logos)

Social platforms are shown with their **real brand logos**, never plain text, via
`components/PlatformIcon.tsx`:

- Source: `@icons-pack/react-simple-icons` for Facebook / Instagram / X / TikTok /
  YouTube; **LinkedIn is an inline SVG** (Simple Icons removed it for trademark
  reasons). Lucide is used only for generic UI glyphs.
- Each platform has a brand colour (e.g. Instagram #E4405F, LinkedIn #0A66C2).
- Used in: element platform chips, post preview tabs, element-modal platform tabs,
  and the ratio→platforms line.
- **Don't** use `lucide-react` for platform logos — v1.18 removed its brand icons.

## Components

- **Buttons** (`.btn`): inline-flex with a 6px gap so an icon + label align; primary
  indigo with a subtle glow, plus `.btn-secondary` (amber) / `.btn-tertiary` (teal).
- **Cards** (`.card`): soft shadow, lift + indigo border on hover.
- **Tabs & pills**: underline tabs (`.tab`/`.tab-active`); ratio/slide switchers use
  rounded pills (`.ratio-tab`) with a status dot (green ready / amber pulsing busy).
- **Image actions**: hover an image to reveal translucent, blurred icon buttons
  (`.icon-btn`) for edit / download / expand; click an image to open a **lightbox**
  (`.lightbox`) over a dimmed, blurred backdrop.
- **Generating states**: while content renders, show the indeterminate progress bar
  instead of a stale image; the campaign list shows a "Generating visuals…" chip
  when a `ready` campaign is still rendering media.
- **Login / sidebar**: indigo gradient (sidebar nav uses gradient active pills).

## Form inputs — pick, don't type

Match the control to the data. **Never use a free-text input for a value that
comes from a fixed set of choices** — typed values invite typos and drift.

- **Fixed set of options** → `<select>` dropdown (e.g. competitor type
  direct/indirect, scope local/national/international, language). Show friendly
  labels, store the canonical value.
- **On/off boolean** → checkbox (or toggle), not a `true`/`false` text field.
- **Numbers** → `<input type="number">` with sensible `min`/`max`.
- **Free text** (names, URLs, user-agent strings, regex paths) → plain text input.

Applied in System Settings → Global (`pages/SystemSettings.tsx`); follow the same
rule for any new settings or forms going forward.

## Grouping related items — boxed accent panels

When a screen lists many related items (settings, config rows, grouped fields),
**don't render them as one flat list** — group them by topic into distinct boxed
panels so each section is easy to tell apart at a glance:

- Each group is its own **boxed panel**: `1px` border, `--radius-sm`, soft
  `--shadow-sm`, `--surface` background.
- Give each group an **accent colour** via a `--group-accent` CSS variable, drawn
  from the palette (indigo `--primary`, amber `--secondary`, teal `--tertiary`,
  info blue `#2563EB`, neutral `--muted` for an "Other"/fallback group). Apply it
  as a **4px left border** plus a **low-opacity header tint**
  (`color-mix(in srgb, var(--group-accent) 8%, var(--surface))`) with the group
  title in the accent colour.
- Each group gets a short **header**: title + one-line description of what the
  group covers.
- Anything that doesn't fit a defined group falls into a neutral **"Other"** panel
  so nothing is hidden.

Reference implementation: the `.settings-group` / `.settings-group-head` styles in
`styles.css` and `SETTING_GROUPS` in `pages/SystemSettings.tsx`.