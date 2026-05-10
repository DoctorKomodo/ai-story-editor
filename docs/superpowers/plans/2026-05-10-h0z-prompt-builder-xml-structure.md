# [h0z] Prompt-builder XML structure — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate the `buildPrompt` system-message rendering to explicit XML section wrappers (`<world_notes>`, `<characters>`, `<chapter_so_far>`, `<task>`), drop the 120-char `keyTraits` cap, extract the duplicated character-mapping helper out of the route layer, escape user content interpolated into tags, and strip the now-redundant `Task:` prefix from action templates.

**Architecture:** Single backend service module (`backend/src/services/prompt.service.ts`) owns all rendering. Routes (`ai.routes.ts`, `chat.routes.ts`) become thin callers. All escaping is text-level (entity-escape `& < >` for text, plus `"` for attributes); no CDATA. Trailing-whitespace inside wrappers is normalised via `.trimEnd()`. Tests follow TDD per block; collision and double-escape tests lock in the load-bearing escape invariant.

**Tech Stack:** TypeScript (strict), Vitest, Prisma (read-only here, not touched), Express. No new dependencies.

**Spec:** [docs/superpowers/specs/2026-05-10-prompt-builder-xml-structure-design.md](../specs/2026-05-10-prompt-builder-xml-structure-design.md)

**bd:** story-editor-h0z

---

## File Structure

**Modified files (backend):**
- `backend/src/services/prompt.service.ts` — adds 2 private XML-escape helpers, 1 private `renderCharacterTag` helper, 1 exported `toCharacterContext` helper, 1 exported `CharacterRecord` interface. Updates 4 block builders (`worldNotesBlock`, `charactersBlock`, `chapterBlock`, `taskBlock`) to XML form. Updates `DEFAULT_SYSTEM_PROMPT` constant. Strips `Task:` prefix from 7 action templates in `DEFAULT_PROMPTS`.
- `backend/src/routes/ai.routes.ts` — replaces 15-line inline character mapping (lines 123-138, including the stray `// Condense traits:` comment) with `rawCharacters.map(toCharacterContext)`.
- `backend/src/routes/chat.routes.ts` — replaces 15-line inline character mapping (lines 384-398) with `rawCharacters.map(toCharacterContext)`.

**Modified files (frontend):**
- `frontend/src/components/SettingsPromptsTab.stories.tsx` — strips `Task:` prefix from the manually-mocked `DEFAULTS` literal (lines 17-27) to stay in sync with the backend.

**Modified files (tests):**
- `backend/tests/services/prompt.service.test.ts` — adds `toCharacterContext` unit tests, updates the per-action header-assertion loop (lines 378-388), adds XML-rendering tests, adds collision tests, adds double-escape semantics test, adds trim test.
- `backend/tests/ai/complete.test.ts` — updates header-assertion at line 423.
- `backend/tests/routes/chat.test.ts` — updates header-assertion at line 483.

**New files:** none.

---

## Task 1: Extract `toCharacterContext` helper with 120-char cap removed

**Files:**
- Modify: `backend/src/services/prompt.service.ts` (add new public exports near the existing `CharacterContext` interface, ~line 22-26)
- Test: `backend/tests/services/prompt.service.test.ts` (add a new `describe` block)

- [ ] **Step 1: Write the failing tests** in `backend/tests/services/prompt.service.test.ts` — add the following block at the end of the file (or co-located with the existing `describe` that imports `prompt.service`):

```ts
import { toCharacterContext, type CharacterRecord } from '../../src/services/prompt.service';

describe('toCharacterContext (h0z)', () => {
  it('all four trait fields populated → joined with "; "; no truncation even when result > 200 chars', () => {
    const long = 'x'.repeat(80);
    const c: CharacterRecord = {
      name: 'Imogen Thorne',
      role: 'protagonist',
      personality: long,
      arc: long,
      appearance: long,
      voice: 'auburn hair',
    };
    const out = toCharacterContext(c);
    expect(out.name).toBe('Imogen Thorne');
    expect(out.role).toBe('protagonist');
    expect(out.keyTraits).not.toBeNull();
    expect(out.keyTraits!.length).toBeGreaterThan(200);
    expect(out.keyTraits).toBe(`${long}; ${long}; ${long}; auburn hair`);
  });

  it('only personality populated → single value, no separator', () => {
    expect(toCharacterContext({ name: 'Bystander', personality: 'shy' })).toEqual({
      name: 'Bystander',
      role: null,
      keyTraits: 'shy',
    });
  });

  it('whitespace-only trait fields are skipped', () => {
    const out = toCharacterContext({
      name: 'X',
      personality: '   ',
      arc: '\t\n',
      appearance: 'tall',
    });
    expect(out.keyTraits).toBe('tall');
  });

  it('all trait fields missing/null → keyTraits is null', () => {
    expect(toCharacterContext({ name: 'X' }).keyTraits).toBeNull();
  });

  it('role missing or empty → role is null', () => {
    expect(toCharacterContext({ name: 'X' }).role).toBeNull();
    expect(toCharacterContext({ name: 'X', role: '' }).role).toBe(''); // empty string is preserved as-is per typeof check
  });

  it('name missing or non-string → empty string', () => {
    expect(toCharacterContext({}).name).toBe('');
    expect(toCharacterContext({ name: 42 as unknown }).name).toBe('');
  });
});
```

- [ ] **Step 2: Run the tests** — they should fail with "toCharacterContext is not exported" or similar:

```bash
npm --prefix backend test -- tests/services/prompt.service.test.ts -t "toCharacterContext"
```
Expected: FAIL.

- [ ] **Step 3: Implement the helper.** In `backend/src/services/prompt.service.ts`, after the existing `CharacterContext` interface (~line 26), add:

```ts
// [h0z] Permissive shape that matches the decrypted character row returned by
// the character repo. Kept loose (`unknown` per field) so the pure prompt
// service stays decoupled from the repo's narrative-character type.
export interface CharacterRecord {
  name?: unknown;
  role?: unknown;
  personality?: unknown;
  arc?: unknown;
  appearance?: unknown;
  voice?: unknown;
}

// [h0z] Pure projection of a decrypted character row into the trimmed shape
// the prompt builder consumes. Previously inlined in ai.routes.ts and
// chat.routes.ts (byte-for-byte duplicate, modulo one stray comment).
// The 120-char cap from the inlined version is removed by design.
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

Note: the test for "role missing or empty" exercises both paths: `role: undefined` → typeof check fails → `null`; `role: ''` → typeof string succeeds → `''` (preserved). This is intentional — only non-string/missing collapses to `null`.

- [ ] **Step 4: Run the tests** — should pass:

```bash
npm --prefix backend test -- tests/services/prompt.service.test.ts -t "toCharacterContext"
```
Expected: PASS (6/6).

- [ ] **Step 5: Typecheck** — confirm no regressions:

```bash
npm --prefix backend run typecheck
```
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add backend/src/services/prompt.service.ts backend/tests/services/prompt.service.test.ts
git commit -m "[h0z] feat: add toCharacterContext helper (cap removed)"
```

---

## Task 2: Swap routes to use `toCharacterContext`

**Files:**
- Modify: `backend/src/routes/ai.routes.ts:119-138`
- Modify: `backend/src/routes/chat.routes.ts:382-398`

- [ ] **Step 1: Replace the inline mapping in `ai.routes.ts`.** Locate lines 119-138 (currently the `// ── 6. Load characters` and `// ── 7. Map characters to CharacterContext` blocks). The existing imports already include `CharacterContext`; add `toCharacterContext` to the same `prompt.service` import line. Replace the block with:

```ts
      // ── 6. Load characters ────────────────────────────────────────────────
      const rawCharacters = await createCharacterRepo(req).findManyForStory(body.storyId);

      // ── 7. Map characters to CharacterContext ────────────────────────────
      const characters: CharacterContext[] = rawCharacters.map(toCharacterContext);
```

The 15-line inline `.map(...)` body, including the `// Condense traits: …` comment, is deleted.

- [ ] **Step 2: Replace the inline mapping in `chat.routes.ts`.** Locate lines 382-398. Add `toCharacterContext` to the existing `prompt.service` import. Replace with:

```ts
      // ── 5. Load characters ────────────────────────────────────────────────
      const rawCharacters = await createCharacterRepo(req).findManyForStory(storyId);
      const characters: CharacterContext[] = rawCharacters.map(toCharacterContext);
```

- [ ] **Step 3: Typecheck**:

```bash
npm --prefix backend run typecheck
```
Expected: no errors.

- [ ] **Step 4: Run the route integration tests** — they should still pass because the projection logic is unchanged except for cap removal, and no existing test asserts the cap:

```bash
npm --prefix backend test -- tests/ai/complete.test.ts tests/routes/chat.test.ts
```
Expected: PASS. If any test fails due to the cap removal (e.g., a test that asserts a specific truncated `keyTraits` value), update it to reflect the new uncapped output and note the change in the commit message.

- [ ] **Step 5: Commit**

```bash
git add backend/src/routes/ai.routes.ts backend/src/routes/chat.routes.ts
git commit -m "[h0z] refactor: route character mapping → toCharacterContext (cap removed)"
```

---

## Task 3: XML-wrap `charactersBlock`

**Files:**
- Modify: `backend/src/services/prompt.service.ts` (add escape helpers, `renderCharacterTag`, update `charactersBlock` construction)
- Test: `backend/tests/services/prompt.service.test.ts` (add new tests; update existing assertion loop)

- [ ] **Step 1: Write the failing tests.** Add a new `describe` block in `prompt.service.test.ts`:

```ts
describe('charactersBlock XML rendering (h0z)', () => {
  function baseInput(characters: CharacterContext[]) {
    return {
      action: 'continue' as const,
      selectedText: '',
      chapterContent: '',
      characters,
      worldNotes: null,
      modelContextLength: 8192,
      modelMaxCompletionTokens: 1024,
      userMaxCompletionTokens: Number.POSITIVE_INFINITY,
    };
  }

  it('renders <characters>...</characters> with one <character> per entry', () => {
    const out = buildPrompt(baseInput([
      { name: 'Imogen Thorne', role: 'protagonist', keyTraits: 'wry' },
      { name: 'Felix', role: 'rival', keyTraits: 'vain' },
    ]));
    const sys = out.messages[0].content;
    expect(sys).toContain('<characters>\n');
    expect(sys).toContain('\n</characters>');
    expect(sys).toContain('<character name="Imogen Thorne" role="protagonist">wry</character>');
    expect(sys).toContain('<character name="Felix" role="rival">vain</character>');
  });

  it('self-closing form when keyTraits is null', () => {
    const out = buildPrompt(baseInput([{ name: 'Bystander', role: null, keyTraits: null }]));
    expect(out.messages[0].content).toContain('<character name="Bystander" />');
  });

  it('omits role attribute when role is null', () => {
    const out = buildPrompt(baseInput([{ name: 'X', role: null, keyTraits: 'flat' }]));
    const sys = out.messages[0].content;
    expect(sys).toContain('<character name="X">flat</character>');
    expect(sys).not.toMatch(/role=""/);
    expect(sys).not.toMatch(/role="null"/);
  });

  it('empty-name character is skipped entirely', () => {
    const out = buildPrompt(baseInput([
      { name: '', role: 'rival', keyTraits: 'noise' },
      { name: 'Real', role: 'protagonist', keyTraits: 'ok' },
    ]));
    const sys = out.messages[0].content;
    expect(sys).not.toContain('<character name=""');
    expect(sys).toContain('<character name="Real" role="protagonist">ok</character>');
  });

  it('characters block omitted entirely when list is empty', () => {
    const out = buildPrompt(baseInput([]));
    expect(out.messages[0].content).not.toContain('<characters>');
  });

  it('escapes & < > " in attributes and & < > in text', () => {
    const out = buildPrompt(baseInput([
      { name: 'A & B "the kid"', role: '<rival>', keyTraits: 'has < and > and &' },
    ]));
    const sys = out.messages[0].content;
    expect(sys).toContain('name="A &amp; B &quot;the kid&quot;"');
    expect(sys).toContain('role="&lt;rival&gt;"');
    expect(sys).toContain('>has &lt; and &gt; and &amp;</character>');
  });

  it('collision test: name containing </character> does not close the tag prematurely', () => {
    const out = buildPrompt(baseInput([
      { name: '</character>', role: null, keyTraits: 'ok' },
    ]));
    const sys = out.messages[0].content;
    expect(sys).toContain('name="&lt;/character&gt;"');
    // No raw </character> appears inside the attribute portion before the real closer
    expect(sys).toContain('<character name="&lt;/character&gt;">ok</character>');
  });
});
```

- [ ] **Step 2: Update the existing per-action header-assertion loop** in `prompt.service.test.ts` lines 382-388. Replace these three assertions:

```ts
      expect(out.messages[0]?.content).toContain('Chapter so far:');
      expect(out.messages[0]?.content).toContain('CHAPTER_BODY_SENTINEL');
      expect(out.messages[0]?.content).toContain('World notes:');
      expect(out.messages[0]?.content).toContain('WORLD_NOTES_SENTINEL');
      expect(out.messages[0]?.content).toContain('Characters:');
      expect(out.messages[0]?.content).toContain('CHAR_TRAIT_SENTINEL');
```

with:

```ts
      expect(out.messages[0]?.content).toContain('<chapter_so_far>');
      expect(out.messages[0]?.content).toContain('CHAPTER_BODY_SENTINEL');
      expect(out.messages[0]?.content).toContain('<world_notes>');
      expect(out.messages[0]?.content).toContain('WORLD_NOTES_SENTINEL');
      expect(out.messages[0]?.content).toContain('<characters>');
      expect(out.messages[0]?.content).toContain('CHAR_TRAIT_SENTINEL');
```

- [ ] **Step 3: Run the tests** — both the new `charactersBlock` ones and the (now-updated) per-action loop should fail because the implementation still emits the old format:

```bash
npm --prefix backend test -- tests/services/prompt.service.test.ts
```
Expected: FAIL on the new tests and on all loop iterations (one fail per action × 3 headers).

- [ ] **Step 4: Implement the XML helpers and `renderCharacterTag`.** In `backend/src/services/prompt.service.ts`, after the `estimateTokens` function (~line 115), add:

```ts
// ─── XML escape helpers (h0z) ────────────────────────────────────────────────
// Used wherever decrypted user content is interpolated into XML wrappers in
// the system-message content. Escape semantics: input is plaintext (escape is
// non-idempotent — a literal "&amp;" in user input renders as "&amp;amp;").

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

// ─── Per-character renderer (h0z) ────────────────────────────────────────────

function renderCharacterTag(c: CharacterContext): string {
  if (!c.name) return ''; // skip malformed empty-name entries entirely
  const nameAttr = ` name="${escapeXmlAttr(c.name)}"`;
  const roleAttr = c.role ? ` role="${escapeXmlAttr(c.role)}"` : '';
  if (!c.keyTraits) return `<character${nameAttr}${roleAttr} />`;
  return `<character${nameAttr}${roleAttr}>${escapeXmlText(c.keyTraits)}</character>`;
}
```

- [ ] **Step 5: Switch `charactersBlock` to XML.** In `backend/src/services/prompt.service.ts` at lines 188-200 (inside `buildPrompt`), replace the existing `charactersBlock` construction:

```ts
  const charactersBlock =
    input.characters.length > 0
      ? `<characters>\n${input.characters
          .map(renderCharacterTag)
          .filter((s) => s.length > 0)
          .join('\n')}\n</characters>`
      : '';
```

(The old `\`Characters:\n${...}\`` block is replaced wholesale. The `.filter` is what drops empty-name entries.)

- [ ] **Step 6: Run the tests** — the new `charactersBlock` describe should all pass, and the per-action loop should pass on the `<characters>` assertion but still fail on `<chapter_so_far>` and `<world_notes>` (those come in later tasks):

```bash
npm --prefix backend test -- tests/services/prompt.service.test.ts
```
Expected: new `charactersBlock` tests PASS; per-action loop still fails on the two other headers — that's expected and will be fixed in Tasks 4 and 5.

- [ ] **Step 7: Typecheck**:

```bash
npm --prefix backend run typecheck
```
Expected: no errors.

- [ ] **Step 8: Commit**

```bash
git add backend/src/services/prompt.service.ts backend/tests/services/prompt.service.test.ts
git commit -m "[h0z] feat: XML-wrap charactersBlock + escape helpers"
```

---

## Task 4: XML-wrap `worldNotesBlock` with trim

**Files:**
- Modify: `backend/src/services/prompt.service.ts` (`worldNotesBlock` construction, ~line 186-187)
- Test: `backend/tests/services/prompt.service.test.ts`

- [ ] **Step 1: Write the failing tests.** Add a new `describe` block:

```ts
describe('worldNotesBlock XML rendering (h0z)', () => {
  function baseInput(worldNotes: string | null) {
    return {
      action: 'continue' as const,
      selectedText: '',
      chapterContent: '',
      characters: [],
      worldNotes,
      modelContextLength: 8192,
      modelMaxCompletionTokens: 1024,
      userMaxCompletionTokens: Number.POSITIVE_INFINITY,
    };
  }

  it('renders <world_notes>...</world_notes> when world notes present', () => {
    const out = buildPrompt(baseInput('Late-Victorian London.'));
    const sys = out.messages[0].content;
    expect(sys).toContain('<world_notes>\nLate-Victorian London.\n</world_notes>');
  });

  it('omits the wrapper entirely when world notes are null or empty', () => {
    expect(buildPrompt(baseInput(null)).messages[0].content).not.toContain('<world_notes>');
    expect(buildPrompt(baseInput('')).messages[0].content).not.toContain('<world_notes>');
  });

  it('escapes & < > in world-notes content', () => {
    const out = buildPrompt(baseInput('AT&T then <html> there'));
    expect(out.messages[0].content).toContain('<world_notes>\nAT&amp;T then &lt;html&gt; there\n</world_notes>');
  });

  it('collision test: world notes containing </world_notes> renders escaped', () => {
    const out = buildPrompt(baseInput('text </world_notes> more text'));
    const sys = out.messages[0].content;
    expect(sys).toContain('text &lt;/world_notes&gt; more text');
  });

  it('trailing whitespace inside the wrapper is normalised (no trailing \\n\\n before closer)', () => {
    const out = buildPrompt(baseInput('content\n\n   '));
    const sys = out.messages[0].content;
    expect(sys).toContain('<world_notes>\ncontent\n</world_notes>');
    expect(sys).not.toContain('content\n\n');
  });
});
```

- [ ] **Step 2: Run the tests** — they fail (still on old `World notes:` format):

```bash
npm --prefix backend test -- tests/services/prompt.service.test.ts -t "worldNotesBlock"
```
Expected: FAIL.

- [ ] **Step 3: Implement.** In `backend/src/services/prompt.service.ts` at lines 186-187, replace the existing `worldNotesBlock`:

```ts
  const worldNotesBlock = (() => {
    const trimmed = input.worldNotes ? input.worldNotes.trimEnd() : '';
    return trimmed.length > 0
      ? `<world_notes>\n${escapeXmlText(trimmed)}\n</world_notes>`
      : '';
  })();
```

(Using an IIFE keeps the local `trimmed` from leaking into other block builders. Alternative: a `const worldNotesTrimmed = …` at the top of the function and reference it — either pattern is fine.)

- [ ] **Step 4: Run the tests** — the new tests pass, and the per-action loop's `<world_notes>` assertion now passes too:

```bash
npm --prefix backend test -- tests/services/prompt.service.test.ts
```
Expected: `worldNotesBlock` tests PASS; per-action loop still fails only on `<chapter_so_far>` (fixed in Task 5).

- [ ] **Step 5: Typecheck**:

```bash
npm --prefix backend run typecheck
```
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add backend/src/services/prompt.service.ts backend/tests/services/prompt.service.test.ts
git commit -m "[h0z] feat: XML-wrap worldNotesBlock with trim + escape"
```

---

## Task 5: XML-wrap `chapterBlock` with trim + cross-file integration test fixes

**Files:**
- Modify: `backend/src/services/prompt.service.ts` (`chapterBlock` construction, ~line 224)
- Test: `backend/tests/services/prompt.service.test.ts`
- Test: `backend/tests/ai/complete.test.ts:423`
- Test: `backend/tests/routes/chat.test.ts:483`

- [ ] **Step 1: Write the failing tests.** Add to `prompt.service.test.ts`:

```ts
describe('chapterBlock XML rendering (h0z)', () => {
  function baseInput(chapterContent: string) {
    return {
      action: 'continue' as const,
      selectedText: '',
      chapterContent,
      characters: [],
      worldNotes: null,
      modelContextLength: 8192,
      modelMaxCompletionTokens: 1024,
      userMaxCompletionTokens: Number.POSITIVE_INFINITY,
    };
  }

  it('renders <chapter_so_far>...</chapter_so_far> when chapter content survives the trim', () => {
    const out = buildPrompt(baseInput('She crossed the room.'));
    expect(out.messages[0].content).toContain('<chapter_so_far>\nShe crossed the room.\n</chapter_so_far>');
  });

  it('omits the wrapper when chapter is empty', () => {
    expect(buildPrompt(baseInput('')).messages[0].content).not.toContain('<chapter_so_far>');
  });

  it('escapes & < > in chapter prose', () => {
    const out = buildPrompt(baseInput('Sam said "<3" then & sighed.'));
    expect(out.messages[0].content).toContain('<chapter_so_far>\nSam said "&lt;3" then &amp; sighed.\n</chapter_so_far>');
  });

  it('collision test: chapter containing </chapter_so_far> renders escaped', () => {
    const out = buildPrompt(baseInput('open </chapter_so_far> close'));
    expect(out.messages[0].content).toContain('open &lt;/chapter_so_far&gt; close');
  });

  it('double-escape semantics: literal "&amp;" in chapter renders as "&amp;amp;"', () => {
    const out = buildPrompt(baseInput('Smith &amp; Wesson'));
    expect(out.messages[0].content).toContain('Smith &amp;amp; Wesson');
  });

  it('trailing whitespace inside the wrapper is normalised', () => {
    const out = buildPrompt(baseInput('content\n\n  '));
    const sys = out.messages[0].content;
    expect(sys).toContain('<chapter_so_far>\ncontent\n</chapter_so_far>');
    expect(sys).not.toContain('content\n\n  ');
  });
});
```

- [ ] **Step 2: Update `backend/tests/ai/complete.test.ts:423`.** Change:

```ts
    expect(wireMessages[0]?.content).toContain('Chapter so far:');
```

to:

```ts
    expect(wireMessages[0]?.content).toContain('<chapter_so_far>');
```

- [ ] **Step 3: Update `backend/tests/routes/chat.test.ts:483`.** Change:

```ts
    expect(sent.some((m) => m.content.includes('Chapter so far:'))).toBe(true);
```

to:

```ts
    expect(sent.some((m) => m.content.includes('<chapter_so_far>'))).toBe(true);
```

- [ ] **Step 4: Run the tests** — they fail because the implementation still emits `Chapter so far:`:

```bash
npm --prefix backend test -- tests/services/prompt.service.test.ts tests/ai/complete.test.ts tests/routes/chat.test.ts
```
Expected: FAIL on the new `chapterBlock` tests, on `complete.test.ts:423`, and on `chat.test.ts:483`.

- [ ] **Step 5: Implement.** In `backend/src/services/prompt.service.ts`, locate the existing chapter-budget trim block (~line 213-222) and the `chapterBlock` line at 224. After `chapterText` is computed (post-trim), replace the `chapterBlock` construction:

```ts
  const chapterTrimmed = chapterText.trimEnd();
  const chapterBlock =
    chapterTrimmed.length > 0
      ? `<chapter_so_far>\n${escapeXmlText(chapterTrimmed)}\n</chapter_so_far>`
      : '';
```

- [ ] **Step 6: Run the tests**:

```bash
npm --prefix backend test -- tests/services/prompt.service.test.ts tests/ai/complete.test.ts tests/routes/chat.test.ts
```
Expected: all PASS. The per-action loop is now fully migrated to XML.

- [ ] **Step 7: Typecheck**:

```bash
npm --prefix backend run typecheck
```
Expected: no errors.

- [ ] **Step 8: Commit**

```bash
git add backend/src/services/prompt.service.ts backend/tests/services/prompt.service.test.ts backend/tests/ai/complete.test.ts backend/tests/routes/chat.test.ts
git commit -m "[h0z] feat: XML-wrap chapterBlock + update integration assertions"
```

---

## Task 6: XML-wrap `taskBlock` with escape + length guard

**Files:**
- Modify: `backend/src/services/prompt.service.ts` (`taskBlock` — note: this block doesn't exist yet as a named variable today; the task template is folded directly into `systemParts`)
- Test: `backend/tests/services/prompt.service.test.ts`

**Background:** The current code at [prompt.service.ts:226-232](../../backend/src/services/prompt.service.ts#L226-L232) builds `systemParts` as `[systemContent, worldNotesBlock, charactersBlock, chapterBlock, taskTemplate]`. After this task, `taskTemplate` is replaced in that array by a new `taskBlock` variable.

- [ ] **Step 1: Write the failing tests.** Add to `prompt.service.test.ts`:

```ts
describe('taskBlock XML rendering (h0z)', () => {
  function baseInput(action: 'continue' | 'scene', userPrompts?: Record<string, string>) {
    return {
      action,
      selectedText: '',
      chapterContent: 'CHAPTER',
      characters: [],
      worldNotes: null,
      modelContextLength: 8192,
      modelMaxCompletionTokens: 1024,
      userMaxCompletionTokens: Number.POSITIVE_INFINITY,
      userPrompts,
      freeformInstruction: action === 'scene' ? 'do the thing' : undefined,
    };
  }

  it('renders <task>...</task> with the resolved template inside', () => {
    const out = buildPrompt(baseInput('continue'));
    const sys = out.messages[0].content;
    expect(sys).toMatch(/<task>\n[\s\S]+\n<\/task>/);
  });

  it('user-override task template is XML-escaped (X29 surface)', () => {
    const out = buildPrompt(baseInput('continue', { continue: 'malicious </task> attempt with <tag> and & amp' }));
    const sys = out.messages[0].content;
    // The user override is escaped; the </task> closer is the framework's, not the override's.
    expect(sys).toContain('malicious &lt;/task&gt; attempt with &lt;tag&gt; and &amp; amp');
    // The framework <task> opener and </task> closer are still present and structurally sound:
    expect(sys.match(/<task>\n/g)?.length).toBe(1);
    expect(sys.match(/\n<\/task>/g)?.length).toBe(1);
  });

  it('trailing whitespace in the resolved template is normalised', () => {
    const out = buildPrompt(baseInput('continue', { continue: 'do it.\n\n  ' }));
    const sys = out.messages[0].content;
    expect(sys).toContain('<task>\ndo it.\n</task>');
  });

  it('apostrophes survive the escape', () => {
    const out = buildPrompt(baseInput('continue', { continue: "don't break the apostrophe" }));
    const sys = out.messages[0].content;
    expect(sys).toContain("<task>\ndon't break the apostrophe\n</task>");
  });
});
```

- [ ] **Step 2: Run the tests** — they fail (no `<task>` wrapper yet):

```bash
npm --prefix backend test -- tests/services/prompt.service.test.ts -t "taskBlock"
```
Expected: FAIL.

- [ ] **Step 3: Implement.** In `backend/src/services/prompt.service.ts`, locate where `taskTemplate` is resolved (~line 202: `const taskTemplate = taskTemplateFor(input.action, input.userPrompts);`). Immediately after that line, add:

```ts
  const taskTrimmed = taskTemplate.trimEnd();
  const taskBlock =
    taskTrimmed.length > 0
      ? `<task>\n${escapeXmlText(taskTrimmed)}\n</task>`
      : '';
```

Then update the `systemParts` array (currently lines 226-232):

```ts
  const systemParts = [
    systemContent,
    worldNotesBlock,
    charactersBlock,
    chapterBlock,
    taskBlock,
  ].filter((p) => p.length > 0);
```

The old `taskTemplate` reference in `systemParts` is replaced by `taskBlock`. The `estimateTokens(taskTemplate)` call in `fixedTokens` (~line 209) stays as-is — `taskTemplate` is still the variable holding the resolved string; the token budget is computed against the pre-wrap template, which is a slight under-count of the actual wrapped block (the wrapper is ~17 tokens) but the 512-token `SAFETY_MARGIN_TOKENS` absorbs it. Alternative: change `estimateTokens(taskTemplate)` to `estimateTokens(taskBlock)` for precision — pick whichever; no test depends on the exact value.

- [ ] **Step 4: Run the tests**:

```bash
npm --prefix backend test -- tests/services/prompt.service.test.ts
```
Expected: all PASS.

- [ ] **Step 5: Typecheck**:

```bash
npm --prefix backend run typecheck
```
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add backend/src/services/prompt.service.ts backend/tests/services/prompt.service.test.ts
git commit -m "[h0z] feat: XML-wrap taskBlock with escape (closes X29 override surface)"
```

---

## Task 7: Update `DEFAULT_SYSTEM_PROMPT` clause

**Files:**
- Modify: `backend/src/services/prompt.service.ts:81-84`

- [ ] **Step 1: Edit the constant.** In `backend/src/services/prompt.service.ts` at lines 81-84, replace:

```ts
export const DEFAULT_SYSTEM_PROMPT =
  'You are an expert creative-writing assistant. ' +
  'Help the author continue, refine, and develop their story with vivid prose that matches their established voice and tone. ' +
  'Return only the requested content — no preamble, no meta-commentary, no quotation marks around the output.';
```

with:

```ts
export const DEFAULT_SYSTEM_PROMPT =
  'You are an expert creative-writing assistant. ' +
  'Help the author continue, refine, and develop their story with vivid prose that matches their established voice and tone. ' +
  'Return only the requested content — no preamble, no meta-commentary, no quotation marks around the output, no XML tags, and no section labels.';
```

Only the trailing clause changes. `DEFAULT_PROMPTS.system` is an alias that references this constant ([prompt.service.ts:90](../../backend/src/services/prompt.service.ts#L90)) and updates automatically.

- [ ] **Step 2: Run the affected tests** — `ai-defaults.test.ts` compares against `DEFAULT_PROMPTS` and `prompt.user-prompts.test.ts` references the constant; both should pass since the assertions re-derive:

```bash
npm --prefix backend test -- tests/routes/ai-defaults.test.ts tests/services/prompt.user-prompts.test.ts tests/services/prompt.service.test.ts
```
Expected: PASS.

- [ ] **Step 3: Typecheck**:

```bash
npm --prefix backend run typecheck
```
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add backend/src/services/prompt.service.ts
git commit -m "[h0z] feat: instruct model to omit XML tags + section labels in output"
```

---

## Task 8: Strip `Task:` prefix from action templates + frontend sync

**Files:**
- Modify: `backend/src/services/prompt.service.ts:89-103` (`DEFAULT_PROMPTS` action templates)
- Modify: `frontend/src/components/SettingsPromptsTab.stories.tsx:17-27` (`DEFAULTS` mock literal)

- [ ] **Step 1: Edit the backend `DEFAULT_PROMPTS`** at lines 92-102. For each of the 7 action templates (`continue`, `rewrite`, `expand`, `summarise`, `describe`, `scene`, `ask`), remove the leading `'Task: '` (six characters). The final shape:

```ts
export const DEFAULT_PROMPTS = {
  system: DEFAULT_SYSTEM_PROMPT,
  continue:
    'continue the story from where the selection ends, matching the established voice. Aim for roughly 80–150 words.',
  rewrite:
    'rewrite the selection with different phrasing while preserving meaning and voice. Return a single alternative version.',
  expand:
    'expand the selection with more detail, description, and depth. Keep the same POV, tense, and voice.',
  summarise: 'summarise the selection to its essential points. Use 1–3 sentences.',
  describe:
    "describe the subject of the selection with vivid sensory, physical, and emotional detail. Maintain the story's POV and tense.",
  scene:
    'write a passage of prose that depicts the scene the user describes. Render the action and dialogue directly — do not summarise. Match the established voice, POV, and tense from the chapter so far. Aim for roughly 100–200 words unless the user specifies otherwise.',
  ask: "answer the user's question about the story. Use the chapter and character context to inform your answer.",
} as const satisfies Record<UserPromptKey, string>;
```

The `system` key is unchanged (it references `DEFAULT_SYSTEM_PROMPT`, which has no `Task:` prefix). Note: the `scene` template loses the `Task: ` prefix but the rest of the sentence is intact — it now starts with the verb `write`.

- [ ] **Step 2: Edit the frontend stories file** at `frontend/src/components/SettingsPromptsTab.stories.tsx:17-27`. Mirror the exact same 7 edits to the `DEFAULTS` literal. (The file shape mirrors `DEFAULT_PROMPTS` for Storybook mocking; values must stay in sync with the backend.)

- [ ] **Step 3: Grep confirmation.** Verify no `'Task: '` literal remains anywhere in source:

```bash
grep -rn "'Task: \|\"Task: " backend/src backend/tests frontend/src 2>/dev/null
```
Expected: zero output. If anything appears, fix it.

- [ ] **Step 4: Run the affected tests** — assertions reference `DEFAULT_PROMPTS.<key>` rather than literal strings, so they re-derive automatically:

```bash
npm --prefix backend test -- tests/routes/ai-defaults.test.ts tests/services/prompt.user-prompts.test.ts tests/services/prompt.service.test.ts
```
Expected: PASS.

- [ ] **Step 5: Typecheck** both subprojects:

```bash
npm --prefix backend run typecheck && npm --prefix frontend run typecheck
```
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add backend/src/services/prompt.service.ts frontend/src/components/SettingsPromptsTab.stories.tsx
git commit -m "[h0z] refactor: strip 'Task:' prefix from action templates (redundant under <task>)"
```

---

## Task 9: Final verification

**Files:** none modified — verification only.

- [ ] **Step 1: Run the full bd verify command** (as recorded in the bd issue's `--notes`):

```bash
npm --prefix backend run typecheck && npm --prefix backend test -- tests/services/prompt.service.test.ts tests/ai/complete.test.ts tests/routes/chat.test.ts tests/routes/ai-defaults.test.ts
```
Expected: PASS across all four test files + typecheck clean.

- [ ] **Step 2: Run the encryption leak test** to confirm it is unaffected (spec invariant — entity-escaping doesn't change which plaintext bytes appear in egress):

```bash
npm --prefix backend test -- tests/security/encryption-leak.test.ts
```
Expected: PASS (no new test changes required; this is a sanity check).

- [ ] **Step 3: Run the full backend test suite** to catch any unrelated regressions:

```bash
npm --prefix backend test
```
Expected: PASS.

- [ ] **Step 4: Run the frontend typecheck** (no frontend logic changed but the stories file was edited; this confirms the import structure is intact):

```bash
npm --prefix frontend run typecheck
```
Expected: no errors.

- [ ] **Step 5: Confirm `lint:design` is unaffected** (spec invariant):

```bash
npm --prefix frontend run lint:design
```
Expected: PASS.

- [ ] **Step 6: Final grep — confirm no stale headers remain in source.** Run:

```bash
grep -rn "'Characters:\|'Chapter so far:\|'World notes:\|\"Characters:\|\"Chapter so far:\|\"World notes:" backend/src 2>/dev/null
```
Expected: zero hits.

- [ ] **Step 7: Close via `/bd-close-reviewed`** (or, if running this inline rather than via `/bd-execute`, the same skill can be invoked standalone). The close-gate skill runs typecheck, the bd verify line, fans `security-reviewer` (auth/crypto surface untouched here, but the helper handles that) and `repo-boundary-reviewer` (the route changes touch character mapping but stay on the post-decrypt side of the boundary). On CLEAN, the bd issue closes; on `BLOCK` or `FIX_BEFORE_MERGE`, fix the code and re-loop.

```bash
/bd-close-reviewed story-editor-h0z
```

---

## Self-review notes

**Spec coverage:**
- §1 (escape helpers) → Task 3 step 4.
- §2 (section wrapping + renderCharacterTag + rules) → Tasks 3, 4, 5, 6.
- §3 (token-budget accounting) → noted in Task 6 step 3 (no code change; documented choice on `estimateTokens(taskTemplate)` vs `estimateTokens(taskBlock)`).
- §4 (drop 120-char cap) → Tasks 1 + 2.
- §5 (extract `toCharacterContext` + `CharacterRecord`) → Tasks 1 + 2.
- §6 (DEFAULT_SYSTEM_PROMPT clause) → Task 7.
- §7 (strip Task: prefix + frontend sync) → Task 8.
- §8 (tests) — covered piecewise inside Tasks 1, 3, 4, 5, 6; collision + double-escape tests in Tasks 3 (character) + 4 (world_notes) + 5 (chapter + double-escape) + 6 (task escape); trim tests across Tasks 4, 5, 6.

**Acceptance criteria coverage:** every AC bullet maps to at least one task; the final verify in Task 9 runs the bd-recorded verify line plus the leak test and frontend typecheck called out in the AC.

**Type consistency:** `toCharacterContext` / `CharacterRecord` (Task 1) match `renderCharacterTag` / `CharacterContext` (Task 3). `escapeXmlText` and `escapeXmlAttr` are referenced consistently across Tasks 3, 4, 5, 6.

**Out-of-scope guard:** plan does not touch character-sheet schema, scene-scoped character selection, voice samples, `<system>`-wrapping, or the user-message body. Confirmed against spec "Out of scope" list.
