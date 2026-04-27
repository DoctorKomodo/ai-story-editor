# F66 — Resolve smart-quotes / em-dash drift

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the F45 Settings → Writing toggles for **Smart quotes** and **Em-dash expansion** actually do something. Today the toggles persist to `localStorage` (key `inkwell.writing.smartQuotes` / `…emDashExpansion`) but no code reads them — the prose surface never substitutes anything. F66 closes the loop by extending the `[B11]` settings JSON with `writing.smartQuotes: boolean` + `writing.emDashExpansion: boolean`, dropping the localStorage shim, and wiring two TipTap input rules gated by those settings.

## Decision

**Implement, do not delete.** Rationale:

- The toggles are already in the F45 mockup, ship in production, and have UI affordance + tests. Deleting them now would mean a visible regression in the fidelity surface (Writing tab) for no engineering win.
- The behaviour is small (two TipTap input rules, ~30 lines of code), pure, and deterministic.
- Persisting per-user (not per-device) is the right semantics for typography preferences — a user who configures smart quotes on their laptop should get them on their phone too. localStorage is the wrong store; B11 is the right one.
- Extending B11's `writing` block is one Zod field per toggle and one mirrored default — cheaper than the design discussions deletion would force.

**Auto-save toggle stays in localStorage.** Per the F66 task copy: that one is a pure frontend behaviour with no backend semantics. F66 only migrates `smartQuotes` and `emDashExpansion`.

**Architecture:**

1. **Backend ([B11] extension):** add `writing.smartQuotes: boolean` and `writing.emDashExpansion: boolean` to the Zod schema and `DEFAULT_SETTINGS.writing` in `backend/src/routes/user-settings.routes.ts`. Defaults are `false` (off) to match today's localStorage default and avoid surprising existing users.

2. **Frontend (`SettingsWritingTab`):** swap the two `useLocalBool` hooks for the existing TanStack Query mutation that already PATCHes `/api/users/me/settings` (mirroring how `typewriterMode` / `focusMode` / `dailyWordGoal` already work in this file). Drop the LS_KEYS entries. The optimistic-update pattern is already established for the same tab — copy it.

3. **TipTap input rules:** two new input rules in a new module `frontend/src/lib/tiptap-typography.ts`:
   - **Smart quotes:** `'` and `"` with directional rules — opening if the preceding char is whitespace / start-of-line / opening punctuation, closing otherwise. Curly mappings: `'` → `‘ ’`, `"` → `“ ”`.
   - **Em-dash:** `--` (two hyphens) → `—` (U+2014). Trigger on the second hyphen, replacing both.
   Each rule is wrapped in a thin TipTap `Extension.create` that reads its enabled flag from a configurable option, so the wrapper extension can be remounted with a fresh option when the user toggles. (TipTap doesn't support hot-swapping a single rule at runtime; remount is the canonical pattern.)

4. **Paper integration:** `<Paper>` reads `writing.smartQuotes` + `writing.emDashExpansion` from the settings query and passes them to a new `getTypographyExtensions({ smartQuotes, emDashExpansion })` factory that returns the configured extensions. The factory return value is appended to `formatBarExtensions` in Paper's `useEditor` config. When a setting flips, the editor remounts with the new extension list — same pattern Paper already uses for `initialBodyJson` swaps.

**Tech Stack:** Zod (backend schema), TipTap `Extension.create` + `InputRule`, TanStack Query mutation in SettingsWritingTab (existing).

**Prerequisites (incremental order):**
- **F45** ships SettingsWritingTab with the toggles using `useLocalBool` (already done).
- **B11** ships the `/api/users/me/settings` GET + PATCH (already done — `backend/src/routes/user-settings.routes.ts`).
- **F52** mounts `<Paper>` in EditorPage (done before F66 in incremental order).

**Out of scope:**
- Auto-save toggle migration (stays in localStorage per task copy).
- Configurable quote styles (German/French quotation marks etc.) — single curly-quote pair only.
- Smart quote handling inside code blocks / inline code — TipTap input rules already skip nodes whose schema disallows the inserted character, but verify in the test that pasting `"` into a code block stays straight.
- Undo/redo for the auto-substitution beyond what TipTap's built-in input-rule undo gives (single ⌘Z reverts one substitution; that's standard TipTap behaviour).

---

### Task 1: Extend B11 schema with `writing.smartQuotes` + `writing.emDashExpansion`

**Files:**
- Modify: `backend/src/routes/user-settings.routes.ts:41-49,73`
- Modify: `backend/tests/routes/user-settings.test.ts` (add cases)

- [ ] **Step 1: Write the failing test**

```ts
// tests/routes/user-settings.test.ts (additions)
it('GET /api/users/me/settings returns writing.smartQuotes and emDashExpansion defaults (false)', async () => {
  // … standard setup
  const res = await request(app).get('/api/users/me/settings').set(authHeader());
  expect(res.body.writing.smartQuotes).toBe(false);
  expect(res.body.writing.emDashExpansion).toBe(false);
});

it('PATCH writing.smartQuotes / emDashExpansion persists', async () => {
  await request(app)
    .patch('/api/users/me/settings')
    .set(authHeader())
    .send({ writing: { smartQuotes: true, emDashExpansion: true } })
    .expect(200);

  const res = await request(app).get('/api/users/me/settings').set(authHeader());
  expect(res.body.writing.smartQuotes).toBe(true);
  expect(res.body.writing.emDashExpansion).toBe(true);
});
```

Run: `cd backend && npx vitest run tests/routes/user-settings.test.ts`
Expected: FAIL — schema rejects unknown keys (`.strict()`).

- [ ] **Step 2: Add the schema fields + defaults**

```ts
// user-settings.routes.ts:41-49
writing: z
  .object({
    spellcheck: z.boolean().optional(),
    typewriterMode: z.boolean().optional(),
    focusMode: z.boolean().optional(),
    dailyWordGoal: z.number().int().min(0).max(100_000).optional(),
    smartQuotes: z.boolean().optional(),
    emDashExpansion: z.boolean().optional(),
  })
  .strict()
  .optional(),
```

```ts
// user-settings.routes.ts:73
writing: {
  spellcheck: true,
  typewriterMode: false,
  focusMode: false,
  dailyWordGoal: 0,
  smartQuotes: false,
  emDashExpansion: false,
},
```

- [ ] **Step 3: Run the tests**

```bash
cd backend && npx vitest run tests/routes/user-settings.test.ts
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add backend/src/routes/user-settings.routes.ts backend/tests/routes/user-settings.test.ts
git commit -m "[F66] B11 schema: add writing.smartQuotes + writing.emDashExpansion"
```

---

### Task 2: Migrate the toggles in `SettingsWritingTab` from localStorage to B11

**Files:**
- Modify: `frontend/src/components/SettingsWritingTab.tsx` (lines ~28–30, 147–148, and the change handlers)
- Modify: `frontend/tests/components/SettingsWritingTab.test.tsx`

- [ ] **Step 1: Replace `useLocalBool` with the existing settings mutation pattern**

Read the file. The `typewriterMode` / `focusMode` flow already uses the pattern: a TanStack Query for `/api/users/me/settings` + a mutation for PATCH. Mirror it for the two new fields. Delete the `LS_KEYS.smartQuotes` / `LS_KEYS.emDashExpansion` entries and the two `useLocalBool` calls.

```tsx
// SettingsWritingTab.tsx — additions (mirror existing pattern)
const smartQuotes = writing.smartQuotes ?? false;
const emDashExpansion = writing.emDashExpansion ?? false;

const handleSmartQuotesChange = (next: boolean): void => {
  patchSettings.mutate({ writing: { smartQuotes: next } });
};

const handleEmDashChange = (next: boolean): void => {
  patchSettings.mutate({ writing: { emDashExpansion: next } });
};
```

Wire each toggle's `checked` + `onChange` to those values/handlers. Remove the localStorage hook calls.

- [ ] **Step 2: Update the existing test**

```tsx
// tests/components/SettingsWritingTab.test.tsx — replacement assertions
it('toggling Smart quotes PATCHes /api/users/me/settings', async () => {
  // mock fetch; render; click toggle; assert PATCH called with body { writing: { smartQuotes: true } }
});

it('toggling Em-dash expansion PATCHes /api/users/me/settings', async () => {
  // analogous
});

// delete: any test asserting localStorage write for these two keys.
```

- [ ] **Step 3: Run tests**

```bash
cd frontend && npx vitest run tests/components/SettingsWritingTab.test.tsx
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/SettingsWritingTab.tsx frontend/tests/components/SettingsWritingTab.test.tsx
git commit -m "[F66] SettingsWritingTab: smartQuotes/emDash toggles persist via B11"
```

---

### Task 3: Sweep stale localStorage keys

**Files:**
- Audit: `grep -rn "inkwell.writing.smartQuotes\|inkwell.writing.emDashExpansion" frontend`

- [ ] **Step 1: Run the sweep**

```bash
cd frontend && grep -rn "smartQuotes\|emDashExpansion" src tests \
  | grep -v 'SettingsWritingTab\|user-settings\|tiptap-typography'
```

Expected: empty.

- [ ] **Step 2: Commit if any sweep changes**

```bash
git add -A
git commit -m "[F66] remove stale localStorage references"
```

---

### Task 4: Implement TipTap typography extensions

**Files:**
- Create: `frontend/src/lib/tiptap-typography.ts`
- Test: `frontend/tests/lib/tiptap-typography.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// tests/lib/tiptap-typography.test.ts
import { describe, expect, it } from 'vitest';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { getTypographyExtensions } from '@/lib/tiptap-typography';

function makeEditor(opts: { smartQuotes: boolean; emDashExpansion: boolean }): Editor {
  return new Editor({
    extensions: [StarterKit, ...getTypographyExtensions(opts)],
    content: '',
  });
}

describe('typography extensions', () => {
  it('substitutes opening curly quote at start-of-paragraph when smartQuotes is on', () => {
    const editor = makeEditor({ smartQuotes: true, emDashExpansion: false });
    editor.commands.insertContent('"');
    editor.commands.insertContent('hi');
    expect(editor.getText()).toContain('“');
  });

  it('substitutes closing curly quote after a letter', () => {
    const editor = makeEditor({ smartQuotes: true, emDashExpansion: false });
    editor.commands.insertContent('hi');
    editor.commands.insertContent('"');
    expect(editor.getText()).toContain('”');
  });

  it('does NOT substitute when smartQuotes is off', () => {
    const editor = makeEditor({ smartQuotes: false, emDashExpansion: false });
    editor.commands.insertContent('"hi"');
    expect(editor.getText()).toBe('"hi"');
  });

  it('substitutes -- with em-dash when emDashExpansion is on', () => {
    const editor = makeEditor({ smartQuotes: false, emDashExpansion: true });
    editor.commands.insertContent('a-');
    editor.commands.insertContent('-');
    expect(editor.getText()).toContain('—');
    expect(editor.getText()).not.toContain('--');
  });

  it('does NOT substitute when emDashExpansion is off', () => {
    const editor = makeEditor({ smartQuotes: false, emDashExpansion: false });
    editor.commands.insertContent('a--b');
    expect(editor.getText()).toBe('a--b');
  });

  it('substitutes inside paragraphs but skips code blocks', () => {
    const editor = makeEditor({ smartQuotes: true, emDashExpansion: true });
    editor.commands.setContent('<pre><code>hi</code></pre>');
    editor.commands.focus('end');
    editor.commands.insertContent('"');
    // Inside <code>, straight quote remains.
    expect(editor.getHTML()).toContain('"');
  });
});
```

Run: `cd frontend && npx vitest run tests/lib/tiptap-typography.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 2: Implement `getTypographyExtensions`**

```ts
// frontend/src/lib/tiptap-typography.ts
import { Extension, InputRule } from '@tiptap/core';

interface TypographyOptions {
  smartQuotes: boolean;
  emDashExpansion: boolean;
}

const OPENING_PRECEDERS = /[\s\(\[\{`'" ]$/;

function makeSmartQuoteRule(straight: '"' | "'", openCurly: string, closeCurly: string): InputRule {
  return new InputRule({
    find: new RegExp(straight === '"' ? '"$' : "'$"),
    handler({ state, range, match }) {
      const { from } = range;
      const before = state.doc.textBetween(Math.max(0, from - 1), from, undefined, ' ');
      const useOpening = before.length === 0 || OPENING_PRECEDERS.test(before);
      const replacement = useOpening ? openCurly : closeCurly;
      const tr = state.tr.replaceWith(
        range.from,
        range.to,
        state.schema.text(replacement),
      );
      // ensure the input rule re-applies for the next quote
      void match;
      return tr.scrollIntoView() as unknown as void;
    },
  });
}

function makeEmDashRule(): InputRule {
  return new InputRule({
    find: /--$/,
    handler({ state, range }) {
      const tr = state.tr.replaceWith(range.from, range.to, state.schema.text('—'));
      return tr.scrollIntoView() as unknown as void;
    },
  });
}

const SmartQuotes = Extension.create({
  name: 'inkwellSmartQuotes',
  addInputRules() {
    return [
      makeSmartQuoteRule('"', '“', '”'),
      makeSmartQuoteRule("'", '‘', '’'),
    ];
  },
});

const EmDash = Extension.create({
  name: 'inkwellEmDash',
  addInputRules() {
    return [makeEmDashRule()];
  },
});

export function getTypographyExtensions({
  smartQuotes,
  emDashExpansion,
}: TypographyOptions): Extension[] {
  const out: Extension[] = [];
  if (smartQuotes) out.push(SmartQuotes);
  if (emDashExpansion) out.push(EmDash);
  return out;
}
```

> Note: confirm the `InputRule` constructor signature against the `@tiptap/core` version pinned in `frontend/package.json`. Recent TipTap versions ship `InputRule` directly; older ones may use `markInputRule` / `nodeInputRule` factories. Adjust the implementation to match the installed shape — the *contract* (find regex + handler that replaces a text range) is stable.

- [ ] **Step 3: Run the tests**

```bash
cd frontend && npx vitest run tests/lib/tiptap-typography.test.ts
```

Expected: PASS. If JSDOM's contentEditable surface doesn't fully exercise input rules, port the assertions to use `editor.commands.insertContent` + a manual rule trigger or move the test to Playwright.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/lib/tiptap-typography.ts frontend/tests/lib/tiptap-typography.test.ts
git commit -m "[F66] tiptap-typography: smart-quote + em-dash input rules"
```

---

### Task 5: Wire the extensions into `<Paper>`

**Files:**
- Modify: `frontend/src/components/Paper.tsx`
- Test: `frontend/tests/components/Paper.typography.test.tsx`

- [ ] **Step 1: Read settings + remount editor on toggle**

```tsx
// Paper.tsx — additions
import { useUserSettings } from '@/hooks/useUserSettings'; // existing TanStack Query hook
import { getTypographyExtensions } from '@/lib/tiptap-typography';

const { data: settings } = useUserSettings();
const smartQuotes = settings?.writing?.smartQuotes ?? false;
const emDashExpansion = settings?.writing?.emDashExpansion ?? false;

const extensions = useMemo(
  () => [...formatBarExtensions, ...getTypographyExtensions({ smartQuotes, emDashExpansion })],
  [smartQuotes, emDashExpansion],
);

const editor = useEditor(
  {
    extensions,
    // … rest of existing config
  },
  [smartQuotes, emDashExpansion], // dependency array → editor remounts when toggled
);
```

> The `useEditor(deps)` second-arg pattern is the canonical TipTap React way to remount on dep change. Confirm against the version pinned in package.json (some versions take options-only with no deps array; in that case use a `key` prop on `<EditorContent>` keyed off `${smartQuotes}-${emDashExpansion}` to force remount).

- [ ] **Step 2: Add a Paper integration test**

```tsx
// tests/components/Paper.typography.test.tsx
it('substitutes -- with em-dash when emDashExpansion=true in settings', async () => {
  // mock useUserSettings to return { writing: { emDashExpansion: true } }
  render(<Paper storyTitle="t" />);
  const editor = await waitForEditor();
  editor.commands.insertContent('a--');
  expect(editor.getText()).toContain('—');
});
```

- [ ] **Step 3: Run tests**

```bash
cd frontend && npx vitest run tests/components/Paper.typography.test.tsx
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/Paper.tsx frontend/tests/components/Paper.typography.test.tsx
git commit -m "[F66] Paper consumes typography extensions from B11 writing settings"
```

---

### Task 6: Verify the F66 task gate

**Files:**
- Modify: `TASKS.md`

- [ ] **Step 1: Add a verify command** (the task currently has none)

```
verify: cd backend && npx vitest run tests/routes/user-settings.test.ts && cd ../frontend && npx vitest run tests/lib/tiptap-typography.test.ts tests/components/SettingsWritingTab.test.tsx tests/components/Paper.typography.test.tsx
```

- [ ] **Step 2: Run via `/task-verify F66`** and only tick on exit code 0.

- [ ] **Step 3: Commit the tick**

```bash
git add TASKS.md
git commit -m "[F66] tick — smart-quotes / em-dash via B11 + TipTap input rules"
```

---

## Self-Review Notes

- **Decision rationale recorded inline** at the top — implement, not delete. Keeps F45's UI promise.
- **Per-user persistence (B11)** is the right semantics for typography preferences. localStorage was a F45-author-deferred shim that no one read.
- **Defaults are `false`** to preserve current behaviour for existing users (today's `useLocalBool` defaults are false).
- **TipTap input rules** are the standard pattern for character-level substitution in this stack — same primitive `StarterKit` uses for `--` → `—` if you'd installed `@tiptap/extension-typography`. We're not using the official extension because it's all-or-nothing (single boolean, all rules), and we want fine-grained per-rule toggles.
- **Code blocks are skipped automatically** by TipTap's input-rule machinery (rules opt out of nodes whose schema is `code: true` by default). Tests confirm.
- **Extension remount on toggle** uses the `useEditor(options, deps)` arg or a remount key — both work; pick whichever the pinned `@tiptap/react` version supports.
- **No migration of existing localStorage values.** Per CLAUDE.md "Don't write data-migration branches" rule — pre-deployment, no users have these LS keys; post-deployment, the default `false` matches the LS default, so the worst case is a user has to flip the toggle once.
