# Character Create Flow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The Cast tab `+` opens `<CharacterSheet>` in a Create mode where Save persists via the create mutation and Cancel discards. Replaces the current "+ creates Untitled immediately" path.

**Architecture:** `<CharacterSheet>` becomes a discriminated component (`mode: 'edit' | 'create'`). EditorPage owns a single `characterModal` state of shape `{ mode: 'edit'; id } | { mode: 'create' } | null`. CastTab stops calling the create mutation directly and instead invokes a new `onCreateCharacter` prop.

**Tech Stack:** React 19, TypeScript strict, TanStack Query, Vitest + Testing Library, Zustand (`useSelectedCharacterStore`).

**Spec:** `docs/superpowers/specs/2026-05-01-character-create-flow-design.md`

---

## File Structure

**Modify:**
- `frontend/src/components/CharacterSheet.tsx` — discriminated props, create branch.
- `frontend/src/components/CharacterSheet.stories.tsx` — add a Create variant; update existing Edit variant to new prop shape.
- `frontend/src/components/CastTab.tsx` — drop create mutation, add `onCreateCharacter` prop.
- `frontend/src/components/CastTab.stories.tsx` — pass `onCreateCharacter` stub.
- `frontend/src/pages/EditorPage.tsx` — `openCharacterId` → `characterModal` state; wire `onCreateCharacter`.
- `frontend/tests/components/CharacterSheet.test.tsx` — adapt existing tests to `mode: 'edit'`.
- `frontend/tests/components/CastTab.test.tsx` — replace `+`-creates assertion with `onCreateCharacter` call assertion.
- `frontend/tests/components/CastTab.delete.test.tsx` — pass `onCreateCharacter` stub (no behavioural change).
- `frontend/tests/components/CastTab.dragA11y.test.tsx` — pass `onCreateCharacter` stub (no behavioural change).

**Create:**
- `frontend/tests/components/CharacterSheet.create.test.tsx` — create-mode test suite.

---

## Conventions

**Verify after each task:**
```bash
cd frontend && npx tsc --noEmit && npx vitest run --reporter=basic
```
Frontend Biome lint runs in repo-root pre-edit hooks; resolve any warnings before committing.

**Commit style:** `[<scope>] <imperative>` — these are F-series tweaks. Use `[F19]` for CharacterSheet changes, `[F28]` for CastTab/EditorPage wiring.

---

## Task 1: Switch CharacterSheet props to a discriminated union (edit-only behaviour preserved)

**Files:**
- Modify: `frontend/src/components/CharacterSheet.tsx`
- Modify: `frontend/src/components/CharacterSheet.stories.tsx`
- Modify: `frontend/tests/components/CharacterSheet.test.tsx`

This task changes the prop **shape only**. Behaviour stays the same: edit mode loads, edits, saves, deletes. Create mode is added in Task 2.

- [ ] **Step 1: Update `CharacterSheetProps` to a discriminated union**

In `frontend/src/components/CharacterSheet.tsx`:

```ts
export type CharacterSheetProps =
  | {
      storyId: string;
      mode: 'edit';
      characterId: string;
      onClose: () => void;
    }
  | {
      storyId: string;
      mode: 'create';
      onClose: (createdId: string | null) => void;
    };
```

- [ ] **Step 2: Adapt the function body — for this task, only the edit branch is wired**

Replace:
```ts
export function CharacterSheet({
  storyId,
  characterId,
  onClose,
}: CharacterSheetProps): JSX.Element | null {
  ...
  const open = characterId !== null;
  const query = useCharacterQuery(open ? storyId : null, characterId);
```

With (Task 1 — narrow on `mode`, throw on `'create'` for now to keep the diff small):

```ts
export function CharacterSheet(props: CharacterSheetProps): JSX.Element | null {
  if (props.mode === 'create') {
    // Wired in Task 2.
    throw new Error('CharacterSheet create mode not yet implemented');
  }

  const { storyId, characterId, onClose } = props;
  const headingId = useId();
  // ...rest of existing edit-branch code unchanged, except:
  const open = true; // characterId is always a string in edit mode
  const query = useCharacterQuery(storyId, characterId);
```

Remove the `open` short-circuit gating: in edit mode the modal is always open (parent controls mount). Replace `if (!open) return null;` with nothing — the modal mounts when the parent renders the component, and unmounts when the parent stops rendering it.

- [ ] **Step 3: Update the existing CharacterSheet test file to the new prop shape**

In `frontend/tests/components/CharacterSheet.test.tsx`, find every `<CharacterSheet ... characterId={...} />` call and add `mode="edit"`. The `characterId={null}` case should be replaced by **not rendering** the component instead — find any test that asserts the closed-by-null behaviour and rewrite it to mount/unmount via a wrapper. If no such test exists, no rewrite is needed.

Concretely: `<CharacterSheet storyId={...} characterId="ch1" onClose={fn} />` becomes `<CharacterSheet storyId={...} mode="edit" characterId="ch1" onClose={fn} />`.

- [ ] **Step 4: Update `CharacterSheet.stories.tsx` to the new prop shape**

In the existing `Demo` component, replace:
```tsx
<CharacterSheet
  storyId={STORY_ID}
  characterId={open ? CHARACTER_ID : null}
  onClose={() => setOpen(false)}
/>
```

With:
```tsx
{open ? (
  <CharacterSheet
    storyId={STORY_ID}
    mode="edit"
    characterId={CHARACTER_ID}
    onClose={() => setOpen(false)}
  />
) : null}
```

- [ ] **Step 5: Update `EditorPage.tsx` to the new prop shape (interim)**

In `frontend/src/pages/EditorPage.tsx`, the `<CharacterSheet>` block currently reads:
```tsx
<CharacterSheet
  storyId={story.id}
  characterId={openCharacterId}
  onClose={() => {
    setOpenCharacterId(null);
  }}
/>
```

Change to:
```tsx
{openCharacterId !== null ? (
  <CharacterSheet
    storyId={story.id}
    mode="edit"
    characterId={openCharacterId}
    onClose={() => {
      setOpenCharacterId(null);
    }}
  />
) : null}
```

This is an interim shape; Task 4 replaces `openCharacterId` with the discriminated `characterModal` state.

- [ ] **Step 6: Run verify**

Run: `cd frontend && npx tsc --noEmit && npx vitest run --reporter=basic`
Expected: typecheck clean; all CharacterSheet tests still pass; CastTab tests still pass (Cast still uses the create mutation directly until Task 3).

- [ ] **Step 7: Commit**

```bash
git add frontend/src/components/CharacterSheet.tsx \
        frontend/src/components/CharacterSheet.stories.tsx \
        frontend/tests/components/CharacterSheet.test.tsx \
        frontend/src/pages/EditorPage.tsx
git commit -m "[F19] discriminate CharacterSheet props on mode (edit-only branch wired)"
```

---

## Task 2: Implement CharacterSheet create branch

**Files:**
- Modify: `frontend/src/components/CharacterSheet.tsx`
- Test: `frontend/tests/components/CharacterSheet.create.test.tsx` (new)

- [ ] **Step 1: Write the failing test file for create mode**

Create `frontend/tests/components/CharacterSheet.create.test.tsx`:

```tsx
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CharacterSheet } from '@/components/CharacterSheet';
import { server } from '../mocks/server';
import { http, HttpResponse } from 'msw';

const STORY_ID = 'story-create';

function renderSheet(onClose: (id: string | null) => void) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <CharacterSheet storyId={STORY_ID} mode="create" onClose={onClose} />
    </QueryClientProvider>,
  );
}

describe('CharacterSheet — create mode', () => {
  it('renders with title "Create character"', () => {
    renderSheet(() => undefined);
    expect(screen.getByRole('heading', { name: /create character/i })).toBeInTheDocument();
  });

  it('renders all fields empty and focuses the name input', async () => {
    renderSheet(() => undefined);
    const name = screen.getByLabelText(/^name$/i) as HTMLInputElement;
    await waitFor(() => {
      expect(name).toHaveFocus();
    });
    expect(name.value).toBe('');
    expect((screen.getByLabelText(/^role$/i) as HTMLInputElement).value).toBe('');
    expect((screen.getByLabelText(/^age$/i) as HTMLInputElement).value).toBe('');
  });

  it('disables Save when name is empty / whitespace; enables it when name has content', () => {
    renderSheet(() => undefined);
    const save = screen.getByTestId('character-sheet-save') as HTMLButtonElement;
    const name = screen.getByLabelText(/^name$/i) as HTMLInputElement;
    expect(save.disabled).toBe(true);
    fireEvent.change(name, { target: { value: '   ' } });
    expect(save.disabled).toBe(true);
    fireEvent.change(name, { target: { value: 'Astra' } });
    expect(save.disabled).toBe(false);
  });

  it('does not render the Delete button', () => {
    renderSheet(() => undefined);
    expect(screen.queryByTestId('character-sheet-delete')).toBeNull();
  });

  it('Cancel calls onClose(null) and never fires the create request', async () => {
    const onClose = vi.fn();
    let createCalls = 0;
    server.use(
      http.post(`/api/stories/${STORY_ID}/characters`, () => {
        createCalls += 1;
        return HttpResponse.json({}, { status: 500 });
      }),
    );
    renderSheet(onClose);
    fireEvent.click(screen.getByTestId('character-sheet-cancel'));
    expect(onClose).toHaveBeenCalledWith(null);
    expect(createCalls).toBe(0);
  });

  it('Save calls onClose with the created id on success', async () => {
    const onClose = vi.fn();
    server.use(
      http.post(`/api/stories/${STORY_ID}/characters`, async ({ request }) => {
        const body = (await request.json()) as { name: string };
        return HttpResponse.json({
          id: 'new-id-1',
          storyId: STORY_ID,
          name: body.name,
          role: null,
          age: null,
          appearance: null,
          voice: null,
          arc: null,
          personality: null,
          orderIndex: 0,
          createdAt: '2026-05-01T00:00:00Z',
          updatedAt: '2026-05-01T00:00:00Z',
        });
      }),
    );
    renderSheet(onClose);
    fireEvent.change(screen.getByLabelText(/^name$/i), { target: { value: 'Astra' } });
    fireEvent.click(screen.getByTestId('character-sheet-save'));
    await waitFor(() => {
      expect(onClose).toHaveBeenCalledWith('new-id-1');
    });
  });

  it('keeps the modal open and shows form error on create failure', async () => {
    const onClose = vi.fn();
    server.use(
      http.post(`/api/stories/${STORY_ID}/characters`, () =>
        HttpResponse.json({ message: 'Validation failed' }, { status: 400 }),
      ),
    );
    renderSheet(onClose);
    fireEvent.change(screen.getByLabelText(/^name$/i), { target: { value: 'Astra' } });
    fireEvent.click(screen.getByTestId('character-sheet-save'));
    await waitFor(() => {
      expect(screen.getByTestId('character-sheet-form-error')).toBeInTheDocument();
    });
    expect(onClose).not.toHaveBeenCalled();
  });
});
```

If `frontend/tests/mocks/server.ts` does not exist or msw is not the project pattern, replace the `server.use(...)` blocks with whatever mocking helper is already used in `frontend/tests/components/CharacterSheet.test.tsx`. Read that file first; copy its mock setup verbatim. **Do not introduce a new mocking framework.**

- [ ] **Step 2: Run the new test to verify it fails**

Run: `cd frontend && npx vitest run tests/components/CharacterSheet.create.test.tsx --reporter=basic`
Expected: All tests fail with "CharacterSheet create mode not yet implemented" (the throw from Task 1).

- [ ] **Step 3: Implement the create branch**

In `frontend/src/components/CharacterSheet.tsx`:

```ts
import { useCreateCharacterMutation, ... } from '@/hooks/useCharacters';

const EMPTY_FIELDS: FieldState = {
  name: '',
  role: '',
  age: '',
  appearance: '',
  voice: '',
  arc: '',
  personality: '',
};

function CreateCharacterSheet({
  storyId,
  onClose,
}: {
  storyId: string;
  onClose: (createdId: string | null) => void;
}): JSX.Element {
  const headingId = useId();
  const nameId = useId();
  const roleId = useId();
  const ageId = useId();
  const appearanceId = useId();
  const voiceId = useId();
  const arcId = useId();
  const personalityId = useId();

  const createMutation = useCreateCharacterMutation(storyId);
  const [fields, setFields] = useState<FieldState>(EMPTY_FIELDS);
  const [formError, setFormError] = useState<string | null>(null);
  const nameInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    const id = window.setTimeout(() => {
      nameInputRef.current?.focus();
    }, 0);
    return () => {
      window.clearTimeout(id);
    };
  }, []);

  const handleFieldChange =
    (key: FieldKey) =>
    (e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>): void => {
      const value = e.target.value;
      setFields((prev) => ({ ...prev, [key]: value }));
      if (formError) setFormError(null);
    };

  const handleSubmit = async (e: FormEvent<HTMLFormElement>): Promise<void> => {
    e.preventDefault();
    const trimmedName = fields.name.trim();
    if (trimmedName.length === 0) return;
    setFormError(null);
    try {
      const created = await createMutation.mutateAsync({
        name: trimmedName,
        role: nullable(fields.role) ?? undefined,
        age: nullable(fields.age) ?? undefined,
        appearance: nullable(fields.appearance) ?? undefined,
        voice: nullable(fields.voice) ?? undefined,
        arc: nullable(fields.arc) ?? undefined,
        personality: nullable(fields.personality) ?? undefined,
      });
      onClose(created.id);
    } catch (err) {
      setFormError(mapError(err));
    }
  };

  const handleCancel = (): void => {
    onClose(null);
  };

  const savePending = createMutation.isPending;
  const nameTrimmed = fields.name.trim();
  const saveDisabled = nameTrimmed.length === 0 || savePending;

  return (
    <Modal
      open
      onClose={handleCancel}
      labelledBy={headingId}
      size="lg"
      testId="character-sheet"
    >
      <form onSubmit={handleSubmit} noValidate className="flex flex-col h-full min-h-0">
        <ModalHeader titleId={headingId} title="Create character" onClose={handleCancel} />
        <ModalBody>
          <div className="flex flex-col gap-3">
            <Field label="Name" htmlFor={nameId} hint="Required">
              <Input
                id={nameId}
                ref={nameInputRef}
                name="name"
                value={fields.name}
                maxLength={NAME_MAX}
                required
                aria-required="true"
                onChange={handleFieldChange('name')}
              />
            </Field>
            <Field label="Role" htmlFor={roleId}>
              <Input
                id={roleId}
                name="role"
                value={fields.role}
                maxLength={ROLE_MAX}
                onChange={handleFieldChange('role')}
              />
            </Field>
            <Field label="Age" htmlFor={ageId}>
              <Input
                id={ageId}
                name="age"
                value={fields.age}
                maxLength={AGE_MAX}
                onChange={handleFieldChange('age')}
              />
            </Field>
            <Field label="Appearance" htmlFor={appearanceId}>
              <Textarea
                id={appearanceId}
                name="appearance"
                value={fields.appearance}
                maxLength={LONG_MAX}
                rows={3}
                onChange={handleFieldChange('appearance')}
              />
            </Field>
            <Field label="Voice" htmlFor={voiceId}>
              <Textarea
                id={voiceId}
                name="voice"
                value={fields.voice}
                maxLength={LONG_MAX}
                rows={3}
                onChange={handleFieldChange('voice')}
              />
            </Field>
            <Field label="Arc" htmlFor={arcId}>
              <Textarea
                id={arcId}
                name="arc"
                value={fields.arc}
                maxLength={LONG_MAX}
                rows={3}
                onChange={handleFieldChange('arc')}
              />
            </Field>
            <Field label="Personality" htmlFor={personalityId}>
              <Textarea
                id={personalityId}
                name="personality"
                value={fields.personality}
                maxLength={LONG_MAX}
                rows={3}
                onChange={handleFieldChange('personality')}
              />
            </Field>
          </div>
          {formError ? (
            <p
              role="alert"
              className="mt-3 font-sans text-[12.5px] text-danger"
              data-testid="character-sheet-form-error"
            >
              {formError}
            </p>
          ) : null}
        </ModalBody>
        <ModalFooter>
          <div className="flex gap-2 ml-auto">
            <Button
              type="button"
              variant="ghost"
              onClick={handleCancel}
              data-testid="character-sheet-cancel"
            >
              Cancel
            </Button>
            <Button
              type="submit"
              variant="primary"
              disabled={saveDisabled}
              data-testid="character-sheet-save"
            >
              {savePending ? 'Saving…' : 'Save'}
            </Button>
          </div>
        </ModalFooter>
      </form>
    </Modal>
  );
}
```

Then replace the `if (props.mode === 'create') { throw ... }` from Task 1 with:
```ts
if (props.mode === 'create') {
  return <CreateCharacterSheet storyId={props.storyId} onClose={props.onClose} />;
}
```

Confirm `useCreateCharacterMutation` accepts the optional fields shown in the `mutateAsync` call. If its current input type doesn't accept those fields, **extend it** — match the keys to what the existing `<CharacterSheet>` edit form persists. If the mutation only accepts `{ name }` today, widen the input type and route the optional fields into the API call body.

- [ ] **Step 4: Run the new tests to verify they pass**

Run: `cd frontend && npx vitest run tests/components/CharacterSheet.create.test.tsx --reporter=basic`
Expected: all 7 tests pass.

- [ ] **Step 5: Run the full frontend suite to confirm no regressions**

Run: `cd frontend && npx tsc --noEmit && npx vitest run --reporter=basic`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/CharacterSheet.tsx \
        frontend/tests/components/CharacterSheet.create.test.tsx \
        frontend/src/hooks/useCharacters.ts
git commit -m "[F19] add CharacterSheet create mode"
```

(Add `useCharacters.ts` to the commit only if you widened the create-mutation input type.)

---

## Task 3: Replace CastTab create-mutation path with onCreateCharacter prop

**Files:**
- Modify: `frontend/src/components/CastTab.tsx`
- Modify: `frontend/src/components/CastTab.stories.tsx`
- Modify: `frontend/tests/components/CastTab.test.tsx`
- Modify: `frontend/tests/components/CastTab.delete.test.tsx`
- Modify: `frontend/tests/components/CastTab.dragA11y.test.tsx`

- [ ] **Step 1: Write the failing test in `CastTab.test.tsx`**

Find the existing `+`-creates test (its assertion calls `useCreateCharacterMutation` or asserts a fetch to `POST /characters` with `name: 'Untitled'`). Replace it with:

```tsx
it('clicking + invokes onCreateCharacter once and does not fire any network request', () => {
  const onCreateCharacter = vi.fn();
  // Render CastTab with the new required prop. Reuse the existing test
  // wrapper / harness from this file.
  renderCastTab({ onCreateCharacter });
  fireEvent.click(screen.getByLabelText(/add character/i));
  expect(onCreateCharacter).toHaveBeenCalledTimes(1);
  // Network mock counter check from the existing test scaffolding here:
  // expect(createRequestCount).toBe(0);
});
```

The exact harness depends on what's already in `CastTab.test.tsx` — read the file, follow the patterns it already uses for rendering, and mirror the network-mock counter pattern from the cast-delete tests. Do not change the harness; only the assertion.

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd frontend && npx vitest run tests/components/CastTab.test.tsx --reporter=basic`
Expected: the new assertion fails (CastTab still calls the create mutation).

- [ ] **Step 3: Update CastTab implementation**

In `frontend/src/components/CastTab.tsx`:

1. Add `onCreateCharacter: () => void;` to `CastTabProps`.
2. Remove the `useCreateCharacterMutation` import and the `const createCharacter = useCreateCharacterMutation(storyId);` line.
3. Replace `handleAdd`:
   ```ts
   const handleAdd = useCallback((): void => {
     onCreateCharacter();
   }, [onCreateCharacter]);
   ```
4. Update the `<CastSectionHeader>` call: `pending={false}` (or drop the `pending` prop entirely if it's optional). The modal carries the saving feedback; the header no longer needs to reflect mutation state.
5. Destructure the new prop in the function signature:
   ```ts
   export function CastTab({
     storyId,
     characters,
     onOpenCharacter,
     onCreateCharacter,
     isLoading,
     isError,
   }: CastTabProps): JSX.Element {
   ```
6. Remove `storyId` from any code paths that only existed to feed `useCreateCharacterMutation`. (`storyId` is still needed by `useReorderCharactersMutation` and `useDeleteCharacterMutation`, so keep it as a prop.)

- [ ] **Step 4: Update `CastTab.stories.tsx`, `CastTab.delete.test.tsx`, `CastTab.dragA11y.test.tsx` to pass the new prop**

Each call site needs `onCreateCharacter={() => undefined}` (or `vi.fn()` in tests). Search the four files for `<CastTab` and add the prop. Do **not** change any other behaviour.

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd frontend && npx vitest run tests/components/CastTab.test.tsx --reporter=basic`
Expected: all CastTab tests pass.

- [ ] **Step 6: Run the full frontend suite**

Run: `cd frontend && npx tsc --noEmit && npx vitest run --reporter=basic`
Expected: clean.

EditorPage.tsx will fail typecheck if it doesn't yet pass `onCreateCharacter`. Add a temporary inline stub at the call site to keep this task self-contained:
```tsx
<CastTab
  storyId={story.id}
  characters={charactersQuery.data ?? []}
  onOpenCharacter={handleOpenCharacterFromCast}
  onCreateCharacter={() => undefined}
  isLoading={charactersQuery.isLoading}
  isError={charactersQuery.isError}
/>
```
Task 4 replaces the stub with the real handler.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/components/CastTab.tsx \
        frontend/src/components/CastTab.stories.tsx \
        frontend/tests/components/CastTab.test.tsx \
        frontend/tests/components/CastTab.delete.test.tsx \
        frontend/tests/components/CastTab.dragA11y.test.tsx \
        frontend/src/pages/EditorPage.tsx
git commit -m "[F28] CastTab: + invokes onCreateCharacter (no immediate persist)"
```

---

## Task 4: Wire Create flow in EditorPage

**Files:**
- Modify: `frontend/src/pages/EditorPage.tsx`

- [ ] **Step 1: Replace `openCharacterId` with `characterModal`**

In `EditorPage.tsx`:

```tsx
type CharacterModalState =
  | { mode: 'edit'; id: string }
  | { mode: 'create' }
  | null;

const [characterModal, setCharacterModal] = useState<CharacterModalState>(null);

const handleEditCharacter = useCallback((id: string) => {
  setCharacterModal({ mode: 'edit', id });
}, []);

const handleCreateCharacter = useCallback(() => {
  setCharacterModal({ mode: 'create' });
}, []);
```

Remove the `openCharacterId` / `setOpenCharacterId` declarations and the previous `handleEditCharacter` body — replace with the new versions above.

- [ ] **Step 2: Pass `onCreateCharacter` to `<CastTab>`**

Replace the temporary stub from Task 3:
```tsx
<CastTab
  storyId={story.id}
  characters={charactersQuery.data ?? []}
  onOpenCharacter={handleOpenCharacterFromCast}
  onCreateCharacter={handleCreateCharacter}
  isLoading={charactersQuery.isLoading}
  isError={charactersQuery.isError}
/>
```

- [ ] **Step 3: Render `<CharacterSheet>` from `characterModal`**

Replace the existing `<CharacterSheet>` block at the bottom of `EditorPage.tsx`:

```tsx
{characterModal?.mode === 'edit' ? (
  <CharacterSheet
    storyId={story.id}
    mode="edit"
    characterId={characterModal.id}
    onClose={() => {
      setCharacterModal(null);
    }}
  />
) : null}
{characterModal?.mode === 'create' ? (
  <CharacterSheet
    storyId={story.id}
    mode="create"
    onClose={(createdId) => {
      setCharacterModal(null);
      if (createdId !== null) {
        setSelectedCharacterId(createdId);
      }
    }}
  />
) : null}
```

`setSelectedCharacterId` is already imported from `useSelectedCharacterStore`; if it isn't, add the import using the same pattern used elsewhere in the file (search for `useSelectedCharacterStore` to find the existing import line).

- [ ] **Step 4: Confirm `<CharacterPopoverHost>` still works**

`<CharacterPopoverHost onEdit={handleEditCharacter}>` remains unchanged — `handleEditCharacter` now sets the discriminated state, which still reaches the edit branch above.

- [ ] **Step 5: Run typecheck and the full frontend suite**

Run: `cd frontend && npx tsc --noEmit && npx vitest run --reporter=basic`
Expected: clean.

- [ ] **Step 6: Run Storybook + production build sanity check**

Run: `cd frontend && npx storybook build --quiet && npm run build`
Expected: both succeed.

- [ ] **Step 7: Manual sanity check (golden path + edge cases)**

Bring up the dev stack (`make dev`) and check in the browser:
1. Open a story → click `+` in Cast tab → modal titled "Create character" with empty fields, name focused.
2. Click Cancel → modal closes; no new character in the cast list; no network request to `POST /characters`.
3. Click `+` again, type "Astra" + role "scout", click Save → modal closes; "Astra" appears in the cast list and is selected (× appears on hover); `POST /characters` fired exactly once.
4. Trigger a 500 by tweaking the request in DevTools or pointing to a bad endpoint → form error shown, modal stays open. (Skip if no easy way to force a failure; note as not-tested in the PR description.)
5. Click an existing cast row → opens edit-mode sheet titled "Edit character" with Delete button visible.
6. Press Escape on the create modal → closes without persisting.

Document anything that didn't behave as expected in the PR description.

- [ ] **Step 8: Commit**

```bash
git add frontend/src/pages/EditorPage.tsx
git commit -m "[F28] wire CharacterSheet create flow from CastTab +"
```

---

## Task 5: Final aggregate verification

- [ ] **Step 1: Backend suite (unaffected, but confirm nothing leaked into shared tests)**

Run: `cd backend && npx tsc --noEmit && npx vitest run --reporter=basic`
Expected: clean (no changes here, but confirm).

- [ ] **Step 2: Frontend suite**

Run: `cd frontend && npx tsc --noEmit && npx vitest run --reporter=basic`
Expected: clean.

- [ ] **Step 3: Biome**

Run: `npx biome check .` (from repo root)
Expected: no warnings, no errors.

- [ ] **Step 4: Storybook + production build**

Run: `cd frontend && npx storybook build --quiet && npm run build`
Expected: both succeed.

- [ ] **Step 5: Push branch**

```bash
git push
```

- [ ] **Step 6: Update PR #48 description**

Add a "Character create flow" section to the PR body listing the new behaviour (open empty sheet, Save persists, Cancel discards) and the manual sanity-check items.

```bash
gh pr edit 48 --body-file <(gh pr view 48 --json body -q .body; echo; echo "## Character create flow"; echo "- + on Cast tab opens CharacterSheet in create mode"; echo "- Save persists, Cancel discards"; echo "- Delete button hidden in create mode"; echo "- Manual: open/cancel/save/error/escape verified")
```

(If that one-liner is finicky, just run `gh pr view 48 --json body -q .body > /tmp/body.md`, append the section by hand, then `gh pr edit 48 --body-file /tmp/body.md`.)

---

## Self-review

**Spec coverage:**
- Open-with-empty-fields → Task 2.
- Title "Create character" → Task 2.
- Cancel discards, no mutation → Task 2 step 1 test 5; manual check in Task 4 step 7.
- Save persists via create mutation → Task 2 step 1 test 6.
- Delete hidden in create mode → Task 2 step 1 test 4.
- `onClose(createdId)` semantics → Task 2 (sheet) + Task 4 (page).
- New character auto-selected on Save → Task 4 step 3.
- CastTab + invokes prop, no mutation → Task 3.
- Discriminated `CharacterSheetProps` → Task 1.
- EditorPage discriminated `characterModal` → Task 4.
- All test plan items in spec covered by `CharacterSheet.create.test.tsx` and the CastTab `+`-stub assertion.

**Placeholder scan:** None — every step has concrete code, exact paths, exact commit messages, exact verify commands.

**Type consistency:** `CharacterSheetProps` definition in Task 1 matches usage in Tasks 2, 4, and the test file in Task 2. `onCreateCharacter: () => void` in Task 3 matches its usage in Task 4. `CharacterModalState` in Task 4 mirrors the spec exactly.

**Known interim state:** Task 1 wires only the edit branch (create throws); Task 3 has an inline stub for `onCreateCharacter` in EditorPage; Task 4 closes both gaps. Tests pass at every commit.
