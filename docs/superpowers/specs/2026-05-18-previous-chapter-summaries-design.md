# Previous-Chapter Summaries as AI Prompt Context

**Status:** Draft
**Date:** 2026-05-18
**bd issue:** TBD (file after spec is approved)

## Goal

Give AI actions (`continue`, `scene`, `ask`, and any future surface that uses the prompt builder) structured context about what happened in *prior* chapters of the current story, without inflating the prompt by stuffing in full chapter bodies. Today the prompt builder only knows the current chapter — start of a new chapter is cold, and continuity bugs (forgotten plants, contradicted state, characters whose location resets) follow.

## Non-goals

- **Arc-level / multi-chapter summaries** (e.g. "Act II summary"). Future work; per-chapter is the v1 unit.
- **Auto-generation of any kind** — not on save, not on status change, not lazily before an AI call. Generation is always user-initiated to keep BYOK cost explicit. A per-story "auto-generate missing summaries on AI calls" toggle is deferred to a phase 2 (see *Out of scope*).
- **Aggregate "generate all missing" UI** (banner, batch button). With per-row state icons, individual generation is one click per chapter; the aggregate flow can come later if users actually want it.
- **Streaming the summarisation response.** Summaries are short structured JSON; a single non-streaming round-trip is simpler.
- **Storing summary revision history.** Latest version is the only version; regenerate replaces. Edits replace too.

## UX walkthrough

**Pattern: Cast popover + sheet.** The Cast feature already has the right shape for this — a 280px popover anchored to a list-row affordance ([`CharacterPopover.tsx`](frontend/src/components/CharacterPopover.tsx)) with an Edit button that opens a full editing modal ([`CharacterSheet.tsx`](frontend/src/components/CharacterSheet.tsx)). Chapter summaries reuse that pattern unchanged.

**Per-row state icon on `ChapterRow`.** A small (16×16 hit area, 10px glyph) always-visible icon sits between the chapter title button and the word count, mirroring the right-side metadata cluster. It plays two roles:

- **At-a-glance state indicator** — five icon variants:
  - **Missing** — outline circle (`ink-4`).
  - **Current** — filled circle (`ink-4`).
  - **Stale** — filled circle with a small accent-color dot top-right ("something changed since").
  - **Generating** — 10px spinner.
  - **Corrupted** — warning triangle (`danger`).
- **Popover trigger** — click opens the chapter-summary popover for that row. `e.stopPropagation()` so the click doesn't fire the row's chapter-select behaviour.

**ChapterSummaryPopover.** Mirrors `CharacterPopover`: 280px wide, `bg-bg-elevated`, `border-line`, `shadow-pop`, anchored below the icon. Dismissed by Escape or outside-click. Contents:

- **Header** — chapter title (serif 16px) + "Chapter N" caption (10px uppercase mono). Stale / corrupted state shown as an inline pill in the caption row.
- **Body** — three `FieldRow`s for Events / State at end / Open threads when summary exists (em-dash placeholder if a field is empty, matching `CharacterPopover`'s Appearance/Voice/Arc). For missing / corrupted / generating states, the body is a short prose line explaining the state.
- **Footer** — Edit + Regenerate (Current / Stale), Generate (Missing / Corrupted), Cancel (Generating). Cost estimate (`~480 tok · gpt-4o`) right-aligned in the footer for cost-incurring states only.

**ChapterSummarySheet.** Mirrors `CharacterSheet`: full modal opened via page-root state (same convention `EditorPage` uses for `CharacterSheet` and `StoryPicker`). Three text areas (Events / State at end / Open threads), Save / Cancel. Wires through the new PUT endpoint.

**Story-settings toggle.** New "Include previous-chapter summaries in AI context" toggle in `StoryModal`, default **on**. Off = the prompt builder skips the `<previous_chapters>` block entirely.

## Data model

### `Chapter` additions

```prisma
model Chapter {
  // … existing fields …

  // [pcs] Structured per-chapter summary, generated on user demand and used
  // by the prompt builder to feed prior chapters into AI context. Stored as
  // an encrypted JSON blob (matches Message.attachmentJson / citationsJson
  // precedent) so the three logical fields regen atomically and the schema
  // can evolve without a migration.
  summaryJsonCiphertext String?
  summaryJsonIv         String?
  summaryJsonAuthTag    String?
  // Set whenever summaryJsonCiphertext is (re)written. NULL means "no summary".
  // Staleness = `summaryJsonUpdatedAt < updatedAt`. False positives (a rename
  // also bumps `updatedAt`) cost a click; false negatives risk continuity
  // bugs. Conservative wins.
  summaryJsonUpdatedAt  DateTime?
}
```

### `Story` additions

```prisma
model Story {
  // … existing fields …

  // [pcs] Per-story toggle for the `<previous_chapters>` prompt block.
  // Default true. Different stories legitimately want different behaviour —
  // a serial-format story benefits from strong continuity context, a
  // vignettes collection does not.
  includePreviousChaptersInPrompt Boolean @default(true)
}
```

No new tables, no new indexes. Per the project's no-data-migration-branches rule, the migration just creates the new columns; nothing backfills.

## Shared Zod schema — `shared/src/schemas/chapter.ts`

Per the one-file-per-entity convention, `chapterSummarySchema` lives **in** `chapter.ts` alongside `chapterSchema` and `chapterMetaSchema` — not in a separate file.

```ts
export const CHAPTER_SUMMARY_FIELD_MAX = 2000; // chars; prompt budget governs in practice

/**
 * Structured per-chapter summary. The three fields are LLM-consumption-shaped,
 * not human-narrative-shaped — they map to slices the model can selectively
 * attend to when extending the next chapter. The `.describe()` strings flow
 * into the JSON Schema generated by `z.toJSONSchema()` and become the
 * per-field guidance Venice passes to the model.
 */
export const chapterSummarySchema = z.strictObject({
  events: z
    .string()
    .max(CHAPTER_SUMMARY_FIELD_MAX)
    .describe('Plot events: 1–3 sentences. What happened in this chapter.'),
  stateAtEnd: z
    .string()
    .max(CHAPTER_SUMMARY_FIELD_MAX)
    .describe('Location, possessions, who is with whom at chapter close.'),
  openThreads: z
    .string()
    .max(CHAPTER_SUMMARY_FIELD_MAX)
    .describe('Unresolved questions, planted seeds, dangling tension.'),
});

export type ChapterSummary = z.infer<typeof chapterSummarySchema>;
```

**`chapterSchema` (detail) extends** with `summary: chapterSummarySchema.nullable()` and `summaryUpdatedAt: z.string().datetime().nullable()`.

**`chapterMetaSchema` (list) extends** with two cheap booleans derived pre-decryption:
- `hasSummary: z.boolean()` — `summaryJsonCiphertext != null`. "A blob exists on disk." Does *not* claim the blob is usable.
- `summaryIsStale: z.boolean()` — `summaryJsonUpdatedAt != null && summaryJsonUpdatedAt < updatedAt`.

The list-vs-detail decrypt-failure dichotomy is intentional (see Repo layer below).

**`storyCreateSchema` extends** with `includePreviousChaptersInPrompt: z.boolean().optional()`. Default lives on the DB column (`@default(true)`), not the Zod schema, so omitted-on-create still produces the right row. `storyUpdateSchema = storyCreateSchema.partial()` picks it up automatically.

## Repo-layer changes — `backend/src/repos/chapter.repo.ts`

**`CHAPTER_ENCRYPTED_FIELD_KEYS`** gains `'summaryJson'`. This is the actual wiring point: `writeEncrypted` / `projectDecrypted` look at this list to know which fields to round-trip through encryption.

**New methods:**

- `updateSummary(chapterId: string, summary: ChapterSummary): Promise<RepoChapter>` — `JSON.stringify(summary)`, encrypts the string, writes the `summaryJson*` triple + sets `summaryJsonUpdatedAt = now()`. Returns the decrypted chapter.
- `clearSummary(chapterId: string): Promise<RepoChapter>` — nulls all four columns. Not surfaced in v1 UI; included because the symmetric method makes the repo easier to test and a future "discard summary" affordance trivial.
- `findManyForStoryWithSummaries(storyId: string): Promise<Array<{ id: string; orderIndex: number; title: string; summary: ChapterSummary | null; summaryUpdatedAt: Date | null }>>` — list of prior-chapter context for prompt assembly. Decrypts `title` and `summaryJson*` only (skips body) in a single transaction. Used by `/api/ai/complete` and chat routes when `story.includePreviousChaptersInPrompt` is true. Per-chapter `findById` calls would also work but cost N round-trips and N decrypt setups.

**Modified methods:**

- `findById` — decrypts `summaryJson*` when present, `JSON.parse`, `chapterSummarySchema.parse`. Returns `summary: ChapterSummary | null` and `summaryUpdatedAt: Date | null` on the decrypted shape.
- `findManyForStory` — derives `hasSummary` and `summaryIsStale` from the raw row (no decrypt). Does *not* decrypt summaries for list responses; the body decrypt isn't done for list either (existing pattern).

**Decrypt-failure handling (list-vs-detail dichotomy):** the list flag `hasSummary` is a fact about persistence; the detail field `summary` is a fact about decryptability. They can disagree when a stored blob fails to decrypt or schema-parse — list says `hasSummary: true`, detail returns `summary: null`. The frontend treats `(hasSummary && summary === null)` as the **Corrupted** state — surfaced in the popover with a Regenerate affordance. This avoids decrypting on every list call (perf cost on the hot read path) at the price of a slightly-lying list flag, mitigated by the explicit Corrupted state. Detail-path decrypt failure logs one warn-level line and returns `null`; it never throws (chapter itself is still usable).

## Prompt builder changes — `backend/src/services/prompt.service.ts`

**New input field on `BuildPromptInput`:**

```ts
/**
 * Prior chapters in `orderIndex` ascending order. Caller filters out chapters
 * with no summary, and sorts. If empty/undefined, the `<previous_chapters>`
 * block is omitted entirely.
 */
previousChapters?: Array<{
  orderIndex: number;
  title: string;
  summary: ChapterSummary;
}>;
```

**New render block, inserted between `<characters>` and `<chapter_so_far>`** (chronological: static world → past events → present):

```xml
<previous_chapters>
  <chapter index="1" title="The Crossing">
    <events>…</events>
    <state_at_end>…</state_at_end>
    <open_threads>…</open_threads>
  </chapter>
  <chapter index="2" title="…">
    …
  </chapter>
</previous_chapters>
```

Indexes are 1-based (`orderIndex + 1`). Title and field bodies escape via existing `escapeXmlAttr` / `escapeXmlText`.

**Token-budget rule: current chapter wins.** Summaries join `fixedTokens` (same accounting as worldNotes, characters, task). If `chapterBudgetTokens` ([prompt.service.ts:251](backend/src/services/prompt.service.ts#L251)) goes `<= 0`, drop summary entries oldest-first (lowest `orderIndex`) and recompute, repeating until either the chapter fits or all summaries are gone. No new floor constant — falls through to the existing behaviour (`chapterText = ''`, block omitted) if even zero summaries can't make room. The current chapter always takes priority over historical context — it's the thing the model is acting on.

When entries are dropped under budget pressure, the block is rendered with a marker so the model knows context is incomplete:

```xml
<previous_chapters truncated_count="3">
  …surviving entries…
</previous_chapters>
```

**Insertion order** in the system message becomes: `systemContent → worldNotesBlock → charactersBlock → previousChaptersBlock → chapterBlock → taskBlock`.

## Route changes

### `POST /api/chapters/:id/summarise` (new)

Calls Venice to summarise a single chapter and persists the result. Non-streaming.

- **Auth:** `requireAuth` + ownership check via `createChapterRepo(req).findById(id)`.
- **Validation:** body shape `{ modelId: string }`. The chapter is loaded via repo (decrypts body). If body is empty (zero word count), return 400 `{ error: "empty_chapter" }` — nothing to summarise.
- **Capability precheck:** `veniceModelsService` is extended to surface `supportsResponseSchema` (already in Venice's `/models` `capabilities` object — see [Venice docs](https://docs.venice.ai/overview/guides/structured-responses)). Touches three places in [`backend/src/services/venice.models.service.ts`](backend/src/services/venice.models.service.ts):
  1. `VeniceRawCapabilities` ([:48-52](backend/src/services/venice.models.service.ts#L48-L52)) — add `supportsResponseSchema?: boolean`.
  2. `ModelInfo` ([:18-30](backend/src/services/venice.models.service.ts#L18-L30)) — add `supportsResponseSchema: boolean`.
  3. `mapModel()` ([:76-121](backend/src/services/venice.models.service.ts#L76-L121)) — add `supportsResponseSchema: Boolean(caps.supportsResponseSchema)`.

  If `model.supportsResponseSchema === false`, return 400 `{ error: "model_unsupported_for_summarisation" }`. The frontend surfaces this as "This model doesn't support structured output — switch to a schema-capable model."
- **Venice call:** uses the user's BYOK Venice client via existing `getVeniceClient(userId)` from [`backend/src/lib/venice.ts`](backend/src/lib/venice.ts). Inline `chat.completions.create` in the route handler (mirrors the existing pattern in `ai.routes.ts` / `chat.routes.ts`; no new `ai.service.ts` module). Payload:
  ```ts
  response_format: {
    type: 'json_schema',
    json_schema: {
      name: 'ChapterSummary',
      schema: z.toJSONSchema(chapterSummarySchema), // derived; no hand-rolled mirror
      strict: true,
    },
  }
  ```
  `z.strictObject` ensures `additionalProperties: false` in the emitted JSON Schema, which is what OpenAI-compatible structured output requires.
- **Persist:** parse with `chapterSummarySchema.parse(JSON.parse(content))`. On parse failure (theoretically impossible with `strict: true` but possible if Venice/the model violates the contract), return 502 `{ error: "summary_parse_failed" }`. On success: `chapterRepo.updateSummary(chapterId, parsed)`.
- **Response:** `{ summary: ChapterSummary, summaryUpdatedAt: string }`. Frontend invalidates chapter detail + chapter list cache keys.

Lives in **`backend/src/routes/chapters.routes.ts`** (chapter-scoped, mutates a chapter). Summarisation prompt template (system message guiding the model toward the schema) lives in **`backend/src/services/prompt.service.ts`** alongside other templates.

### `PUT /api/chapters/:id/summary` (new)

User-edited summary. Body validated against `chapterSummarySchema`. Calls `chapterRepo.updateSummary`. Returns `{ summary, summaryUpdatedAt }`.

### `POST /api/ai/complete` + `POST /api/chat/...` (modified)

Step between "Load characters" and "Build prompt": load prior-chapter summaries.

```ts
let previousChapters: BuildPromptInput['previousChapters'] = undefined;
if (story.includePreviousChaptersInPrompt) {
  const rows = await createChapterRepo(req).findManyForStoryWithSummaries(body.storyId);
  previousChapters = rows
    .filter((c) => c.orderIndex < chapter.orderIndex && c.summary != null)
    .sort((a, b) => a.orderIndex - b.orderIndex)
    .map((c) => ({ orderIndex: c.orderIndex, title: c.title, summary: c.summary! }));
}
```

Uses the new `findManyForStoryWithSummaries` repo method (one transaction, decrypts only title + summary columns — skips body which is not needed here). Then passes `previousChapters` into `buildPrompt(...)`. Same change in both `ai.routes.ts` (`/complete`) and `chat.routes.ts` (chat messages).

### `PATCH /api/stories/:id` (modified)

Accepts the new `includePreviousChaptersInPrompt` field via `storyUpdateSchema` (auto-derives from the updated `storyCreateSchema`).

## Frontend changes

**Hook:** `useChapterSummary(chapterId)` — wraps `useQuery` against the chapter detail endpoint. Exposes `summary`, `summaryUpdatedAt`, `state: SummaryState` (derived: `'missing' | 'current' | 'stale' | 'corrupted'`), and two mutations: `{ summarise, edit }`. `summarise` hits `POST /api/chapters/:id/summarise` for both initial generation and regeneration — same endpoint, same payload; the button label ("Generate" vs "Regenerate") is purely cosmetic and lives in the popover, not in the hook. `edit` hits `PUT /api/chapters/:id/summary` with user-edited fields. Both invalidate chapter detail + chapter list on success.

**New components:**

- **`<SummaryStateIcon state onClick ariaPressed />`** — the per-row icon described in the UX walkthrough. Rendered in `ChapterRow` between the title button and word count. Single Tailwind file; SVG icons inline.
- **`<ChapterSummaryPopover chapter anchorEl onClose />`** — mirrors `CharacterPopover`. Hand-rolled positioning (no `@floating-ui/*` dependency exists in the project), Escape + outside-click dismiss, viewport-clamp. Five render branches by state.

  **Two small extractions to support reuse**, since `CharacterPopover` and `ChapterSummaryPopover` are now obvious duplicate consumers:

  - Extract the **`computePosition`** helper currently inline at [`CharacterPopover.tsx:59-73`](frontend/src/components/CharacterPopover.tsx#L59-L73) to a shared module (`frontend/src/lib/popover-position.ts` or similar). Migrate `CharacterPopover` to import it in the same change so duplication doesn't persist. `SelectionBubble` / `CharRefMenu` use related-but-not-identical positioning logic — leave those alone (out of scope; risk-free refactor for another task).
  - Extract the **`FieldRow`** component currently inline at [`CharacterPopover.tsx:75-88`](frontend/src/components/CharacterPopover.tsx#L75-L88) to a small primitive (e.g. `frontend/src/design/primitives.tsx` alongside `Spinner`). Migrate `CharacterPopover` to import it. Two named consumers immediately = not a premature abstraction.

- **`<ChapterSummarySheet chapterId open onClose />`** — mirrors `CharacterSheet`. Modal with three text areas, Save / Cancel, Zod-validated submit.

**`ChapterRow` modified** to render `<SummaryStateIcon>` between the title button and the word count, and to surface an `onOpenSummary(chapterId, anchorEl)` callback up to `ChapterList` (lifted to `EditorPage`, same pattern as `onSelectChapter`). The icon sits in the same right-side metadata cluster as the word count, with `flex-shrink-0` so the title still gets the elastic width. When the row's `InlineConfirm` is open ([`ChapterList.tsx:152-161`](frontend/src/components/ChapterList.tsx#L152-L161)), the summary icon **hides along with the word count and delete button** — InlineConfirm is a focused destructive action and clean visual focus matches user intent. The icon reappears when the confirm dismisses.

**`EditorPage` modified** to mount `<ChapterSummaryPopover>` and `<ChapterSummarySheet>` at page root (same convention as `<CharacterSheet>`, `<StoryPicker>`, `<AccountPrivacyModal>`). State: one `summaryPopoverState: { chapterId, anchorEl } | null`, one `summarySheetChapterId: string | null`.

**`StoryModal` modified** to add the `includePreviousChaptersInPrompt` toggle alongside existing fields (title / genre / synopsis / worldNotes).

All new UI uses existing tokens from `frontend/src/index.css` — no new `--ink-*` / `--bg-*` additions. `lint:design` gate covers this.

A design-mockup story exists at [`frontend/src/components/ChapterSummaryPopover.stories.tsx`](frontend/src/components/ChapterSummaryPopover.stories.tsx) — **committed alongside this spec** as the design artifact the spec references. The implementer **overwrites** it (same path) with a real `*.stories.tsx` against the production `ChapterSummaryPopover` component during implementation; the production file replaces the mockup file 1:1.

## Encryption / leak considerations

The summary is decrypted narrative content. Same rules apply:

- Plaintext summary content MUST NOT appear in production logs, error responses outside the owning user's GET, telemetry. Dev-mode allowance still applies (decrypted narrative MAY appear in dev logs).
- The Venice round-trip for `summarise-chapter` MUST go through `getVeniceClient(userId)` (no shared client). The BYOK key never appears in logs or error payloads — `[AU13]` invariant.
- `security-reviewer` automatic-invoke: **not required** (no auth/key/crypto-primitive surface changes).
- `repo-boundary-reviewer` automatic-invoke: **required**. New encrypted columns on `Chapter`, new repo methods, new routes round-tripping plaintext summaries.
- `[E12]` leak test extension: add the sentinel string to a chapter summary, run a prompt build, assert sentinel does not appear in production-mode logs or non-owner responses.

## Testing

**Unit — `prompt.service`:**
- `<previous_chapters>` block renders correctly with 0 / 1 / N entries.
- Block is omitted when `previousChapters` is undefined or empty.
- XML escaping handles `<` / `>` / `&` in `events` / `stateAtEnd` / `openThreads`.
- Drop-summaries-oldest-first rule: when `fixedTokens` makes `chapterBudgetTokens` go ≤ 0, oldest summaries drop first; `truncated_count` attribute reflects the drop count; chapter budget recovers per drop.
- Insertion order: `previous_chapters` sits between `characters` and `chapter_so_far`.

**Unit — `chapter.repo`:**
- `updateSummary` encrypts JSON, sets timestamp, returns decrypted shape.
- `findById` round-trips a summary through encrypt → decrypt → schema parse.
- Decrypt failure on a corrupted blob returns `summary: null`, logs a warning, does not throw.
- `findManyForStory` derives `hasSummary` / `summaryIsStale` from raw row without decrypting bodies or summaries.
- `clearSummary` nulls all four columns.

**Unit — shared:**
- `chapterSummarySchema` `.parse()` on valid + invalid shapes.
- `z.toJSONSchema(chapterSummarySchema)` produces the OpenAI-style shape (`type: 'object'`, `additionalProperties: false`, `required: ['events', 'stateAtEnd', 'openThreads']`, `properties.*.description` populated).

**Integration — `POST /api/chapters/:id/summarise`:**
- Happy path: mock Venice returns valid JSON, summary persists, response shape matches.
- Empty chapter → 400 `empty_chapter`.
- Model lacks `supportsResponseSchema` → 400 `model_unsupported_for_summarisation` (no Venice call made).
- Venice returns malformed JSON → 502 `summary_parse_failed`.
- Non-owner caller → 404 (existing ownership middleware).
- No Venice key → 409 (existing pattern).

**Integration — `PUT /api/chapters/:id/summary`:**
- Happy path persists user edit.
- Invalid shape → 400 (validateBody middleware).
- Non-owner → 404.

**Integration — `POST /api/ai/complete`:**
- `story.includePreviousChaptersInPrompt = true` + N prior chapters with summaries: system message contains the `<previous_chapters>` block with the expected entries.
- Toggle off: block absent.
- Chapters without summaries are silently excluded.

**Frontend (vitest):**
- `useChapterSummary` derives the right `state` for each combination of `hasSummary` / `summaryIsStale` / detail-summary-null. **Explicit case:** `(hasSummary === true && detail.summary === null) → state === 'corrupted'` — this is the only path that produces the Corrupted UI state in normal operation (tampered ciphertext is hard to reach in a real test), so it gets its own named assertion.
- `<SummaryStateIcon>` renders the right glyph per state; click fires `onClick`; `e.stopPropagation()` is in place (click on icon does not bubble to the row's chapter-select).
- `<ChapterSummaryPopover>` renders the right body / footer per state; Edit fires `onOpenSheet`; Regenerate fires the `summarise` mutation (same as the Generate button — verifies the cosmetic-label, single-mutation design); Escape and outside-click dismiss.
- `<ChapterSummarySheet>` submits the three fields, invalidates the right query keys.
- `<ChapterRow>` hides `<SummaryStateIcon>` when `InlineConfirm` is open (matches the existing behaviour of word count + delete button).

**Encryption leak — `[E12]` extension:** sentinel-in-summary as described above.

## Open question deferred to implementation

- **Which model summarises by default?** The summarisation endpoint takes `modelId` in the body. The frontend passes the user's currently-selected chat model. If that model doesn't support `response_format` (the precheck returns 400), the popover shows the error inline ("This model doesn't support structured output — switch to a schema-capable model"). Future enhancement: per-story "summarisation model" override.

## Out of scope (deferred, not rejected)

- **Banner / Generate-all batch UI.** With per-row icons, individual generation is one click per chapter. Revisit if users want batching.
- **Lazy auto-generation on AI calls.** Backend silently generates missing summaries before running an AI action. Pro: zero friction. Con: surprise spend + surprise latency. A per-story toggle (default off) is the right shape if we ever add it.
- **Tiered context:** previous chapter in full + earlier chapters as summaries. Easy phase 2 on top of this.
- **Arc-level summaries:** groups of chapters rolled up. Needs an "arc" entity first.
- **Character-beats field:** fourth summary field for per-character emotional/relational shifts. `chapterSummarySchema` accommodates additions without schema migration (just bump the Zod shape and `z.toJSONSchema` re-emits) — wait for evidence three fields aren't enough.
- **Auto-summarisation on status change.** "When chapter status → final, queue a job." Needs a job queue (not in the stack) plus explicit user-cost UX.
- **Summary diffing on regenerate.** Show what changed. Nice-to-have, not load-bearing.
