# Prompt-builder XML structure (system-message section tagging)

**Status:** draft 2026-05-10
**Predecessor:** docs/superpowers/specs/2026-05-10-k1r-prompt-building-unification-design.md (canonical message-array shape; this spec sits on top of the unified shape from k1r).

## Goal

Replace the implicit `Header:` / `\n\n` section delimiters in the prompt builder's system-message content with explicit XML tags, so section boundaries (world notes, characters, chapter body, task) and per-character boundaries are unambiguous to any model Venice routes to. Drop the 120-character cap on the character `keyTraits` field while leaving every other character-sheet projection rule untouched. Eliminate the byte-for-byte duplicated character mapping in `ai.routes.ts` and `chat.routes.ts` by extracting it into the (already-pure) prompt service.

## Non-goals

- **No character-sheet schema change.** The four trait fields (`personality`, `arc`, `appearance`, `voice`), their concatenation order, and the `; ` separator stay exactly as they are. Only the 120-char cap is removed.
- **No semantic enrichment** (no voice samples, no tells & tics, no relationship blocks, no scene-scoped character selection). Those are larger downstream work, not this spec.
- **No DB / migration / repo-layer change.** The decrypted character record reaching the route is unchanged; only the route-side projection moves.
- **No change to the message-array shape from k1r.** System message still carries context, user message still carries only what the user contributed.
- **No per-action template rewrites** beyond the targeted edits called out in §6 and §7 (system-prompt clause addition; strip the leading `Task:` prefix from action templates now that `<task>` provides structural marking). Per-action template *wording* is otherwise untouched.
- **No env / dependency / config changes.**

## Motivation

Today the system-message content is assembled by joining labeled blocks with `\n\n` ([backend/src/services/prompt.service.ts:226-232](../../../backend/src/services/prompt.service.ts#L226-L232)):

```
You are an expert creative-writing assistant. …

World notes:
{worldNotes}

Characters:
- Imogen Thorne (protagonist): wry; cynic to believer; clipped
- Felix (rival): charming
- Bystander

Chapter so far:
{chapter prose}

Task: continue the story…
```

This relies on the model inferring section boundaries from headers + blank lines. The inference is fragile in three places:

1. **Chapter prose** is unrestricted user content. Scene breaks, dialogue, paragraph structure, and the occasional Markdown-ish symbol all live inside `Chapter so far:`. The model has to guess where the chapter ends and `Task:` begins from a single trailing `\n\n`.
2. **World notes** is unrestricted user text. Long world notes with paragraphs interact identically.
3. **Character lines** are single-line today only because the route-side mapper hard-truncates `keyTraits` at 120 chars. Dropping that cap (this spec) lets a single character span hundreds of chars, including embedded `; `s, and brings character-line boundaries into the same inference-fragile territory as the others.

Per-character delimiters are the most immediate need: removing the 120-char cap without adding `<character>` boundaries makes the "where does this character end" inference materially worse.

**Why XML specifically.** Three alternatives were considered and rejected:
- **Markdown headers** (`## World Notes`) — no closing form. Same fragility class as today's `Header:\n…` once content can contain `##` (which it can: stories quote text that uses Markdown, world notes can be Markdown-formatted by the author).
- **Custom delimiters** (`=== WORLD NOTES ===` / `<<<chapter>>>`) — non-standard; models lack strong priors and the closing form is invented per-project.
- **Code fences** (`` ``` ``) — semantically reserved for code in most model training data; content inside is sometimes treated as opaque/literal, defeating the point.

XML wins on three measurable axes: Anthropic's prompt-engineering guidance explicitly recommends it; open-weight models (Llama / Mistral / DeepSeek / Qwen — the families Venice routes to) are widely trained on XML-bearing data and handle attributes + nested tags cleanly; and entity-escape is uniformly safe with a closed grammar (`& < > "`). **CDATA** (`<![CDATA[…]]>`) was also considered but rejected: it has its own `]]>` collision, isn't reliably handled across open-weight models, and offers no token-cost advantage over entity escaping.

The duplication in `ai.routes.ts` and `chat.routes.ts` (15 lines each, semantically identical aside from one stray `// Condense traits:` comment in `ai.routes.ts:126`, see [ai.routes.ts:123-138](../../../backend/src/routes/ai.routes.ts#L123-L138) and [chat.routes.ts:384-398](../../../backend/src/routes/chat.routes.ts#L384-L398)) is a natural by-catch. The cap change has to touch both copies anyway; consolidating once is cheaper than fixing in two places. The stray comment is dropped on extraction (the helper is small enough not to need it).

## Target shape

After this spec the system-message content becomes:

```
You are an expert creative-writing assistant. …

<world_notes>
{escaped worldNotes}
</world_notes>

<characters>
<character name="Imogen Thorne" role="protagonist">wry; cynic to believer; clipped phrasing slips through when she's tired; auburn hair, gloved</character>
<character name="Felix" role="rival">charming, vain</character>
<character name="Bystander" />
</characters>

<chapter_so_far>
{escaped chapter prose}
</chapter_so_far>

<task>
continue the story from where the selection ends, matching the established voice. Aim for roughly 80–150 words.
</task>
```

The system prompt intro (`DEFAULT_PROMPTS.system` resolved value) stays unwrapped at the top — role:system at the message level already provides that boundary, and wrapping system content in a `<system>` tag is redundant.

The user-message body is unchanged. It is a separate role and carries no XML wrapper; user-supplied text inside it does not need XML-escaping for our purposes.

## Component-level changes

### 1. New rendering helpers in `prompt.service.ts`

Add two small string helpers, kept private to the module (not exported):

```ts
function escapeXmlText(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function escapeXmlAttr(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
```

Used wherever decrypted user content is interpolated into XML — character `name` (attr), `role` (attr), `keyTraits` (text), `worldNotes` (text), chapter prose (text). The user-message body bypasses these.

**Escape semantics: input is plaintext, not pre-encoded XML.** A user's chapter prose containing the literal four-character sequence `&amp;` is treated as plaintext and rendered as `&amp;amp;` (the `&` is escaped). This is the correct interpretation — we have no way to distinguish "user typed five characters: `&`, `a`, `m`, `p`, `;`" from "user intended an HTML entity," and decryption returns whatever the user wrote. The escape is therefore non-idempotent by design. A test asserts this behavior (§8).

### 2. Section-wrapping in `buildPrompt`

Rename the existing local block builders and replace their headers with tag wrappers. The current code at [prompt.service.ts:186-200](../../../backend/src/services/prompt.service.ts#L186-L200) and [prompt.service.ts:224-232](../../../backend/src/services/prompt.service.ts#L224-L232) becomes:

```ts
const worldNotesBlock =
  input.worldNotes && input.worldNotes.trimEnd().length > 0
    ? `<world_notes>\n${escapeXmlText(input.worldNotes.trimEnd())}\n</world_notes>`
    : '';

const charactersBlock =
  input.characters.length > 0
    ? `<characters>\n${input.characters.map(renderCharacterTag).filter((s) => s.length > 0).join('\n')}\n</characters>`
    : '';

// chapterBlock built later (after budget trim); same wrapper:
const chapterTrimmed = chapterText.trimEnd();
const chapterBlock =
  chapterTrimmed.length > 0
    ? `<chapter_so_far>\n${escapeXmlText(chapterTrimmed)}\n</chapter_so_far>`
    : '';

const taskBlock =
  taskTemplate.trimEnd().length > 0
    ? `<task>\n${escapeXmlText(taskTemplate.trimEnd())}\n</task>`
    : '';
```

Where `renderCharacterTag` is a new private helper:

```ts
function renderCharacterTag(c: CharacterContext): string {
  if (!c.name) return ''; // skip malformed empty-name entries entirely
  const nameAttr = ` name="${escapeXmlAttr(c.name)}"`;
  const roleAttr = c.role ? ` role="${escapeXmlAttr(c.role)}"` : '';
  if (!c.keyTraits) return `<character${nameAttr}${roleAttr} />`;
  return `<character${nameAttr}${roleAttr}>${escapeXmlText(c.keyTraits)}</character>`;
}
```

Rules:
- `name` empty string → **skip the entry entirely.** Don't render an empty-name character. The `toCharacterContext` helper (§5) can return `name: ''` when the upstream row's name is missing or non-string (malformed data); feeding the model `<character name="">` is junk, not useful context.
- `role` attribute is **omitted entirely** when `c.role` is `null` / empty. Never emit `role=""` or `role="null"`.
- `keyTraits` `null` / empty → self-closing `<character … />`. Never emit `<character></character>`.
- **No indent on inner content.** Earlier draft indented `<character>` lines two spaces inside `<characters>` but left `<world_notes>` / `<chapter_so_far>` content unindented. The asymmetry was cosmetically noisy and made indentation a special case for the character block alone. Consistent-no-indent (every wrapper's body sits flush at column 0) is simpler, matches prompt-formatting conventions in the wild, and removes the small structural-overhead cost that indents added.
- **Trailing whitespace inside wrappers is normalized.** Each wrapped body has `.trimEnd()` applied before insertion. Without this, a `worldNotes` field that happens to end with `\n` would render as `<world_notes>\n…\n\n</world_notes>` — harmless to the model but a debug-readability blemish. `.trimEnd()` only touches whitespace, so it's safe for mid-edit chapter prose ending without terminal punctuation (we never strip non-whitespace characters).
- **Identifying metadata as attributes, body as element text.** `name` and `role` go in attributes (compact, conventional XML, ~30% fewer tokens vs. nested `<name>…</name><role>…</role>`) while `keyTraits` goes as element text. The asymmetric cost is one extra escaper variant (`escapeXmlAttr` adds `"` to the entity set); the benefit is significantly shorter per-character lines and cleaner debug dumps. Worth the trade.
- **The task template IS escaped.** `taskTemplate` resolves from either `DEFAULT_PROMPTS[action]` or a user-supplied `[X29]` override. The override surface is per-user free-text — a user override containing `<` / `>` / `&` or, worst case, `</task>`, would bleed out of the `<task>` wrapper without escaping. Apostrophes are fine: `escapeXmlText` only touches `& < >`, not `'` / `"`, so `don't` round-trips intact. There is no reason to defer this — the cost is one extra function call.

The existing `systemParts.filter(p => p.length > 0).join('\n\n')` logic ([prompt.service.ts:226-232](../../../backend/src/services/prompt.service.ts#L226-L232)) stays unchanged. `taskBlock` is built with the same `length > 0` guard as the other blocks so the invariant survives any future change to `DEFAULT_PROMPTS` (e.g., an accidentally-empty default would otherwise produce `<task>\n\n</task>`). In practice the task template is never empty today; the guard is defensive.

### 3. Token-budget accounting

No code change to `estimateTokens`. The function operates on already-rendered block strings, so the tags are naturally included in the count when each block string is measured at [prompt.service.ts:205-210](../../../backend/src/services/prompt.service.ts#L205-L210).

Approximate added overhead vs. current rendering, for budget visibility:
- Outer wrappers: ~65 chars / ~17 tokens regardless of cast size.
- Per-character: ~+32 chars structural overhead per character vs. the current `- {name} ({role}): ` form (compared at the rendered-line level, including `<character name="" role="">` opener and `</character>` closer; no inner indent). Scales linearly.
- For typical casts (5-10 characters): ~55-95 tokens of added overhead. For large casts (20+): up to ~190 tokens. This comes out of `chapterBudgetTokens` ([prompt.service.ts:212](../../../backend/src/services/prompt.service.ts#L212)) — observed effect is slightly less trailing chapter prose surviving the trim. Not a regression risk for typical context lengths, and not relevant to the 512-token `SAFETY_MARGIN_TOKENS` (which exists for tokenizer-drift / upstream-rejection prevention, not as slack for tag overhead).

If large-cast token cost ever bites in practice, the right fix is scene-scoped character selection (out of scope here), not deferring this tagging change.

### 4. Drop the 120-char `keyTraits` cap

In the route-side mapping (today duplicated in [ai.routes.ts:123-138](../../../backend/src/routes/ai.routes.ts#L123-L138) and [chat.routes.ts:384-398](../../../backend/src/routes/chat.routes.ts#L384-L398)), remove:
- the early-`break` on `traitParts.join('; ').length >= 120`
- the trailing `.slice(0, 120)` on the joined string

Everything else — field order (`personality`, `arc`, `appearance`, `voice`), whitespace handling (`v.trim()`, skip if empty after trim), the `; ` separator, the final `|| null` collapse — stays exactly as written.

### 5. Extract the duplicated mapping into `prompt.service.ts`

Two new public exports added to `prompt.service.ts`:

```ts
export interface CharacterRecord {
  name?: unknown;
  role?: unknown;
  personality?: unknown;
  arc?: unknown;
  appearance?: unknown;
  voice?: unknown;
}

export function toCharacterContext(c: CharacterRecord): CharacterContext {
  const name = typeof c.name === 'string' ? c.name : '';
  const role = typeof c.role === 'string' ? c.role : null;
  const traits: string[] = [];
  for (const f of ['personality', 'arc', 'appearance', 'voice'] as const) {
    const v = c[f];
    if (typeof v === 'string' && v.trim().length > 0) traits.push(v.trim());
  }
  return { name, role, keyTraits: traits.join('; ') || null };
}
```

Notes:
- `CharacterRecord` is **deliberately permissive** (`unknown` per field) so the pure `prompt.service` module stays decoupled from the repo's narrative-character row shape. The runtime `typeof === 'string'` guards already in the route code are reproduced inside the helper.
- The repo-layer boundary is **not** crossed by this extraction. The repo still decrypts the character row before returning it; the helper just performs a pure projection of the already-decrypted result.
- `prompt.service.ts`'s "pure, no IO, no async" header invariant is preserved — `toCharacterContext` is pure.

Both route files become:
```ts
const characters: CharacterContext[] = rawCharacters.map(toCharacterContext);
```

The 15-line block in each route disappears.

### 6. System-prompt instruction tightening

The source-of-truth constant is `DEFAULT_SYSTEM_PROMPT` ([prompt.service.ts:81-84](../../../backend/src/services/prompt.service.ts#L81-L84)); `DEFAULT_PROMPTS.system` is an alias that references it ([prompt.service.ts:90](../../../backend/src/services/prompt.service.ts#L90)). Edit `DEFAULT_SYSTEM_PROMPT`, not the alias. Currently it ends with:
> "Return only the requested content — no preamble, no meta-commentary, no quotation marks around the output."

Append a clause that tells the model not to echo the new structural format:
> "Return only the requested content — no preamble, no meta-commentary, no quotation marks around the output, no XML tags, and no section labels."

Rationale: smaller models occasionally pattern-match input structure into their output. This is a cheap, strictly-more-defensive addition.

Caveat: this is the **default** template only. Users who have overridden their system prompt via `[X29]` will not get the updated wording. That's acceptable — overrides are explicitly user-controlled, and a user who has written their own system prompt is opting out of our default guidance by definition.

### 7. Strip the leading `Task:` prefix from action templates

With the `<task>` wrapper now marking the task section structurally, the literal `Task:` prefix inside each per-action template is redundant. Strip it from all 7 action templates in `DEFAULT_PROMPTS` ([prompt.service.ts:89-103](../../../backend/src/services/prompt.service.ts#L89-L103)):

- `continue`, `rewrite`, `expand`, `summarise`, `describe`, `scene`, `ask` — drop the leading `'Task: '` (six characters including the trailing space) from each string. Keep the rest of the template wording exactly as written.
- `system` is **not** touched here (it has no `Task:` prefix; its targeted edit is in §6).

**Frontend sync required.** `frontend/src/components/SettingsPromptsTab.stories.tsx` ([SettingsPromptsTab.stories.tsx:17-27](../../../frontend/src/components/SettingsPromptsTab.stories.tsx#L17-L27)) holds a manually-duplicated `DEFAULTS` literal that mocks the `GET /api/ai/default-prompts` response for Storybook isolation. Apply the same 7 edits there so the rendered story stays consistent with the backend. (The duplication itself is a pre-existing concern — a `useDefaultPrompts` fetch boundary that Storybook can't reach without seeding the React Query cache — and is **not** addressed by this spec.)

**Scope of impact:**

- `GET /api/ai/default-prompts` ([ai-defaults.routes.ts:16-17](../../../backend/src/routes/ai-defaults.routes.ts#L16-L17)) re-serializes `DEFAULT_PROMPTS` as-is. Endpoint response shape is unchanged; payload values update naturally. The endpoint test in `tests/routes/ai-defaults.test.ts` already compares against `DEFAULT_PROMPTS` (the constant) rather than literal strings, so no test edit is needed there.
- All `prompt.service` tests that assert on default templates use `DEFAULT_PROMPTS.<key>` (the constant) rather than literal `'Task: '` substrings — they re-derive automatically.
- A grep of the codebase for the literal substring `'Task: '` returns only the two files above (backend `prompt.service.ts` and frontend stories file); no other call site looks for it. No tests assert on the literal substring.
- **No user-data migration.** Pre-deployment per CLAUDE.md's no-data-migration rule; there are no stored user overrides to reconcile.
- **Settings → Prompts tab UX:** users will see the new prefix-less defaults in the "default" preview / placeholder for each action's template. Cosmetic; acceptable pre-deployment.

### 8. Tests

- **Unit tests for `escapeXmlText` / `escapeXmlAttr`** — added to a new or existing `prompt.service.test.ts` block. Cover: `&`, `<`, `>` in text; same plus `"` in attributes; empty string; string with no special chars (idempotent). Helpers are not exported, so tests can either (a) cover them indirectly via the rendering tests below, or (b) export them via a `__test__` namespace if direct coverage is preferred. Default: indirect coverage via rendering tests is sufficient.
- **Unit tests for `toCharacterContext`** — 6 cases:
  1. All four trait fields populated → all joined with `; `, no truncation (verifies cap removal). Include at least one case where the joined value exceeds 200 chars so the cap removal is unambiguous.
  2. Only `personality` populated → single value, no separator.
  3. Whitespace-only trait field → skipped.
  4. All trait fields null/missing → `keyTraits: null`.
  5. `role` missing/empty → `role: null`.
  6. `name` missing → empty string (current behavior preserved at the projection layer; the renderer then skips the entry per §2).
- **Rendering tests for `buildPrompt`** — update the existing per-action assertion loop at [backend/tests/services/prompt.service.test.ts:378-388](../../../backend/tests/services/prompt.service.test.ts#L378-L388) (the loop that today asserts `toContain('Chapter so far:' / 'World notes:' / 'Characters:')` for every action). New assertions:
  - System content contains `<world_notes>…</world_notes>` when world notes present, no `<world_notes>` tags when absent.
  - System content contains `<characters>…</characters>` with per-character tags when characters present; no `<characters>` when empty.
  - Per-character self-closing form when `keyTraits` null.
  - `role` attribute absent when `role` null; present otherwise.
  - Empty-name character is skipped (no `<character name="">` rendered, even when the upstream list has one).
  - `<chapter_so_far>…</chapter_so_far>` wraps chapter prose; tags present only when chapter survives the trim.
  - `<task>…</task>` always present in practice (built with a defensive `length > 0` guard regardless).
  - XML escaping in text: chapter prose with `<` / `>` / `&` renders as entity-escaped; world notes too.
  - XML escaping in attributes: character `name` containing `& < > "` renders entity-escaped.
  - **Load-bearing collision test (per Risk #1):** a character `name` literally containing `</character>` renders as `&lt;/character&gt;` inside the `name=""` attribute, and the surrounding `<character …>` tag is not closed prematurely. Similarly, chapter prose literally containing `</chapter_so_far>` renders as `&lt;/chapter_so_far&gt;`. This is the test that proves the escape's load-bearing purpose.
  - **Double-escape semantics (per §1):** a chapter prose input containing the literal four-character sequence `&amp;` renders as `&amp;amp;` in the wrapped output. Confirms input is treated as plaintext (escape is non-idempotent), not as pre-encoded XML.
  - **Trailing-whitespace normalization:** a `worldNotes` input ending in `\n\n   ` renders as `<world_notes>\n…content…\n</world_notes>` (single `\n` before the closing tag, no trailing whitespace). Same for `chapterText` and `taskTemplate`.
- **Route integration tests** — three existing assertion sites match the old `Chapter so far:` / `Characters:` / `World notes:` headers and need updating:
  - [backend/tests/services/prompt.service.test.ts:382-386](../../../backend/tests/services/prompt.service.test.ts#L382-L386) — the per-action header-assertion loop (covered above under rendering tests).
  - [backend/tests/ai/complete.test.ts:423](../../../backend/tests/ai/complete.test.ts#L423) — `expect(wireMessages[0]?.content).toContain('Chapter so far:')`.
  - [backend/tests/routes/chat.test.ts:483](../../../backend/tests/routes/chat.test.ts#L483) — `expect(sent.some((m) => m.content.includes('Chapter so far:'))).toBe(true)`.

  Update each to match the new XML wrappers (e.g., `toContain('<chapter_so_far>')` / `toContain('<characters>')` / `toContain('<world_notes>')`). No new integration tests needed for this change (it's a rendering tweak; the route-level contract is unchanged).
- **Encryption leak test ([E12])** — unaffected. Escaping doesn't change which plaintext bytes appear in egress; the leak test's sentinel-string match still passes through entity-encoded characters when the original prose contained them. Sanity-check by running it; no test changes expected.
- **`DEFAULT_PROMPTS` / Task-prefix-strip (§7)** — no new tests required. Existing tests in `prompt.service.test.ts` and `prompt.user-prompts.test.ts` already compare against `DEFAULT_PROMPTS.<key>` (the constant), not literal `'Task: '` substrings, so they re-derive correctly after the edit. The `ai-defaults.test.ts` endpoint test compares against `DEFAULT_PROMPTS` and similarly re-derives. The frontend stories file (`SettingsPromptsTab.stories.tsx`) is a Storybook-only artifact with no automated assertions; visual sync is verified by opening the story.

## Out-of-scope additions worth recording

These are deliberately deferred and **must not** sneak in:

- Scene-scoped character selection (only inject characters mentioned in the freeform scene instruction).
- Voice samples / tells & tics / relationship blocks in the character block.
- Per-action character-block tuning (richer block for `scene` vs. minimal block for `summarise`).
- Wrapping the system prompt intro in a `<system>` tag.
- Wrapping the user message body in any XML tag.

Each of these is a coherent later task on top of this scaffolding.

## Risks & mitigations

1. **Closing-tag literals in user content.** If a future chapter or world-note body literally contains `</chapter_so_far>` or `</world_notes>` the section would close prematurely. The XML-text escape handles this for `<` / `>` (they become `&lt;` / `&gt;`), so a literal `</chapter_so_far>` in chapter prose becomes `&lt;/chapter_so_far&gt;` and cannot collapse the tag. This is why text-escaping is mandatory, not optional, even though the more obvious motivation is preventing entity-confusion.
2. **Token-budget shift.** Documented in §3. Visible only on very large casts on small-context models; not a regression for typical use.
3. **Model echoing tags in output.** Mitigated by the `DEFAULT_PROMPTS.system` clause in §6. If a user-overridden system prompt fails to mention "no XML tags" and the model echoes them, the right fix is for the user to update their override — not for us to post-process the model output. Narrow asymmetric cost: the "no XML tags" instruction could in principle suppress the model legitimately producing `<` in prose (e.g., `"I <3 you"`, math expressions, or fiction quoting code/markup). Not observed in practice for a creative-writing tool, and worth noting if it ever surfaces — the fix would be a more precise instruction along the lines of "no `<tag_name>`-style XML tags used in this prompt" rather than the broad "no XML tags."
4. **Task-template escaping covers the `[X29]` override surface.** `DEFAULT_PROMPTS[action]` strings are framework-controlled and contain no `<` / `>` / `&` today, but `[X29]` lets users override every template key including the `<task>`-wrapped action templates ([prompt.service.ts:28-41](../../../backend/src/services/prompt.service.ts#L28-L41)). A user override containing `<`, `>`, or `</task>` would bleed out of the task tag without escaping. §2 mandates escaping the task template precisely to close this surface; the cost is one extra `escapeXmlText` call and apostrophes are not affected.
5. **`prompt.service` decoupling from repo types.** Mitigated by the deliberately-permissive `CharacterRecord` interface (§5). The repo's typed result is structurally compatible without a cast.

## Acceptance criteria

- `buildPrompt` renders the system-message content using `<world_notes>` / `<characters>` / `<chapter_so_far>` / `<task>` wrappers as specified, with conditional inclusion preserved.
- Each character renders as `<character name="…" role="…">…</character>` or the self-closing form per the rules in §2.
- `role` attribute is omitted when `null`; never rendered as `role=""` or `role="null"`.
- An empty-`name` character (malformed projection input) is **skipped entirely** at the renderer — no `<character name="">` reaches the prompt.
- All decrypted user content interpolated into system-content tags is XML-escaped: character `name`/`role` (attribute escape including `"`), character `keyTraits` (text escape), world notes (text escape), chapter prose (text escape), task template (text escape — closes the `[X29]` override surface). Escape is non-idempotent by design: input is treated as plaintext, so a literal `&amp;` in user content becomes `&amp;amp;`.
- Trailing whitespace inside any wrapper body is normalized via `.trimEnd()` before insertion. No `<world_notes>…\n\n</world_notes>` rendering.
- Inner content sits flush at column 0 inside every wrapper — no indent on `<character>` lines or anywhere else.
- The user-message body is **unchanged** by this spec: no XML wrapper, no escaping. Role-level isolation already delimits it.
- The 120-char `keyTraits` cap is removed; no truncation remains in `toCharacterContext`. A unit test asserts a >200-char joined trait string survives intact.
- A test asserts that a character `name` containing `</character>` and chapter prose containing `</chapter_so_far>` both render entity-escaped and do not prematurely close their enclosing tags (the load-bearing collision test from §8).
- The duplicated character mapping in `ai.routes.ts` and `chat.routes.ts` is gone; both routes call `toCharacterContext` from `prompt.service.ts`. The stray `// Condense traits:` comment from `ai.routes.ts:126` is also removed (no longer applicable).
- `DEFAULT_SYSTEM_PROMPT` (the source constant; `DEFAULT_PROMPTS.system` is an alias) includes the "no XML tags, no section labels" clause.
- The leading `'Task: '` prefix is stripped from all 7 action templates in `DEFAULT_PROMPTS` (`continue`, `rewrite`, `expand`, `summarise`, `describe`, `scene`, `ask`). The frontend stories file `SettingsPromptsTab.stories.tsx` `DEFAULTS` literal is updated to match — a grep for the literal substring `'Task: '` across `backend/src`, `backend/tests`, and `frontend/src` returns zero hits after the change.
- All existing tests pass; new tests for `toCharacterContext` and updated rendering assertions pass.
- `npm --prefix backend run typecheck` passes; backend test suite passes; leak test passes; design lint (`lint:design`) unaffected.

## Verify line (for bd)

```
verify: npm --prefix backend run typecheck && npm --prefix backend test -- tests/services/prompt.service.test.ts tests/ai/complete.test.ts tests/routes/chat.test.ts tests/routes/ai-defaults.test.ts
```

(Explicit paths because the route integration coverage lives at `tests/ai/complete.test.ts` and `tests/routes/ai-defaults.test.ts`, not a single `ai.test.ts`. Vitest's positional filter silently matches zero files if the path is wrong, so a name-pattern verify would pass without exercising the wire-up.)
