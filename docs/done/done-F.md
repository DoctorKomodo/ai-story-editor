> Source of truth: `TASKS.md`. Closed [F]-series tasks (F1–F67 — original frontend, mockup-fidelity implementation, page-integration, and core-completion subsections) archived here on 2026-05-02 to keep `TASKS.md` lean. The Phase 4 (Storybook) subsection is still live in `TASKS.md`. Note: F63 and F65 were still open at archiving time — they remain as live tasks in `TASKS.md`.
> These entries are immutable; any reopen lands as a new task in `TASKS.md`.

---

## 🎨 F — Frontend

- [x] **[F1]** React Router: `/login`, `/register`, `/` (dashboard), `/stories/:id` (editor). Auth guard redirects to `/login`.
  - verify: `cd frontend && npm run test:frontend -- --run tests/routing.test.tsx`

- [x] **[F2]** `useAuth()` hook: provides `user`, `login()`, `logout()`, `register()`. JWT stored in memory. Calls `/api/auth/refresh` on app load.
  - verify: `cd frontend && npm run test:frontend -- --run tests/hooks/useAuth.test.tsx`

- [x] **[F3]** API client `src/lib/api.ts`: attaches Bearer token, retries once after 401 refresh, throws typed errors.
  - verify: `cd frontend && npm run test:frontend -- --run tests/lib/api.test.ts`

- [x] **[F4]** Login and Register pages with inline validation. Redirect to `/` on success.
  - verify: `cd frontend && npm run test:frontend -- --run tests/pages/auth.test.tsx`

- [x] **[F5]** Dashboard: story card grid with title, genre, synopsis, chapter count, word count, last edited. "New Story" opens create modal.
  - verify: `cd frontend && npm run test:frontend -- --run tests/pages/dashboard.test.tsx`

- [x] **[F6]** Create/edit story modal: title (required), genre, synopsis, worldNotes fields.
  - verify: `cd frontend && npm run test:frontend -- --run tests/components/StoryModal.test.tsx`

- [x] **[F7]** Editor layout: left sidebar (chapters), centre (TipTap), right (AI panel, collapsible). Story title in top bar.
  - verify: `cd frontend && npm run test:frontend -- --run tests/pages/editor.test.tsx`

- [x] **[F8]** TipTap editor: bold, italic, headings 1-3, paragraph, word count in footer.
  - verify: `cd frontend && npm run test:frontend -- --run tests/components/Editor.test.tsx`

- [x] **[F9]** Autosave: 2s debounce, shows "Saving…" / "Saved ✓" / "Save failed — retrying".
  - verify: `cd frontend && npm run test:frontend -- --run tests/components/Autosave.test.tsx`

- [x] **[F10]** Chapter list sidebar: ordered, with word counts. Click to load. "Add chapter" button. Drag handles via dnd-kit.
  - verify: `cd frontend && npm run test:frontend -- --run tests/components/ChapterList.test.tsx`

- [x] **[F11]** Chapter drag-to-reorder: optimistic update, calls reorder endpoint, reverts on failure.
  - verify: `cd frontend && npm run test:frontend -- --run tests/components/ChapterReorder.test.tsx`

- [x] **[F12]** AI assistant panel: action buttons (Continue, Rephrase, Expand, Summarise) + freeform input. Shows highlighted editor text as context.
  - verify: `cd frontend && npm run test:frontend -- --run tests/components/AIPanel.test.tsx`

- [x] **[F13]** Venice model selector: dropdown from `GET /api/ai/models`. Shows model name and context window size (e.g. "128K"). Groups reasoning-capable models. Persists to localStorage.
  - verify: `cd frontend && npm run test:frontend -- --run tests/components/ModelSelector.test.tsx`

- [x] **[F14]** Web search toggle: checkbox in AI panel enabling `enableWebSearch`. Only visible when selected model supports it.
  - verify: `cd frontend && npm run test:frontend -- --run tests/components/WebSearchToggle.test.tsx`

- [x] **[F15]** Streaming AI response: renders tokens as they arrive. "Insert at cursor" appends into TipTap at cursor position. "Copy" button.
  - verify: `cd frontend && npm run test:frontend -- --run tests/components/AIStream.test.tsx`

- [x] **[F16]** Venice usage indicator: reads `x-venice-remaining-requests` and `x-venice-remaining-tokens` headers after each AI call. Shows in AI panel (e.g. "482 requests / 1.2M tokens remaining").
  - verify: `cd frontend && npm run test:frontend -- --run tests/components/UsageIndicator.test.tsx`

- [x] **[F17]** Account balance: calls `GET /api/ai/balance` on editor load. Shows USD and Diem balance in user menu.
  - verify: `cd frontend && npm run test:frontend -- --run tests/components/BalanceDisplay.test.tsx`

- [x] **[F18]** Characters panel: sidebar tab listing story characters. "Add character" button. Click to open character sheet.
  - verify: `cd frontend && npm run test:frontend -- --run tests/components/CharacterList.test.tsx`

- [x] **[F19]** Character sheet modal: all fields, save and delete with confirm dialog.
  - verify: `cd frontend && npm run test:frontend -- --run tests/components/CharacterSheet.test.tsx`

- [x] **[F20]** Export: download chapter or full story as `.txt`, client-side.
  - verify: `cd frontend && npm run test:frontend -- --run tests/components/Export.test.tsx`

- [x] **[F21]** Dark mode: toggle in top nav, persisted to localStorage, TailwindCSS `dark:` classes.
  - verify: `cd frontend && npm run test:frontend -- --run tests/components/DarkMode.test.tsx`

### F — Mockup-fidelity implementation (Inkwell design)

> Source of truth: `mockups/archive/v1-2025-11/design/*.jsx` (component reference), `mockups/archive/v1-2025-11/design/styles.css` (full token set), `mockups/archive/v1-2025-11/screenshots/*.png` (visual reference). The README in that folder is the spec. F22–F49 recreate this faithfully; they do NOT replace F1–F21 — they build on top of them.

- [x] **[F22]** Install Zustand + TanStack Query. Scaffold `src/store/` with typed slices: `session`, `activeStoryId`, `activeChapterId`, `sidebarTab`, `selection` (`{ text, range, rect } | null`), `inlineAIResult` (`{ action, text, status, output } | null`), `attachedSelection` (`{ text, chapter } | null`), `model`, `params` (temp/top_p/max/freqPenalty), `tweaks` (theme/layout/proseFont).
  - verify: `cd frontend && npm run test:frontend -- --run tests/store/`

- [x] **[F23]** Port design tokens from `mockups/archive/v1-2025-11/design/styles.css` into Tailwind theme: colors, spacing scale, radii (`--radius` 3px, `--radius-lg` 6px), shadows (`--shadow-card`, `--shadow-pop`), fonts (`--serif`, `--sans`, `--mono`). Implement three themes (`paper` default, `sepia`, `dark`) via `data-theme` attribute on `<html>`, exposed as CSS custom properties.
  - verify: `cd frontend && npm run test:frontend -- --run tests/theme.test.tsx`

- [x] **[F24]** Auth screen mockup redesign (replaces plain form from [F4] visually; logic reused): two-column `1fr 1fr` grid. Left hero (bg `--bg-sunken`, 36/44 padding, radial gradient) — brand lockup (feather + italic "Inkwell" 22px) + serif italic pull quote (22/1.5, max-width 440px) + mono metadata footer. Right form (360px card) — serif 28/500 title, 13px `--ink-3` subtitle, `.auth-field` rows (label 12/500 + optional 11px hint + `.text-input` 8/10 padding 13.5px). Password field eye-toggle. Submit with 600ms spinner. Mode switch link. Shield-icon footer. Sub-720px: single column, hide hero.
  - verify: `cd frontend && npm run test:frontend -- --run tests/pages/auth-design.test.tsx`

- [x] **[F25]** App shell: CSS grid `grid-template-columns: 260px 1fr 360px; grid-template-rows: 44px 1fr; grid-template-areas: "topbar topbar topbar" "sidebar editor chat"`. Three `data-layout` variants on root: `""`/`three-col` (full), `nochat` (`260px 1fr 0`), `focus` (`0 1fr 0`). Focus toggle via top-bar button + keyboard shortcut.
  - verify: `cd frontend && npm run test:frontend -- --run tests/components/AppShell.test.tsx`

- [x] **[F26]** Top bar (44px, `border-bottom: 1px solid var(--line)`, padding `0 14px`, `gap: 16px`): brand cell with right border (244px min-width) · centre breadcrumbs `Story / Ch N / Chapter title` with `--ink-5` separators · right group with save indicator (green dot + "Saved · 12s ago") + word count (mono 12px) + History / Focus / Settings icon buttons + 26px initial-avatar opening 220px user menu (name + `@username` mono header; Settings / Your stories / Account & privacy / divider / Sign out in `--danger`).
  - verify: `cd frontend && npm run test:frontend -- --run tests/components/TopBar.test.tsx`

- [x] **[F27]** Sidebar (260px, `border-right: 1px solid var(--line)`): story-picker header (book icon + story title + chevron — clickable, opens [F30]) with plus button, Chapters/Cast/Outline tab row (1px bottom accent on active), scrollable tab body, story progress footer (`X / Y words · Z%` + 2px linear progress bar).
  - verify: `cd frontend && npm run test:frontend -- --run tests/components/Sidebar.test.tsx`

- [x] **[F28]** Cast sidebar tab: Principal (first 2 characters) + Supporting (rest) sections with 11px uppercase `.08em` tracking `--ink-4` headers. `.char-card`: 28px colored circular avatar with serif-italic `initial`, name (13/500), role + age (11px `--ink-4`). Click avatar → opens Character Popover ([F37]) anchored to avatar.
  - verify: `cd frontend && npm run test:frontend -- --run tests/components/CastTab.test.tsx`

- [x] **[F29]** Outline sidebar tab: Story Arc section. `.outline-item` rows with 6px left bullet (left 12, top 12). States: `done` (green), `current` (black + 3px halo ring), default (`--ink-5`). dnd-kit drag-reorder wired to [B8] reorder endpoint with optimistic update + revert-on-failure.
  - verify: `cd frontend && npm run test:frontend -- --run tests/components/OutlineTab.test.tsx`

- [x] **[F30]** Story Picker modal (480px): story rows — 34×44 serif-italic initial tile + title (serif 15px) + mono metadata `genre · X / Y`. Active row: "open" pill + `border: 1px solid var(--ink)`. Footer: "N stories in vault" + Import .docx button + New story primary button.
  - verify: `cd frontend && npm run test:frontend -- --run tests/components/StoryPicker.test.tsx`

- [x] **[F31]** Editor format bar (40px, padding `6px 24px`): groups separated by 1px dividers. 28×28 `.fb-btn` icon buttons. Groups in order: Undo/Redo · Style selector (Body pill with chevron, serif) · Bold/Italic/Underline/Strike · H1/H2/Quote · Bullet/Ordered list · Link/Highlight · spacer · Find/Focus. Wired to TipTap marks/nodes; `.active` reflects real editor state.
  - verify: `cd frontend && npm run test:frontend -- --run tests/components/FormatBar.test.tsx`

- [x] **[F32]** Paper editor layout: `max-width: 720px` centered, top padding 48, side padding 80, bottom padding 240. Document title serif 28/600. Sub row: uppercase tracking `.04em` mono-feel — genre · "Draft N" · word count · status chip. Chapter heading serif italic 22, `margin-top: 48px`, right-aligned sans `§ NN` label, 1px bottom border. Prose: `var(--serif)` 18px, line-height 1.7, `text-wrap: pretty`.
  - verify: `cd frontend && npm run test:frontend -- --run tests/components/Paper.test.tsx`

- [x] **[F33]** Selection bubble: document `mouseup` + `keyup` listener reads `window.getSelection()`; if non-collapsed and inside the prose region, positions a dark pill (bg `--ink`, text `--bg`, 4px padding, `0 6px 18px rgba(0,0,0,.22)` shadow) 44px above selection rect, centered horizontally, clamped to paper area. Hides on: collapsed selection, selection outside prose, scroll, Escape. `onMouseDown: preventDefault()` on the bubble itself so clicks don't clear selection. Four actions (Rewrite / Describe / Expand · thin divider · Ask AI).
  - verify: `cd frontend && npm run test:frontend -- --run tests/components/SelectionBubble.test.tsx`

- [x] **[F34]** Inline AI result card (below prose): wraps selection as serif italic quote with left border. Thinking state: three bouncing `.think-dot`s with 0 / .15 / .3s stagger, 1s `think` keyframe. Streams tokens from `POST /api/ai/complete` SSE into the card, replacing thinking with live serif 16px output. Action row: Replace (diff-replaces selection in TipTap), Insert after (appends after selection), Retry (regenerates), spacer, Discard (dismisses card).
  - verify: `cd frontend && npm run test:frontend -- --run tests/components/InlineAIResult.test.tsx`

- [x] **[F35]** Continue-writing affordance: dashed `var(--ai)` (muted purple) pill "Continue writing" + mono hint "⌥↵ generates ~80 words in your voice". On click or ⌥+Enter: calls `/api/ai/complete` with `continue` action + cursor context; renders streaming output inline as `<span class="ai-continuation">` (purple tinted). Summary bar: Keep (commits span as normal prose) / Retry / Discard.
  - verify: `cd frontend && npm run test:frontend -- --run tests/components/ContinueWriting.test.tsx`

- [x] **[F36]** Character reference TipTap extension: custom mark `charRef` with attr `characterId`. Renders as a span with 1px dotted underline in `var(--ink-5)` and `cursor: help`. `mouseenter` opens Character Popover ([F37]) anchored below the word. Persists in `chapters.bodyJson`; no separate table.
  - verify: `cd frontend && npm run test:frontend -- --run tests/components/CharRefMark.test.tsx`

- [x] **[F37]** Character Popover (280px absolute): serif name (16px) + uppercase role / age caption. Three fields — Appearance / Voice / Arc — each with mono uppercase caption and serif value. Footer buttons: Edit (opens character sheet) · Consistency check (calls [X8] when available, otherwise hidden). Used from sidebar Cast tab ([F28]) and from `.char-ref` hover in prose ([F36]).
  - verify: `cd frontend && npm run test:frontend -- --run tests/components/CharacterPopover.test.tsx`

- [x] **[F38]** Chat panel (360px, `border-left: 1px solid var(--line)`): header (40px) with Chat/History pill tabs (active uses `--accent-soft`) + New chat + Settings icon buttons. Model bar (bg `--bg-sunken`, 10/14 padding): row 1 "MODEL" 10px uppercase `.08em` label + model picker button (18×18 black "V" venice mark + mono model name + `.ctx-chip` e.g. `32k` + chevron — opens [F42]); row 2 mono params `temp 0.85  top_p 0.95  max 800` + right-aligned `70B · Dolphin 2.9.2`. Scrollable body. Composer anchored bottom. Placeholder [F12] superseded by this.
  - verify: `cd frontend && npm run test:frontend -- --run tests/components/ChatPanel.test.tsx`

- [x] **[F39]** Chat messages: user — sans 13px, `--accent-soft` pill bubble, 8/12 padding, `--radius-lg`. Assistant — serif 13.5/1.55, no background, 2px left border in `--ai`; meta row below with Copy / Regenerate / `412 tok · 1.8s`. Attachment previews above user bubble: serif italic quote with mono "FROM CH. N" caption + left border. Suggestion chips (8/10 sans 12.5px with icon + label). Dashed context chip at end (mono 11px: `"Chapter 3 · 4 characters · 2.4k tokens attached to context"`).
  - verify: `cd frontend && npm run test:frontend -- --run tests/components/ChatMessages.test.tsx`

- [x] **[F40]** Chat composer: auto-grow textarea (max 120px). When `attachedSelection` is set: render attachment preview block above the textarea (paperclip icon + mono "ATTACHED FROM CH. N" caption + 2-line-clamped serif italic quote + X to clear). Send button 28×28 black square with arrow-up icon (disabled when input empty AND no attachment). Below input: mode tabs (Ask / Rewrite / Describe — sans 11px; active `--accent-soft`) + right-aligned "⌘↵ send" hint. `Cmd/Ctrl+Enter` submits.
  - verify: `cd frontend && npm run test:frontend -- --run tests/components/ChatComposer.test.tsx`

- [x] **[F41]** Ask-AI flow: selection bubble "Ask AI" writes `attachedSelection` into Zustand, auto-opens chat panel (layout → `three-col` if in `nochat`), pre-fills composer with "Help me with this passage — ", focuses composer, clears prose selection.
  - verify: `cd frontend && npm run test:frontend -- --run tests/flows/ask-ai.test.tsx`

- [x] **[F42]** Model Picker modal (480px): radio-card list — name, params, ctx, speed, notes (same card component as Settings → Models tab). Selected card: `border-color: var(--ink)`. Click selects and closes. Shared component between chat-panel model bar trigger ([F38]) and Settings → Models ([F44]).
  - verify: `cd frontend && npm run test:frontend -- --run tests/components/ModelPicker.test.tsx`

- [x] **[F43]** Settings modal (720px centered) shell + Venice tab: backdrop `rgba(20,18,12,.4)` with 3px blur. Header: "Settings" serif 18/500 + sub "Configure Venice.ai integration, writing preferences, and self-hosting" + close X. Horizontal tab nav (1px bottom accent on active): Venice / Models / Writing / Appearance. **No self-hosting tab** (removed per stakeholder direction; env-file configured externally). Footer: mono "Changes save automatically to your local vault" hint + Cancel + Done primary. Venice tab fields: API key (password input + eye toggle + "Verified · 2.2k credits" green status pill, red pill on 401), endpoint override, organization; Feature toggles (Chat completions / Text continuation / Inline rewrite / Image generation / Character extraction / Embeddings / **Include Venice creative-writing prompt** — bound to `settings.ai.includeVeniceSystemPrompt` via [B11], default on, hint "Prepend Venice's built-in creative writing guidance on top of Inkwell's own system prompt."); Privacy toggles (request logging, send-story-context). **NB:** The API key input is only meaningful if BYOK is adopted (see conflict #2 in handoff); otherwise this tab shows the server-key health status read-only.
  - verify: `cd frontend && npm run test:frontend -- --run tests/components/Settings.shell-venice.test.tsx`

- [x] **[F44]** Settings → Models tab: radio-card model list (reuses card from [F42]) + generation parameter sliders (temperature, top_p, max_tokens, frequency_penalty with live value readout) + system prompt textarea (serif, per-story, writes to `Story.systemPrompt` via [V13] + [B2]).
  - verify: `cd frontend && npm run test:frontend -- --run tests/components/Settings.models.test.tsx`

- [x] **[F45]** Settings → Writing tab: toggles — Typewriter mode, Focus paragraph, Auto-save, Smart quotes, Em-dash expansion — plus Daily goal (words) number input. Persists via [B11].
  - verify: `cd frontend && npm run test:frontend -- --run tests/components/Settings.writing.test.tsx`

- [x] **[F46]** Settings → Appearance tab: 3-tile theme picker (Paper / Sepia / Dark with live swatch preview per README token overrides) · prose font select (Iowan Old Style / Palatino / Garamond / IBM Plex Serif) · prose size slider (14–24px) · line-height slider (1.3–2.0). Writes apply immediately via `data-theme` + CSS custom properties, persist via [B11]. Supersedes [F21] scope.
  - verify: `cd frontend && npm run test:frontend -- --run tests/components/Settings.appearance.test.tsx`

- [x] **[F47]** Keyboard shortcuts hook `useKeyboardShortcuts`: `⌘/Ctrl+Enter` sends in chat composer, `⌥+Enter` triggers continue-writing from cursor, `Escape` dismisses selection bubble / inline AI card / closes open modal. Single document-level listener, scoped callbacks registered per-component.
  - verify: `cd frontend && npm run test:frontend -- --run tests/hooks/useKeyboardShortcuts.test.tsx`

- [x] **[F48]** Autosave per mockup: 4s idle debounce on editor changes (README §Persistence). Three states in top bar indicator: "Saving…" / "Saved · Ns ago" (relative time, updates every 5s) / "Save failed — retrying in Ns". **Supersedes [F9]'s 2s debounce** — when implementing F9, use 4s. Chapter body sent as `bodyJson` (TipTap JSON) to [B10].
  - verify: `cd frontend && npm run test:frontend -- --run tests/components/Autosave-mockup.test.tsx`

- [x] **[F49]** Shared transitions: backdrop fade-in 160ms ease-out; modal content translate-y 8→0 + scale .98→1 at 180ms `cubic-bezier(.2,.9,.3,1)`; popovers + selection bubble opacity 0 + translateY 4 → 1 at 140ms ease-out; thinking dots `think` keyframe 1s ease-in-out infinite with 0/.15/.3s stagger. Implement as shared CSS classes + a `Transition` wrapper component.
  - verify: `cd frontend && npm run test:frontend -- --run tests/components/Animations.test.tsx`

- [x] **[F50]** Chat panel web-search toggle + `<MessageCitations />` — frontend half of `[V26]` (see [spec](docs/superpowers/specs/2026-04-23-v26-chat-citations-design.md)). Requires V26 to be shipped first. Two components: (1) Web-search checkbox in the chat composer (beneath the message input, next to the model picker). Wiring: when checked, the next `POST /api/chats/:chatId/messages` sends `enableWebSearch: true`; checkbox resets to unchecked after each send (per-turn, not session-wide) to prevent silently burning credits across a long conversation. Gated by `capabilities.supportsWebSearch` on the selected model (mirror `[F14]` pattern). UI hint text: "Web search — may increase response time + cost." (2) `<MessageCitations />` inline disclosure under each assistant message with a non-null `citationsJson`: a `Sources (N)` pill that expands to a card listing each citation's `title` (linked via `<a href={url} target="_blank" rel="noopener noreferrer">`), plain-text `snippet` (NEVER as HTML — this is third-party web content), and optional `publishedAt`. Hidden when `citationsJson` is null. Consumes the chat messages list from `GET /api/chats/:chatId/messages`. Must also parse the `event: citations` SSE frame during a live turn so the pill appears as soon as the frame arrives (before the content stream completes). Tests: pill hidden when null, pill count matches array length, expansion reveals all items, links open in new tab with `rel="noopener noreferrer"`, snippet rendered as plain text, toggle gated by `supportsWebSearch`, toggle resets between sends, live SSE `event: citations` frame is parsed and rendered before content completes.
  - verify: `cd frontend && npm run test:frontend -- --run tests/components/MessageCitations.test.tsx tests/components/ChatComposer.test.tsx`

### F — Page integration (mount mockup-fidelity components)

> F22–F50 shipped each component standalone with focused tests; the running app still renders the F1–F21 surfaces. F51–F58 wire the new components into `EditorPage` / `DashboardPage` so the user actually sees them. Each task is integration-only — no new component design.

- [x] **[F51]** Mount AppShell + TopBar + Sidebar in EditorPage. Replace the F7 three-pane layout with `<AppShell topbar sidebar editor chat />`. Top bar consumes `useStoryQuery(activeStoryId)` for breadcrumbs, autosave hook output for the save indicator, `useFocusToggle` for the Focus button, and routes UserMenu's `onOpenSettings` / `onOpenStoriesList` to F43 / F30 modal state. Sidebar renders `<ChapterList>` (existing F10) as `chaptersBody`, `<CastTab>` as `castBody`, `<OutlineTab>` as `outlineBody`. Story-picker header opens F30; the `+` button creates the active tab's entity (chapter / character / outline item). Active tab driven by `useSidebarTabStore`.
  - verify: `cd frontend && npm run test:frontend -- --run tests/pages/editor.test.tsx tests/pages/editor-shell.integration.test.tsx`

- [x] **[F52]** Replace `<Editor>` (F8) with `<FormatBar>` (F31) + `<Paper>` (F32) in EditorPage's editor slot. Paper consumes the active chapter from `useChapterQuery`; format bar binds to the same TipTap editor instance via `onReady`. Mount uses `formatBarExtensions` (StarterKit + Underline + Link + Highlight + AIContinuation + CharRef). FormatBar's "Find" callback opens an in-paper find UI placeholder (TODO) — Focus button still routes to `useFocusToggle`. Word count + status chip in Paper's sub-row come from chapter metadata. Existing F8 component may be deleted once no test references it.
  - verify: `cd frontend && npm run test:frontend -- --run tests/pages/editor.test.tsx tests/pages/editor-paper.integration.test.tsx`

- [x] **[F53]** Mount AI surfaces in the editor: `<SelectionBubble proseSelector=".paper-prose" onAction={...} />` at the page root, `<InlineAIResult editor={...} onRetry={...} />` below the paper, `<ContinueWriting editor={...} storyId chapterId modelId />` after the last paragraph (or wherever the cursor is at end-of-doc — pragmatic call: render at end of the paper region). Bubble's `'rewrite' | 'describe' | 'expand'` actions seed `useInlineAIResultStore` and call `useAICompletion().run` with the matching action; bubble's `'ask'` action calls `triggerAskAI(...)` (F41). Wire `onRetry` to re-run the last completion args.
  - verify: `cd frontend && npm run test:frontend -- --run tests/pages/editor-ai.integration.test.tsx`

- [x] **[F54]** Wire `<CharacterPopover>` (F37) to two anchors: (a) charRef mark hover via `useCharRefHoverDispatcher` (F36) — popover opens below the underlined word, with the 150ms anchor-leave / 200ms popover-leave grace window the F37 author deferred to the wirer; (b) Cast tab `onOpenCharacter` — popover anchored to the clicked avatar element. The character data comes from `useCharactersQuery(storyId)`. Edit footer button opens F19 character sheet modal (existing `<CharacterSheet>`); Consistency check stays hidden until [X8] ships.
  - verify: `cd frontend && npm run test:frontend -- --run tests/pages/character-popover.integration.test.tsx`

- [x] **[F55]** Mount the chat surfaces in the chat slot: `<ChatPanel messagesBody composer onOpenModelPicker onNewChat onOpenSettings />` with `<ChatMessages chatId chapterTitle attachedCharacterCount attachedTokenCount />` as messagesBody and `<ChatComposer onSend={...} />` as composer. Chat selection: derive the active chat for the active chapter via `useChatsQuery(chapterId)`; "New chat" creates a new chat via `POST /api/chapters/:id/chats`. Compose's `onSend` posts to `/api/chats/:chatId/messages` (with `enableWebSearch` from F50 + `attachment` from F41). Mount the F30 `<StoryPicker>`, F42 `<ModelPicker>`, and F43 `<Settings>` modals at the page root, opened via state flipped by the TopBar / Sidebar / ChatPanel callbacks. Replace F12 `<AIPanel>` use with this stack.
  - verify: `cd frontend && npm run test:frontend -- --run tests/pages/chat-panel.integration.test.tsx tests/pages/editor.test.tsx`

- [x] **[F56]** Replace the F9 `<AutosaveIndicator>` consumer in EditorPage with the F48 mockup version: thread `useAutosave`'s `{ status, savedAt, retryAt }` triple into the new indicator slot inside `<TopBar>` (or render it as a sibling of the breadcrumb meta group). Send chapter saves with `bodyJson` (TipTap JSON) per F48 spec — confirm the existing PATCH already routes through the F8 → Paper rewrite from F52. Delete F9's two-arg indicator API once no test references the old shape.
  - verify: `cd frontend && npm run test:frontend -- --run tests/pages/editor-autosave.integration.test.tsx tests/components/Autosave-mockup.test.tsx`

- [x] **[F57]** Migrate scattered `keydown` listeners to `useKeyboardShortcuts` (F47): replace the document-level `keydown` blocks in `<SelectionBubble>`, `<InlineAIResult>`, `<ContinueWriting>`, `<StoryPicker>`, `<ModelPicker>`, `<Settings>`, `<CharacterPopover>` with `useEscape` / `useAltEnter` / `useModEnter` registrations. Pick priorities so an open modal's Escape closes the modal first (priority 100), then popovers (50), then the selection bubble (10). Confirm Cmd/Ctrl+Enter still submits in `<ChatComposer>` — that one stays a textarea-local listener, not document-level. Delete each component's now-redundant raw listener block.
  - verify: `cd frontend && npm run test:frontend -- --run tests/hooks/useKeyboardShortcuts.test.tsx tests/components/SelectionBubble.test.tsx tests/components/InlineAIResult.test.tsx tests/components/StoryPicker.test.tsx tests/components/ModelPicker.test.tsx tests/components/Settings.shell-venice.test.tsx tests/components/CharacterPopover.test.tsx tests/components/ContinueWriting.test.tsx`

- [x] **[F58]** Refresh DashboardPage to the mockup: render the F30 `<StoryPicker>` content as the primary entry surface (open by default at `/`) instead of (or alongside) the F5 card grid. Selecting a story navigates to `/stories/:id`; New story still opens the F6 `<StoryModal>`. Apply the F49 `t-modal-in` keyframe to centred modal cards (Settings, StoryPicker, ModelPicker) — the F49 author flagged this as deferred because the keyframe's `translate(-50%, -50%)` conflicts with the existing `grid place-items-center` centring; refactor each modal's wrapper to centre via the keyframe-compatible transform so the entrance animation fires.
  - verify: `cd frontend && npm run test:frontend -- --run tests/pages/dashboard.test.tsx tests/components/StoryPicker.test.tsx`

### F — Core completion (gaps blocking a usable app)

> Surfaced by the 2026-04-25 prototype-vs-tasks audit. These are the items remaining before "core up and running" — auth-loop closure, editor-flow completeness, empty/edge states, and Settings cleanup. **Each task below requires a detailed implementation plan written before code starts** — dispatch `superpowers:writing-plans` (or run `/plan`) to produce one under `docs/superpowers/plans/<task-id>-<slug>.md`, get sign-off, then execute.
>
> Tasks tagged **[design-first]** also need a mockup committed to `mockups/archive/v1-2025-11/design/` (or an addendum file) before the implementation plan is written, since the original prototype does not show the screen.
>
> X-series extras are deliberately deferred — these tasks restrict scope to what's needed for end-to-end usability.

- [x] **[F59]** **[design-first]** Recovery-code handoff at signup. `[AU9]` returns a one-time `recoveryCode` in the registration response; today the frontend discards it. Surface it as a dedicated full-screen interstitial (or modal) immediately after `useAuth().register()` resolves, with explicit "I have stored this — continue" gating. Copy-to-clipboard + download-as-`.txt` actions; warning that the code is shown ONCE; no nav until the user confirms. Persist nothing client-side — the code lives only in the user's possession from this point on. Required prerequisite for `[F60]`. Design must mock the interstitial first.
  - verify: `cd frontend && npm run test:frontend -- --run tests/pages/recovery-code-handoff.test.tsx`

- [x] **[F60]** **[design-first]** Forgot-password / reset-with-recovery-code flow. Backend `[AU16]` accepts `{ username, recoveryCode, newPassword }` and re-wraps the DEK. Add a "Forgot password?" link on the login screen that routes to `/reset-password`; the page collects username + recovery code + new password (with confirmation). On success, navigate to `/login` with a success toast. Surface clear failure copy for the recovery-code-mismatch case (DON'T leak whether the username exists). Mock the page first — no design exists in the prototype today.
  - verify: `cd frontend && npm run test:frontend -- --run tests/pages/reset-password.test.tsx`

- [x] **[F61]** **[design-first]** Account & privacy panel. The user-menu's "Account & privacy" entry currently opens nothing. Build a tabbed (or sectioned) view exposing: change password (`[AU15]`), rotate recovery code (`[AU17]` — show the new one with the same handoff UI as `[F59]`), sign out everywhere (revoke all refresh tokens — backend may need a `[B12]` follow-up if not yet shipped), and a placeholder for "delete account" (defer wiring to `[X3]`). Reuse the `[F43]` Settings modal shell pattern. Mock the layout before implementation.
  - verify: `cd frontend && npm run test:frontend -- --run tests/components/AccountPrivacy.test.tsx`

- [x] **[F62]** **[design-first]** charRef mark authoring path. `[F36]` ships the mark + popover but nothing applies it — no popovers ever fire because no marks exist. Spec the affordance (recommended starting point: `@`-trigger autocomplete from the active story's cast, with up/down keyboard nav + Enter to insert; alternative: "Mention character…" entry in the `[F33]` selection bubble alongside Rewrite/Describe/Expand/Ask AI). Decision must be in the design before implementation. Persists into `chapters.bodyJson` via `setCharRef({ characterId })` (already exists). Visual feedback while typing (filtering the list).
  - verify: `cd frontend && npm run test:frontend -- --run tests/components/CharRefAuthoring.test.tsx`

- [x] **[F64]** **[design-first]** Empty dashboard + editor empty-state hint strip. (1) DashboardPage with zero stories renders a single bare line today — design a hero with brand mark, copy ("Your stories live here"), and a primary "New story" CTA (which opens `[F6]` StoryModal). (2) Editor with an empty chapter renders no affordances; the prototype's `editor.jsx:95-108` shows a three-row hint strip ("select text → bubble", "hover names → card", "⌥↵ → continue"). Mock both before implementation.
  - verify: `cd frontend && npm run test:frontend -- --run tests/pages/dashboard-empty.test.tsx tests/components/EditorEmptyHints.test.tsx`

- [x] **[F66]** Resolve `[F45]` smart-quotes / em-dash drift. Decision: extend `[B11]` settings JSON with `writing.smartQuotes: boolean` and `writing.emDashExpansion: boolean`, drop the localStorage shim, and wire two TipTap input rules (curly quotes on `"`/`'`, em-dash on `--`) gated by the settings. OR delete the toggles outright. Plan must capture the decision + rationale. (Auto-save toggle stays in localStorage — that's a frontend behaviour with no backend semantics.)
  - verify: `cd frontend && npm run test:frontend -- --run tests/components/Settings.writing.test.tsx tests/components/EditorInputRules.test.tsx`

- [x] **[F67]** Resolve `[F43]` feature toggles + privacy toggles dead UI. Six "Features" toggles (Chat completions / Text continuation / Inline rewrite / Image generation / Character extraction / Embeddings) and two "Privacy" toggles (request logging, send-story-context) are no-ops. Decision: simplest path is to delete them — the operator already controls feature access via deployment config, and per-user feature-flagging adds significant backend surface for marginal benefit. Alternative: extend `[B11]` with a `features` + `privacy` block and gate AI calls client-side. Plan must record the decision; default to deletion unless we can articulate a concrete user need.
  - verify: `cd frontend && npm run test:frontend -- --run tests/components/Settings.shell-venice.test.tsx`

