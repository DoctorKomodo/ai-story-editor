# Handoff: Inkwell — Story Editor

## Overview

Inkwell is a self-hostable, web-based long-form fiction editor with AI assistance powered by **Venice.ai**. Writers manage multiple **stories**, each broken into **chapters**, with a persistent **character bible** and **story outline**. An always-visible AI chat panel on the right provides rewrite, describe, expand, continue-writing, and free-form chat — all routed through Venice.ai with prominent model selection.

Target stack is the user's preference, but intended shape: **Node.js/TypeScript API + Postgres + Redis + a React frontend**, packaged as a Docker Compose stack for self-hosting. Per-user auth. All prose lives on the user's own instance; only Venice API calls leave the box.

## About the Design Files

The files in `design/` are **design references created in HTML + React (via inline Babel)**. They are prototypes demonstrating the intended look, layout, and behavior — **not production code to copy directly**.

The task is to **recreate these HTML designs in a real application environment**: a proper React (Next.js, Vite, or Remix) frontend against a real Node/TypeScript API, with real auth, real persistence (Postgres), and real Venice.ai integration. Apply the project's established patterns and libraries (or, if starting fresh, choose them deliberately — see **Recommended stack** below).

## Fidelity

**High-fidelity.** Pixel-perfect mockups with final colors, typography, spacing, and interactions. Recreate the UI faithfully — exact hex values, type sizes, spacing, border radii, transition durations. All tokens are defined in `design/styles.css` as CSS custom properties.

## Recommended stack

| Layer | Choice | Notes |
|---|---|---|
| Frontend | **Next.js 14 (App Router) + React 18 + TypeScript** | SSR for the editor isn't critical, but the routing + layout model fits multi-story apps well. Alternative: Vite + React Router. |
| Editor | **TipTap** (ProseMirror) | The "paper" editor needs rich text (bold/italic/H1/H2/quote/lists), selection tracking, and character-reference decorations. TipTap's extension model handles all of this cleanly. |
| Styling | **CSS variables (tokens from `styles.css`) + CSS Modules** or **Tailwind with a custom theme mirroring the tokens** | Either works; the token set is small and deliberate. |
| State | **Zustand** for UI state (active chapter, selection, model, tweaks). **TanStack Query** for server state. | |
| API | **Node 20 + Fastify (or Hono) + TypeScript** | Thin API; most complexity is Venice passthrough + persistence. |
| Auth | **Lucia Auth** or **Better Auth** with argon2id password hashing, session cookies (HttpOnly, SameSite=Lax). | Usernames unique, lowercased. Password min 8 chars in production (prototype uses 4 for demo speed). |
| DB | **Postgres 16** with **Drizzle ORM** or **Prisma**. | |
| Cache/sessions | **Redis 7** | |
| Background jobs | **BullMQ on Redis** | For auto-save debouncing, export jobs, embedding backfill. |
| AI | **Venice.ai** via their OpenAI-compatible endpoint (`https://api.venice.ai/api/v1`). Use the official OpenAI SDK pointed at Venice. | Streaming completions are required for the "Continue writing" and chat experiences. |
| Deployment | **Docker Compose** (`app`, `db`, `redis`) | Single-command `docker compose up`. |

---

## Screens / Views

### 1. Auth Screen (`auth.jsx`)

**Purpose:** Gate the application behind username+password auth. Used for both sign-in and sign-up.

**Layout:**
- Two-column full-viewport grid: `grid-template-columns: 1fr 1fr`.
- Below 720px: single column (hide the left hero column).

**Left column — hero:**
- Padding `36px 44px`, background `var(--bg-sunken)` (`#f3efe6` on paper theme), `border-right: 1px solid var(--line)`.
- Subtle ambient radial gradients (see `.auth-hero::before` in `styles.css`).
- Top: brand lockup — feather icon (lucide-style, `stroke-width: 1.5`) + "Inkwell" in italic serif, 22px.
- Middle: a serif italic pull quote, 22px/1.5 line-height, max-width 440px, with a sans cite line below in 12px uppercase small caps.
- Bottom: mono metadata `"Self-hosted · v0.4.2 · inkwell-01"`.

**Right column — form:**
- Centered 360px max-width card.
- Title: `var(--serif)` 28px, weight 500, `-0.01em` letter-spacing.
- Subtitle: 13px, `var(--ink-3)`.
- Fields: `auth-field` — column flex with 5px gap. Label is 12px weight 500 + optional hint in 11px `var(--ink-4)`. Input is `.text-input` at 8px 10px padding, 13.5px.
- Password field has a toggle eye button for show/hide.
- Submit button: full-width `.btn.primary` at 9px 14px, 13px. Shows spinner + "Signing in…" during a 600ms fake delay.
- Mode switch link below ("First time here? Create an account" / "Already have an account? Sign in").
- Foot: shield icon + "Authenticated against your self-hosted Inkwell server."

**States:**
- `mode`: `"login"` | `"signup"`.
- `busy`: disables submit + shows spinner.
- `error`: renders red `.auth-error` block above the submit button.
- Validation: name required (signup only), username required, password ≥ 4 chars (raise to 8 in production).

**On success:** Persist user to localStorage (in prototype). In production: POST credentials, receive a session cookie, return to main app.

---

### 2. Main App Shell (`app.jsx` → `MainApp`)

**Layout:** CSS grid `44px` top bar over a three-column body.

```
grid-template-columns: 260px 1fr 360px;
grid-template-rows: 44px 1fr;
grid-template-areas:
  "topbar topbar topbar"
  "sidebar editor chat";
```

Layout variants (toggled via `data-layout` attribute on the root):
- `""` / `three-col`: full layout.
- `nochat`: `260px 1fr 0`, right panel hidden.
- `focus`: `0 1fr 0`, only editor visible.

### 2a. Top Bar

- Height 44px, `border-bottom: 1px solid var(--line)`, padding `0 14px`, `gap: 16px`.
- Left: brand cell (feather + italic "Inkwell", 16px) with right border, 244px min-width.
- Center: breadcrumbs — `Story title / Chapter N / Chapter title`, separators in `var(--ink-5)`.
- Right: save indicator (green dot + "Saved · 12s ago"), word count (`var(--mono)` 12px), icon buttons (History, Focus, Settings), and 26px round user-initials avatar opening a dropdown menu.

**User menu** (positioned absolute, 220px wide):
- Header with name + `@username` (mono font).
- Menu items: Settings, Your stories, Account & privacy, divider, Sign out (danger red).

### 2b. Sidebar (`sidebar.jsx`)

- Width 260px, `border-right: 1px solid var(--line)`, vertical flex.
- **Header:** Story picker (book icon + title + chevron-down) clickable to open the Story Picker modal. Plus button beside.
- **Tabs row:** Chapters / Cast / Outline. Active tab has a 1px bottom accent.
- **Body:** scrollable; content depends on tab:

**Chapters tab:**
- Section header "Manuscript" in 11px uppercase tracking .08em `var(--ink-4)`, with reveal-on-hover add button.
- Each `.chapter-item`: 2-digit mono number (18px fixed width) · title · word count chip (formatted as `2.8k` / `—`). Active item: `background: var(--accent-soft)`.

**Cast tab:**
- "Principal" section (first 2 characters), "Supporting" section (rest).
- `.char-card`: 28px colored circular avatar with serif-italic initial, name (13px weight 500), role+age (11px `var(--ink-4)`). Clicking opens the character popover anchored to the avatar.

**Outline tab:**
- "Story Arc" section. `.outline-item` has a 6px bullet (left 12px, top 12px). States: `.done` → green, `.current` → black with 3px halo ring, default → `var(--ink-5)`.

**Footer:** story progress — `42,318 / 90,000 words · 47%` with a 2px linear progress bar.

### 2c. Editor (`editor.jsx`)

- Vertical flex: `FormatBar` (40px) on top, scrollable paper below.
- Paper area: `max-width: 720px` centered, top padding 48px, side padding 80px, bottom padding 240px.

**Format bar** (`.format-bar`):
- 40px height, `padding: 6px 24px`, `border-bottom: 1px solid var(--line)`.
- Groups separated by 1px dividers. 28×28 `.fb-btn` icon buttons.
- Groups: Undo/Redo · Style selector ("Body" pill with chevron, serif font) · Bold/Italic/Underline/Strike · H1/H2/Quote · Bullet/Ordered list · Link/Highlight · spacer · Find/Focus.
- Bold button is shown `.active` in the prototype; wire to actual TipTap marks.

**Paper:**
- Document title: serif 28px weight 600.
- Sub: uppercase tracking .04em mono-feel line — genre · "Draft 2" · word count · status chip.
- Chapter heading: serif italic 22px, `margin-top: 48px`, with a right-aligned sans `§ 01` label and a 1px bottom border.
- Prose: **`var(--serif)` (Iowan Old Style), 18px, line-height 1.7**, `text-wrap: pretty`.

**Character references in prose** (`.char-ref`):
- 1px dotted underline in `var(--ink-5)`, `cursor: help`.
- On mouseenter, show `.char-popover` (absolute, 280px) anchored below. Fields: Appearance, Voice, Arc.

**Selection bubble** (`.selection-bubble`):
- Listens to `document`'s `mouseup` + `keyup`. On each event, reads `window.getSelection()`; if non-collapsed and inside `proseRef`, positions the bubble 44px above the selection's `getBoundingClientRect()`, centered horizontally, clamped to the paper area.
- Hide on: collapsed selection, selection outside prose, Escape, scroll.
- `onMouseDown: preventDefault()` on the bubble itself so clicking doesn't clear the selection.
- Styling: dark pill (background `var(--ink)`, text `var(--bg)`), 4px padding, 6px 18px/22% shadow. Four actions (Rewrite/Describe/Expand · Ask AI) separated by a thin divider.
- Rewrite/Describe/Expand trigger the inline AI result card. Ask AI bubbles the selected text + chapter metadata up to the chat panel and clears the selection.

**Inline AI result card** (`InlineAIResult`):
- Shown below the prose after Rewrite/Describe/Expand.
- Wraps the original selection as a serif italic quote with left border.
- Thinking state: three bouncing dots (`.think-dot` with staggered `animation-delay`).
- Done state: serif 16px AI output + action row (Replace, Insert after, Retry, spacer, Discard).
- In production: stream tokens from Venice via SSE; replace thinking state with live text.

**Continue Writing affordance:**
- Dashed rounded pill in `var(--ai)` (muted purple) labeled "Continue writing", plus mono hotkey hint "⌥↵ generates ~80 words in your voice".
- After click: shows AI continuation inline (purple tinted `.ai-continuation` span) and a summary bar with Keep/Retry/Discard.

### 2d. Chat Panel (`chat.jsx`)

- Width 360px, `border-left: 1px solid var(--line)`.
- Vertical sections: header (40px), model bar, scrollable body, composer.

**Header:**
- Tabs: Chat / History (pill-style, active uses `var(--accent-soft)`).
- Actions: New chat, Settings (sliders icon).

**Model bar** (`.model-bar`):
- `background: var(--bg-sunken)`, 10px 14px padding, border-bottom.
- Row 1: "MODEL" label (10px uppercase tracking .08em) + the model picker button.
- Model picker: 18×18 black square "V" venice mark + `mono` model name + `.ctx-chip` context window (`32k`) + chevron. Clicking opens the full model picker modal.
- Row 2: mono-font inline params `temp 0.85  top_p 0.95  max 800` + right-aligned `70B · Dolphin 2.9.2`.

**Messages:**
- User message: sans 13px, `var(--accent-soft)` pill bubble with 8px 12px padding and `--radius-lg`.
- AI message: serif 13.5px/1.55, no background, 2px left border in `var(--ai)`. Below: meta row with Copy / Regenerate / `412 tok · 1.8s`.
- Attachments (from Ask AI): shown above user bubble as a serif italic quote with mono "FROM CH. N" caption and left border.
- Suggestion chips: stacked 8px 10px pills (sans 12.5px) with icon + label.
- Context chip at end: dashed border, mono 11px — `"Chapter 3 · 4 characters · 2.4k tokens attached to context"`.

**Composer** (`.composer`):
- When `attachedSelection` is set: show an attachment preview block above the input (paperclip icon, mono "ATTACHED FROM CH. N" caption, 2-line-clamped serif italic quote, X to clear).
- Textarea auto-grows on input (max 120px).
- Send button: 28×28 black square with arrow-up icon. Disabled when input empty and no attachment.
- Below input: mode tabs (Ask / Rewrite / Describe — sans 11px, active uses `var(--accent-soft)`) and right-aligned "⌘↵ send" hint.
- `Cmd/Ctrl+Enter` submits.

---

### 3. Settings Modal (`modals.jsx` → `SettingsModal`)

Width 720px centered over a `rgba(20,18,12,.4)` backdrop with 3px blur.

**Header:** Title "Settings" (serif 18px), sub "Configure Venice.ai integration, writing preferences, and self-hosting". Close X.

**Nav** (horizontal tabs with 1px bottom accent on active):
1. **Venice.ai** — API key (password input with eye toggle, "Verified · 2.2k credits" green status pill), endpoint override, organization. Feature toggles: Chat completions, Text continuation, Inline rewrite, Image generation, Character extraction, Embeddings. Privacy: request logging toggle, send-story-context toggle.
2. **Models** — Radio-card list of Venice models (see **Data** below). Selected card has `border-color: var(--ink)`. Generation parameters: temperature, top_p, max_tokens, frequency_penalty sliders. System prompt textarea (serif).
3. **Writing** — Typewriter mode, Focus paragraph, Auto-save, Smart quotes, Em-dash expansion. Daily goal target (words).
4. **Appearance** — Theme picker (Paper / Sepia / Dark as 3 tile buttons showing live color preview). Prose font select (Iowan / Palatino / Garamond / IBM Plex Serif). Prose size slider (14–24px). Line height slider (1.3–2.0).

**Footer:** mono hint "Changes save automatically to your local vault" + Cancel + Done primary button.

**NOTE:** The "Self-hosting" tab was removed per stakeholder direction — self-hosting will be handled externally (outside the app settings, via compose env files).

---

### 4. Story Picker Modal

- 480px modal. List of stories as rows: 34×44 serif-italic initial tile + title (serif 15px) + mono metadata "Fantasy · 42,318 / 90,000". Active row shows "open" pill and `border: 1px solid var(--ink)`.
- Footer: "N stories in vault" + Import .docx + New story.

### 5. Model Picker Modal

- 480px modal. Same model cards as Settings → Models. Click to pick + close.

### 6. Character Popover

- 280px absolute, anchored below the hovered name or clicked avatar.
- Serif name (16px) + uppercase role/age caption.
- Three fields: Appearance, Voice, Arc — each with mono uppercase caption and serif value.
- Footer buttons: Edit · Consistency check.

### 7. Tweaks Panel (prototype-only)

Floating 280px bottom-right panel exposing Theme / Layout / Prose font switchers. **Do not ship in production.**

---

## Interactions & Behavior

### Selection bubble flow
1. User drags to select prose in the editor.
2. On `mouseup` / `keyup`, read `window.getSelection()`; if non-empty and inside the prose region, compute bounding rect and position bubble 44px above centered.
3. Hide bubble on: scroll, selection collapse, selection outside prose, Escape.
4. Bubble uses `onMouseDown: preventDefault()` to keep selection alive during click.

### AI actions
- **Rewrite / Describe / Expand** — call Venice with the selection + chapter context + story bible. Stream into the inline result card. Actions: Replace (diff-replace the selection), Insert after (append at selection end), Retry (regenerate), Discard (dismiss card).
- **Ask AI** — pipe selection text + chapter metadata into the chat panel as an attachment, auto-prefill "Help me with this passage — ", focus the composer.
- **Continue writing** (⌥↵) — call Venice with cursor context; render output as `<span class="ai-continuation">`. Keep accepts, Retry regenerates, Discard removes.

### Auth flow
- Sign in: POST `/auth/login` `{ username, password }` → session cookie → redirect to main app.
- Sign up: POST `/auth/signup` `{ name, username, password }` → create user (argon2id hash), issue session, redirect.
- Sign out: POST `/auth/logout` → clear session → return to auth screen.

### Persistence
- Editor auto-saves on debounced 4s idle via a Zustand middleware or TanStack mutation.
- Chapter text stored as TipTap JSON (not HTML) in `chapters.body_json`.
- Selection/active-chapter/model/tweaks persisted to localStorage so refresh lands where you left off.

### Keyboard shortcuts
- `⌘/Ctrl + Enter` — send message in chat composer.
- `⌥ + Enter` — continue writing from cursor.
- `Escape` — dismiss selection bubble / close modal.

### Animations
- Modals: fade-in backdrop (160ms ease-out) + content translate-y 8px + scale 0.98 → 1 (180ms cubic-bezier(.2,.9,.3,1)).
- Bubble / popover: opacity 0 + translateY 4px → 1 (140ms ease-out).
- Thinking dots: `think` keyframe, 1s ease-in-out infinite, staggered 0/.15/.3s.

---

## State Management

### Server state (TanStack Query)
- `stories` — list for current user.
- `story(id)` — full story with chapters (lazy-loaded bodies).
- `chapter(id)` — body JSON + metadata.
- `characters(storyId)` — character bible.
- `outline(storyId)`.
- `chats(chapterId)` — conversation history.

### Client state (Zustand)
- `user`, `activeStoryId`, `activeChapterId`, `activeSidebarTab`.
- `selection: { text, range, rect } | null`.
- `inlineAIResult: { action, text, status, output } | null`.
- `attachedSelection: { text, chapter } | null` — piped to chat.
- `model`, `params: { temperature, top_p, max_tokens, freq_penalty }`.
- `tweaks: { theme, layout, proseFont }` (ship as user preferences).

### Venice client
A thin server-side wrapper:
```ts
const openai = new OpenAI({ apiKey: userApiKey, baseURL: "https://api.venice.ai/api/v1" });
// Use chat.completions.create({ stream: true, ... }) for all AI actions.
```
Store each user's Venice API key encrypted (AES-256-GCM, key from env) in `users.venice_api_key`.

---

## Design Tokens

All defined as CSS custom properties in `design/styles.css` under `:root` (paper theme) with overrides for `[data-theme="sepia"]` and `[data-theme="dark"]`.

### Colors — Paper theme (default)
| Token | Value | Use |
|---|---|---|
| `--bg` | `#faf8f3` | Primary background |
| `--bg-elevated` | `#ffffff` | Cards, modals, inputs |
| `--bg-sunken` | `#f3efe6` | Model bar, hero, footer |
| `--surface-hover` | `#f0ebe0` | Hover background |
| `--ink` | `#1a1a1a` | Primary text |
| `--ink-2` | `#3a3a3a` | Secondary text |
| `--ink-3` | `#6b6b6b` | Tertiary text |
| `--ink-4` | `#9a958a` | Meta / labels |
| `--ink-5` | `#c4bfb3` | Disabled / dividers in text |
| `--line` | `#e8e2d5` | 1px borders |
| `--line-2` | `#d8d1c0` | Stronger borders, inputs |
| `--accent` | `#2a2a2a` | Focus/active accent (near-black) |
| `--accent-soft` | `#efeadd` | Active tab bg, user bubble |
| `--mark` | `#ffe9a8` | `<mark>` highlights |
| `--selection` | `#e6dfcf` | Native selection color |
| `--danger` | `#8a3b2f` | Errors, destructive |
| `--ai` | `#5a4a8a` | AI accent (muted purple) |
| `--ai-soft` | `#ece8f4` | AI-tinted backgrounds |

### Colors — Sepia theme
bg `#f4ecd8` · elevated `#fbf6e8` · sunken `#ede3c9` · ink `#2d230f` · line `#dfd1ad` · accent-soft `#e7d9b3` · mark `#f5d878` · ai `#6b4a3a`.

### Colors — Dark theme
bg `#14130f` · elevated `#1c1b17` · sunken `#0f0e0b` · hover `#24221d` · ink `#ebe7dc` · ink-2 `#cdc8ba` · line `#2a2821` · accent-soft `#2a2821` · mark `#5a4a1a` · ai `#b8a8e0` · ai-soft `#26233a`.

### Typography
- `--serif`: `"Iowan Old Style", "Palatino Linotype", "Palatino", "Book Antiqua", Georgia, serif` — **used for all prose, titles, quotes, chat AI bubbles**.
- `--sans`: `"Söhne", "Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif` — UI chrome, buttons, labels.
- `--mono`: `"JetBrains Mono", "SF Mono", "Menlo", "Consolas", ui-monospace, monospace` — model names, params, metadata.

Type scale (observed):
- Prose: 18px / 1.7
- Document title: 28px weight 600
- Chapter title: 22px italic weight 500
- H1 (auth): 28px weight 500
- Modal title: 18px weight 500
- Body UI: 13–14px
- Labels: 11–12px
- Caption/meta: 10–11px uppercase tracking .04–.08em

### Spacing
Uses direct px values, not a scale. Common: 4, 6, 8, 10, 12, 14, 16, 18, 24, 36, 44, 48, 80.

### Radii
- `--radius`: `3px` — buttons, inputs, list items.
- `--radius-lg`: `6px` — modals, cards, composer.

### Shadows
- `--shadow-card`: `0 1px 0 rgba(0,0,0,.02), 0 0 0 1px var(--line)`.
- `--shadow-pop`: `0 8px 32px rgba(30,25,15,.12), 0 0 0 1px var(--line-2)`.

---

## Venice.ai Integration

### Default model set (`data.jsx`)

| ID | Family | Params | Ctx | Speed | Notes |
|---|---|---|---|---|---|
| `venice-uncensored` | Dolphin 2.9.2 | 70B | 32k | medium | **Recommended.** Flagship creative-writing model. |
| `llama-3.1-405b` | Meta Llama 3.1 | 405B | 65k | slow | Best for complex reasoning / nuanced prose. |
| `llama-3.3-70b` | Meta Llama 3.3 | 70B | 64k | fast | Balanced all-rounder. |
| `qwen-2.5-coder-32b` | Qwen 2.5 | 32B | 32k | fast | Structured output (outlines, bibles). |
| `deepseek-r1-llama-70b` | DeepSeek R1 | 70B | 64k | slow | Reasoning — plot consistency checks. |

Model list should be fetched from `GET https://api.venice.ai/api/v1/models` at runtime; the list above is a safe static fallback.

### Default params
`temperature: 0.85, top_p: 0.95, max_tokens: 800, frequency_penalty: 0.2`

### System prompt (editable per story)
Default in prototype:
> You are a careful co-writer working inside the novel "<title>" — a character-driven <genre> in the style of <reference>. Match the existing prose voice: concrete, unhurried, unfussy metaphors. Never break POV. If asked to continue, never exceed the user's requested length.

Attach story bible + current chapter as a separate message with role `system` (after the main system prompt) for every request.

---

## Data Model (suggested)

```ts
users        (id, name, username UNIQUE, password_hash, created_at, venice_api_key_enc, venice_endpoint, settings_json)
stories      (id, user_id, title, genre, target_words, system_prompt, created_at, updated_at)
chapters     (id, story_id, num, title, body_json JSONB, status, word_count, updated_at)
characters   (id, story_id, name, role, age, appearance, voice, arc, initial, color)
outline_items(id, story_id, order, title, sub, status)
chats        (id, chapter_id, created_at, title)
messages     (id, chat_id, role, content_json, attachment_json, model, tokens, latency_ms, created_at)
```

TipTap JSON is the canonical format for `chapters.body_json`. Export to HTML/Markdown/DOCX on demand.

---

## Files in this bundle

All under `design/`:

| File | Contents |
|---|---|
| `Inkwell.html` | Entrypoint. Loads fonts, React, Babel, and all component scripts in order. |
| `styles.css` | All design tokens + component CSS. **Read this first.** |
| `icons.jsx` | Lucide-style SVG icon set (`Icons.Feather`, `Icons.Sparkles`, etc). Replace with `lucide-react` in production. |
| `data.jsx` | Sample story, character bible, outline, Venice model list, seeded chat messages. Use as fixture data for your API. |
| `auth.jsx` | Auth screen (login/signup). |
| `sidebar.jsx` | Story picker, tabs, chapter/cast/outline lists, word progress. |
| `editor.jsx` | Format bar, paper layout, prose, selection bubble logic, inline AI result, continue-writing affordance. |
| `chat.jsx` | Chat panel — model bar, messages, composer, attachment pipe. |
| `modals.jsx` | Settings modal (Venice / Models / Writing / Appearance tabs), story picker, character popover, model picker menu. |
| `app.jsx` | App shell, top bar, user menu, Tweaks panel, state wiring. |

---

## Screenshots

All references are in `screenshots/`. Use these as the visual source of truth alongside the HTML prototypes.

| File | Screen |
|---|---|
| `01-main-app.png` | Main three-column app — sidebar (Chapters) + editor + AI chat panel |
| `02-sidebar-cast.png` | Sidebar on Cast tab — character cards (principal + supporting) |
| `03-sidebar-outline.png` | Sidebar on Outline tab — story arc with done / current / pending states |
| `05-settings-models.png` | Settings → Models (radio cards, generation params, system prompt) |
| `06-settings-writing.png` | Settings → Writing (typewriter, focus, auto-save, smart quotes, daily goal) |
| `07-settings-appearance.png` | Settings → Appearance (theme tiles, prose font, prose size, line height) |
| `08-model-picker.png` | Standalone Model picker modal (triggered from the chat model bar) |
| `09-auth-login.png` | Auth screen — sign in mode |
| `10-auth-signup.png` | Auth screen — sign up mode (extra Name field) |
| `11-selection-bubble.png` | Editor with a prose selection active — floating AI action bubble (Rewrite / Describe / Expand / Ask AI) |

## Open questions for the implementer

1. **Editor library** — TipTap is the assumed choice. If your codebase already uses Slate or Lexical, adapt; the selection-bubble pattern works on any ContentEditable.
2. **Streaming transport** — SSE is simpler for Venice; WebSocket only if you want bidirectional (e.g., cancel).
3. **Multi-user tenancy** — this prototype shows a single-user session. If hosting for multiple writers, every query must be user-scoped. Consider row-level security in Postgres.
4. **Rate limiting** — gate Venice calls per user (Redis token bucket, e.g., 60 req/min).
5. **Export formats** — DOCX and EPUB are table stakes for novelists. Plan for a background job (BullMQ) that renders TipTap JSON → Pandoc → output file.
