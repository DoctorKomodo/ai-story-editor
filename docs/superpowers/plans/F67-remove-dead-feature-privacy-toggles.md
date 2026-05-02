# F67 — Remove F43 Venice tab dead feature/privacy toggles

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Delete the eight stateful-but-no-op checkboxes on the F43 Settings → Venice tab — six "Features" toggles (Chat completions / Text continuation / Inline rewrite / Image generation / Character extraction / Embeddings) and two "Privacy" toggles (Request logging / Send story context). They render and accept clicks but persist nowhere and gate nothing. Keep the **Include Venice creative-writing prompt** toggle (it's already wired to `settings.ai.includeVeniceSystemPrompt` via B11 and is *not* dead).

## Decision

**Delete, do not extend.** Rationale (per the F67 task copy + project conventions):

- **No concrete user need.** The operator already controls feature reach via the Venice account (image generation, embeddings, web search are account-level entitlements at Venice). Per-user feature flags inside Inkwell would duplicate that without giving the user any new control.
- **`Send story context`** and **`Request logging`** would require new prompt-builder branches that cost the same risk surface as encryption/leak tests would have to cover (CLAUDE.md: "Plaintext narrative content must never appear in logs"). The cheapest non-leak path is "always send the system prompt + selection; never log a prompt or response". Adding a *toggle* to that introduces a path where logging is on — which we don't want, ever, regardless of user setting.
- **The toggles violate CLAUDE.md** specifically the "Don't add features … beyond what the task requires" + "no half-finished implementations" rules. They are exactly half-finished implementations the task says should be removed.
- **Mockup fidelity argument**: even though the toggles exist in the mockup, the mockup is the *visual spec*; "show all eight toggles even if they don't do anything" is not a constraint the mockup imposes — the mockup just shows what's possible if we wired them. Deleting them from the running app does not break visual fidelity in any user-facing flow.

**The feedback loop with F66**: F66 chose *implement* for the F45 Writing tab toggles because they have small, deterministic, in-component behaviour (TipTap input rules) and no privacy/safety concern. F67's toggles are the opposite — non-trivial backend work + privacy/leak surface for marginal benefit. Different defaults, same project rule applied: "ship behaviour, not promises".

**Architecture:** Pure deletion. Remove the `<FeatureToggleNoop>` helper, the two `<section>` blocks containing it (Settings.tsx:486–540 + 542–559), the inline TODOs, and the `data-testid="venice-section-features"` / `…-privacy` references in tests. The **Include Venice creative-writing prompt** label (currently nested inside the Features section) moves out into its own section ("Behaviour" — single-toggle section) so it survives the deletion.

**Tech Stack:** No new code, no new tests beyond updating snapshots / queries that referenced the deleted blocks.

**Prerequisites:** None. F43 is shipped; F67 is purely a tidy.

**Out of scope:**
- Removing the toggles from `mockups/archive/v1-2025-11/design/*.jsx`. The mockups are the design archive; they stay in case a future iteration wants to revisit per-user feature flags.
- Backend changes — there's nothing to remove (the toggles never touched the backend).
- The Venice tab's API key / endpoint / organization fields, the Verified pill, or the Include-Venice-system-prompt toggle. All untouched.

---

### Task 1: Lift the **Include Venice creative-writing prompt** toggle out of the Features section

**Files:**
- Modify: `frontend/src/components/Settings.tsx:520-539`

The "Include Venice creative-writing prompt" toggle (currently lines 520–539) sits inside the same `<section data-testid="venice-section-features">` that we're about to delete. Move it into its own section immediately above the Features section, so we can delete Features cleanly.

- [ ] **Step 1: Wrap the toggle in its own `<section>`**

```tsx
// Settings.tsx — new section, placed just before the Features section
<section className="flex flex-col gap-3" data-testid="venice-section-behaviour">
  <header>
    <h3 className="m-0 font-serif text-[14px] font-medium text-ink">Behaviour</h3>
  </header>

  {/* Bound to settings.ai.includeVeniceSystemPrompt via [B11]. */}
  <label className="flex items-start gap-2 text-[12px] py-1">
    <input
      type="checkbox"
      data-testid="venice-include-system-prompt"
      checked={includeVeniceSystemPrompt}
      disabled={!settingsQuery.data || updateSettings.isPending}
      onChange={(e) => {
        handleToggleVenicePrompt(e.target.checked);
      }}
      className="mt-1"
    />
    <span className="flex flex-col gap-[2px]">
      <span className="font-medium text-ink-2">Include Venice creative-writing prompt</span>
      <span className="text-ink-4 font-sans">
        Prepend Venice&apos;s built-in creative writing guidance on top of Inkwell&apos;s own
        system prompt.
      </span>
    </span>
  </label>
</section>
```

- [ ] **Step 2: Run the existing Venice/system-prompt test**

```bash
cd frontend && npx vitest run tests/components/Settings.shell-venice.test.tsx
```

Expected: PASS. The test queries by `data-testid="venice-include-system-prompt"`, which moves cleanly with the toggle.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/Settings.tsx
git commit -m "[F67] lift include-venice-system-prompt toggle into Behaviour section"
```

---

### Task 2: Delete the Features section + the FeatureToggleNoop helper

**Files:**
- Modify: `frontend/src/components/Settings.tsx`
- Modify: `frontend/tests/components/Settings.shell-venice.test.tsx` (remove any assertions of the deleted toggles)

- [ ] **Step 1: Delete the section + helper**

Remove:
- The entire `<section data-testid="venice-section-features">` block (post-Task-1 it now contains only the six `<FeatureToggleNoop>` calls and the section header — delete the whole section).
- The `function FeatureToggleNoop` helper (Settings.tsx:565–592).
- The two `// TODO: feature toggles below are stateful but no-op …` comments.
- Any unused `useState` import that was only there for `FeatureToggleNoop`.

- [ ] **Step 2: Update the test**

```bash
cd frontend && grep -n 'venice-section-features\|FeatureToggleNoop' tests
```

Remove any assertions matching the section testid or helper name. The remaining tests should cover only the API key field, endpoint, organization, Behaviour-section toggle, and the Privacy section (deleted in Task 3, so its assertions go too).

- [ ] **Step 3: Run the test**

```bash
cd frontend && npx vitest run tests/components/Settings.shell-venice.test.tsx
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/Settings.tsx frontend/tests/components/Settings.shell-venice.test.tsx
git commit -m "[F67] delete dead Venice-tab Features toggles + FeatureToggleNoop"
```

---

### Task 3: Delete the Privacy section

**Files:**
- Modify: `frontend/src/components/Settings.tsx:542-559`
- Modify: `frontend/tests/components/Settings.shell-venice.test.tsx`

- [ ] **Step 1: Delete the section**

Remove the entire `<section data-testid="venice-section-privacy">` block (lines 542–559) including the two `<FeatureToggleNoop>` calls and the inline TODO comment.

- [ ] **Step 2: Sweep tests for `venice-section-privacy`**

```bash
cd frontend && grep -rn 'venice-section-privacy\|Request logging\|Send story context' tests
```

Remove any references.

- [ ] **Step 3: Run tests**

```bash
cd frontend && npx vitest run tests/components/Settings.shell-venice.test.tsx
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/Settings.tsx frontend/tests/components/Settings.shell-venice.test.tsx
git commit -m "[F67] delete dead Venice-tab Privacy toggles"
```

---

### Task 4: Sweep for stragglers

**Files:**
- Audit: `grep -rn "FeatureToggleNoop\|venice-section-features\|venice-section-privacy" frontend`

- [ ] **Step 1: Run the sweep**

```bash
cd frontend && grep -rn "FeatureToggleNoop\|venice-section-features\|venice-section-privacy\|requestLogging\|sendStoryContext" src tests
```

Expected: empty.

- [ ] **Step 2: Commit if any sweep changes**

```bash
git add -A
git commit -m "[F67] remove last references to deleted toggles"
```

---

### Task 5: Visual sanity check

**Files:** none (manual check).

- [ ] **Step 1: Start the stack and open Settings → Venice**

```bash
make dev
```

In a browser, sign in, open Settings → Venice. Confirm:
- The API key / endpoint / organization fields are present.
- The Verified pill renders correctly when a key is stored.
- The "Include Venice creative-writing prompt" toggle is in a new "Behaviour" section.
- No "Features" or "Privacy" sections appear.
- The modal still scrolls cleanly within the 720px width — no awkward whitespace where the deleted sections used to be.

If the modal looks short, that's expected — F67 *removes* surface area. No layout fix needed.

---

### Task 6: Verify the F67 task gate

**Files:**
- Modify: `TASKS.md`

- [ ] **Step 1: Add a verify command** (the task currently has none)

```
verify: cd frontend && npm run typecheck && npx vitest run tests/components/Settings.shell-venice.test.tsx
```

- [ ] **Step 2: Run via `/task-verify F67`** and only tick on exit code 0.

- [ ] **Step 3: Commit the tick**

```bash
git add TASKS.md
git commit -m "[F67] tick — dead Venice-tab feature/privacy toggles removed"
```

---

## Self-Review Notes

- **Decision rationale recorded.** Delete; no per-user feature flags; safety-arg specifically against the Privacy/logging toggle.
- **`Include Venice creative-writing prompt` survives** — it's the one Venice-tab toggle that's actually wired, and it stays in its own Behaviour section. Test selector unchanged (`data-testid="venice-include-system-prompt"`).
- **Mockup files unchanged.** The mockup is the design archive; deleting from `mockups/archive/v1-2025-11/design/*.jsx` would lose the breadcrumb if a future iteration wants to revisit per-user flags.
- **No backend change.** The toggles never made a network call.
- **No data migration.** The toggles never persisted (per CLAUDE.md "Don't write data-migration branches").
- **F43's `security-reviewer` gate** does not need re-running — F67 does not touch any security-critical surface (auth, session, key storage, rate limit, encryption). Skip the reviewer.
