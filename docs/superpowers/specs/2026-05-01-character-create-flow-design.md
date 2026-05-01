# Character Create Flow — Design

**Date:** 2026-05-01
**Branch:** `feat/cast-ui` (tweak to PR #48)
**Scope:** Frontend-only. No DB / migrations / backend changes.

## Goal

Clicking the `+` in the Cast tab opens `<CharacterSheet>` in a "Create character" mode. The character is only persisted when **Save** is clicked. **Cancel** discards. This replaces the current behaviour where `+` immediately creates an "Untitled" character via mutation.

## Behaviour

1. **Open:** Click `+` (`<CastSectionHeader>`) → `<CharacterSheet>` opens with no character loaded, title **"Create character"**, all fields empty, name input auto-focused, Save disabled until name is non-empty.
2. **Cancel / Escape / backdrop:** Close the modal. Nothing is persisted. No mutation fires.
3. **Save:** Submit calls `useCreateCharacterMutation` with the form values. On success, select the new character (`setSelectedCharacterId(created.id)`) and close. On error, show inline `formError` and keep the modal open for retry.
4. **Delete button:** Hidden in create mode. Nothing is persisted yet, so the button has no target. Cancel is the only discard affordance.

## Component contract

`CharacterSheetProps` becomes a discriminated union:

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

- `mode === 'edit'` (existing behaviour): `useCharacterQuery` loads the character; Save uses `useUpdateCharacterMutation` with a diff patch; Delete button shown.
- `mode === 'create'`: no query; `fields` initialised to an all-empty `FieldState`; title `"Create character"`; Delete button not rendered; Save uses `useCreateCharacterMutation`; `onClose(createdId)` carries the new id (or `null` for cancel).

The legacy `characterId: string | null` "open when not null" pattern is replaced by mode-driven open/close.

## EditorPage state

Replace `openCharacterId: string | null` with a single discriminated state:

```ts
const [characterModal, setCharacterModal] = useState<
  | { mode: 'edit'; id: string }
  | { mode: 'create' }
  | null
>(null);
```

- `handleOpenCharacterFromCast(id, anchorEl)` → `setCharacterModal({ mode: 'edit', id })` (anchor element retained for restore-focus on close, same as today).
- `handleCreateCharacter()` → `setCharacterModal({ mode: 'create' })`.
- Edit close: `setCharacterModal(null)`.
- Create close: `(createdId) => { setCharacterModal(null); if (createdId) setSelectedCharacterId(createdId); }`.

## CastTab change

- New required prop: `onCreateCharacter: () => void`.
- `handleAdd` becomes `props.onCreateCharacter()`. The `createCharacter.mutate({ name: 'Untitled' })` path is removed.
- `useCreateCharacterMutation` is no longer used by CastTab.
- The `pending` state on `<CastSectionHeader>` is removed — the modal itself carries the saving feedback. `<CastSectionHeader>` keeps its `pending` prop for now (other call sites may use it later); CastTab passes `pending={false}`.

## Files touched

- `frontend/src/components/CastTab.tsx` — add `onCreateCharacter` prop, drop create mutation.
- `frontend/src/components/CastTab.stories.tsx` — stub `onCreateCharacter`.
- `frontend/tests/components/CastTab.test.tsx` — update `+` assertion.
- `frontend/tests/components/CastTab.delete.test.tsx` — pass `onCreateCharacter` stub (no behavioural change).
- `frontend/tests/components/CastTab.dragA11y.test.tsx` — pass `onCreateCharacter` stub (no behavioural change).
- `frontend/src/components/CharacterSheet.tsx` — discriminated props, create branch.
- `frontend/src/components/CharacterSheet.stories.tsx` — add a Create variant.
- `frontend/tests/components/CharacterSheet.test.tsx` — adapt existing tests to the `mode: 'edit'` shape.
- `frontend/tests/components/CharacterSheet.create.test.tsx` — new file, create-mode coverage.
- `frontend/src/pages/EditorPage.tsx` — switch to `characterModal` state, wire `onCreateCharacter`.

## Test plan

**Create-mode tests (new file, `CharacterSheet.create.test.tsx`):**
1. Renders with title "Create character".
2. All fields render empty; name input is focused.
3. Save is disabled when name is empty / whitespace; enabled when name has content.
4. Submitting calls the create mutation with `{ storyId, name, ...optional fields }` (only fields that are non-empty are passed; empty optional fields are omitted or sent as `null` consistent with edit-mode `nullable()`).
5. On mutation success, `onClose` is called with the new id.
6. Cancel button calls `onClose(null)` and never invokes the create mutation.
7. On mutation error, modal stays open and `formError` is shown.
8. Delete button is not rendered.

**Edit-mode tests:** existing assertions kept; only the prop shape (`mode: 'edit'`, `characterId: string`) changes.

**CastTab tests:**
1. Clicking `+` calls `onCreateCharacter` once. The previous assertion (mutation fired with `name: 'Untitled'`) is removed.
2. Drag / delete / select tests are unaffected; they pass a no-op `onCreateCharacter` stub.

## Out of scope

- Backend / API / schema changes.
- Changing what fields are settable on create (the create endpoint already accepts the same field set; we just expose them in the form).
- Editor-page refactors beyond the modal-state swap.
- Storybook re-design of CharacterSheet.

## Open questions

None. Delete-button visibility, focus behaviour, and `onClose` carrying the new id are all locked above.
