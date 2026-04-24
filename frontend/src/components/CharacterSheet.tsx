import type { JSX } from 'react';
import {
  type ChangeEvent,
  type FormEvent,
  type MouseEvent,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
} from 'react';
import {
  type Character,
  type UpdateCharacterPatch,
  useCharacterQuery,
  useDeleteCharacterMutation,
  useUpdateCharacterMutation,
} from '@/hooks/useCharacters';
import { ApiError } from '@/lib/api';

/**
 * F19 — Character sheet modal. Full "edit all fields" surface for a single
 * character; opened from the sidebar (F18's `<CharacterList>`).
 *
 * Scope boundary:
 * - F37 (character popover) is the alternate entry point from the mockup
 *   and renders a compact subset; this modal stays as the full-fat editor.
 * - F46 (user settings modal) is a separate concern with its own component.
 *
 * Styling is deliberately minimal Tailwind — the mockup-fidelity Cast tab
 * redesign belongs to F27.
 */
export interface CharacterSheetProps {
  storyId: string;
  /** `null` closes the modal. */
  characterId: string | null;
  onClose: () => void;
}

const NAME_MAX = 200;
const ROLE_MAX = 200;
const AGE_MAX = 50;
const LONG_MAX = 5000;

type FieldKey = 'name' | 'role' | 'age' | 'appearance' | 'voice' | 'arc' | 'personality';

interface FieldState {
  name: string;
  role: string;
  age: string;
  appearance: string;
  voice: string;
  arc: string;
  personality: string;
}

function toState(c: Character): FieldState {
  return {
    name: c.name,
    role: c.role ?? '',
    age: c.age ?? '',
    appearance: c.appearance ?? '',
    voice: c.voice ?? '',
    arc: c.arc ?? '',
    personality: c.personality ?? '',
  };
}

function nullable(v: string): string | null {
  const trimmed = v.trim();
  return trimmed.length === 0 ? null : trimmed;
}

function mapError(err: unknown): string {
  if (err instanceof ApiError) return err.message;
  if (err instanceof Error) return err.message;
  return 'Something went wrong. Please try again.';
}

/**
 * Diff the current field state against the originally-loaded character and
 * produce a minimal PATCH body:
 * - Unchanged fields are omitted entirely (left untouched server-side).
 * - A cleared optional field becomes explicit `null`.
 * - `name` is always required; it is included whenever it differs from the
 *   original (and the submit is blocked upstream when it's blank).
 */
function diffPatch(original: Character, current: FieldState): UpdateCharacterPatch {
  const out: UpdateCharacterPatch = {};

  const trimmedName = current.name.trim();
  if (trimmedName !== original.name) out.name = trimmedName;

  const checks: Array<{
    key: Exclude<FieldKey, 'name'>;
    currentRaw: string;
    initial: string | null;
  }> = [
    { key: 'role', currentRaw: current.role, initial: original.role },
    { key: 'age', currentRaw: current.age, initial: original.age },
    { key: 'appearance', currentRaw: current.appearance, initial: original.appearance },
    { key: 'voice', currentRaw: current.voice, initial: original.voice },
    { key: 'arc', currentRaw: current.arc, initial: original.arc },
    { key: 'personality', currentRaw: current.personality, initial: original.personality },
  ];
  for (const { key, currentRaw, initial } of checks) {
    const next = nullable(currentRaw);
    if (next !== initial) out[key] = next;
  }
  return out;
}

export function CharacterSheet({
  storyId,
  characterId,
  onClose,
}: CharacterSheetProps): JSX.Element | null {
  const headingId = useId();
  const nameId = useId();
  const roleId = useId();
  const ageId = useId();
  const appearanceId = useId();
  const voiceId = useId();
  const arcId = useId();
  const personalityId = useId();

  const open = characterId !== null;

  const query = useCharacterQuery(open ? storyId : null, characterId);
  const updateMutation = useUpdateCharacterMutation(storyId);
  const deleteMutation = useDeleteCharacterMutation(storyId);

  const [fields, setFields] = useState<FieldState | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const nameInputRef = useRef<HTMLInputElement | null>(null);

  // Seed fields from the fetched character. Re-runs whenever the query
  // returns fresh data (e.g. after a different characterId opens).
  useEffect(() => {
    if (query.data) {
      setFields(toState(query.data));
    }
  }, [query.data]);

  // Reset transient UI state each time a new character is opened.
  useEffect(() => {
    if (!open) {
      setFields(null);
      setFormError(null);
      setConfirmOpen(false);
      setDeleteError(null);
      return;
    }
    setFormError(null);
    setConfirmOpen(false);
    setDeleteError(null);
  }, [open]);

  // Focus the name input once fields are available.
  useEffect(() => {
    if (!open || fields === null) return;
    const id = window.setTimeout(() => {
      nameInputRef.current?.focus();
    }, 0);
    return () => {
      window.clearTimeout(id);
    };
  }, [open, fields]);

  // Escape: close confirm first, otherwise close main.
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      if (confirmOpen) {
        setConfirmOpen(false);
        setDeleteError(null);
        return;
      }
      onClose();
    };
    window.addEventListener('keydown', handler);
    return () => {
      window.removeEventListener('keydown', handler);
    };
  }, [open, confirmOpen, onClose]);

  const handleBackdropClick = useCallback(
    (e: MouseEvent<HTMLDivElement>): void => {
      // Click-outside on main backdrop is a no-op while the confirm dialog
      // is up — confirm must be explicit.
      if (confirmOpen) return;
      if (e.target === e.currentTarget) onClose();
    },
    [confirmOpen, onClose],
  );

  const handleFieldChange = useCallback(
    (key: FieldKey) =>
      (e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>): void => {
        const value = e.target.value;
        setFields((prev) => (prev === null ? prev : { ...prev, [key]: value }));
        if (formError) setFormError(null);
      },
    [formError],
  );

  const handleSubmit = async (e: FormEvent<HTMLFormElement>): Promise<void> => {
    e.preventDefault();
    if (!fields || !query.data || !characterId) return;
    if (fields.name.trim().length === 0) return;
    setFormError(null);
    const patch = diffPatch(query.data, fields);
    // No changes → just close; saves a round trip.
    if (Object.keys(patch).length === 0) {
      onClose();
      return;
    }
    try {
      await updateMutation.mutateAsync({ id: characterId, patch });
      onClose();
    } catch (err) {
      setFormError(mapError(err));
    }
  };

  const handleConfirmDelete = async (): Promise<void> => {
    if (!characterId) return;
    setDeleteError(null);
    try {
      await deleteMutation.mutateAsync({ id: characterId });
      onClose();
    } catch (err) {
      setDeleteError(mapError(err));
    }
  };

  if (!open) return null;

  const savePending = updateMutation.isPending;
  const deletePending = deleteMutation.isPending;
  const nameTrimmed = fields?.name.trim() ?? '';
  const saveDisabled =
    query.isLoading || fields === null || nameTrimmed.length === 0 || savePending;

  return (
    <div
      role="presentation"
      onMouseDown={handleBackdropClick}
      className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 px-4"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={headingId}
        className="bg-white rounded-md shadow-lg w-full max-w-2xl max-h-[90vh] overflow-y-auto"
      >
        <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-4 p-6">
          <h2 id={headingId} className="text-xl font-semibold">
            Edit character
          </h2>

          {query.isLoading ? (
            <p role="status" aria-live="polite" className="text-sm text-neutral-500">
              Loading character…
            </p>
          ) : null}

          {query.isError ? (
            <p role="alert" className="text-sm text-red-600">
              Could not load character
              {query.error instanceof Error && query.error.message
                ? `: ${query.error.message}`
                : ''}
            </p>
          ) : null}

          {fields !== null ? (
            <>
              <label htmlFor={nameId} className="flex flex-col gap-1 text-sm">
                <span className="font-medium">
                  Name<span aria-hidden="true"> *</span>
                </span>
                <input
                  id={nameId}
                  ref={nameInputRef}
                  name="name"
                  type="text"
                  value={fields.name}
                  maxLength={NAME_MAX}
                  required
                  aria-required="true"
                  onChange={handleFieldChange('name')}
                  className="border border-neutral-300 rounded px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </label>

              <label htmlFor={roleId} className="flex flex-col gap-1 text-sm">
                <span className="font-medium">Role</span>
                <input
                  id={roleId}
                  name="role"
                  type="text"
                  value={fields.role}
                  maxLength={ROLE_MAX}
                  onChange={handleFieldChange('role')}
                  className="border border-neutral-300 rounded px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </label>

              <label htmlFor={ageId} className="flex flex-col gap-1 text-sm">
                <span className="font-medium">Age</span>
                <input
                  id={ageId}
                  name="age"
                  type="text"
                  value={fields.age}
                  maxLength={AGE_MAX}
                  onChange={handleFieldChange('age')}
                  className="border border-neutral-300 rounded px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </label>

              <label htmlFor={appearanceId} className="flex flex-col gap-1 text-sm">
                <span className="font-medium">Appearance</span>
                <textarea
                  id={appearanceId}
                  name="appearance"
                  value={fields.appearance}
                  maxLength={LONG_MAX}
                  rows={3}
                  onChange={handleFieldChange('appearance')}
                  className="border border-neutral-300 rounded px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 resize-y"
                />
              </label>

              <label htmlFor={voiceId} className="flex flex-col gap-1 text-sm">
                <span className="font-medium">Voice</span>
                <textarea
                  id={voiceId}
                  name="voice"
                  value={fields.voice}
                  maxLength={LONG_MAX}
                  rows={3}
                  onChange={handleFieldChange('voice')}
                  className="border border-neutral-300 rounded px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 resize-y"
                />
              </label>

              <label htmlFor={arcId} className="flex flex-col gap-1 text-sm">
                <span className="font-medium">Arc</span>
                <textarea
                  id={arcId}
                  name="arc"
                  value={fields.arc}
                  maxLength={LONG_MAX}
                  rows={3}
                  onChange={handleFieldChange('arc')}
                  className="border border-neutral-300 rounded px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 resize-y"
                />
              </label>

              <label htmlFor={personalityId} className="flex flex-col gap-1 text-sm">
                <span className="font-medium">Personality</span>
                <textarea
                  id={personalityId}
                  name="personality"
                  value={fields.personality}
                  maxLength={LONG_MAX}
                  rows={3}
                  onChange={handleFieldChange('personality')}
                  className="border border-neutral-300 rounded px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 resize-y"
                />
              </label>
            </>
          ) : null}

          {formError ? (
            <p role="alert" className="text-sm text-red-600">
              {formError}
            </p>
          ) : null}

          <div className="flex items-center justify-between gap-2 pt-2">
            <button
              type="button"
              onClick={() => {
                setConfirmOpen(true);
                setDeleteError(null);
              }}
              disabled={query.isLoading || savePending || deletePending}
              className="bg-red-600 text-white rounded px-3 py-2 font-medium disabled:opacity-50 disabled:cursor-not-allowed hover:bg-red-700 transition-colors"
            >
              Delete
            </button>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={onClose}
                className="bg-neutral-100 text-neutral-800 rounded px-3 py-2 font-medium hover:bg-neutral-200 transition-colors"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={saveDisabled}
                className="bg-blue-600 text-white rounded px-3 py-2 font-medium disabled:opacity-50 disabled:cursor-not-allowed hover:bg-blue-700 transition-colors"
              >
                {savePending ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        </form>
      </div>

      {confirmOpen ? (
        <div
          role="presentation"
          onMouseDown={(e) => {
            // Click-outside the confirm is a no-op (must be explicit).
            e.stopPropagation();
          }}
          className="fixed inset-0 bg-black/40 flex items-center justify-center z-[60] px-4"
        >
          <div
            role="alertdialog"
            aria-modal="true"
            aria-labelledby={`${headingId}-confirm`}
            className="bg-white rounded-md shadow-lg w-full max-w-sm"
          >
            <div className="flex flex-col gap-4 p-6">
              <h3 id={`${headingId}-confirm`} className="text-lg font-semibold">
                Delete this character?
              </h3>
              <p className="text-sm text-neutral-700">
                Delete this character? This cannot be undone.
              </p>
              {deleteError ? (
                <p role="alert" className="text-sm text-red-600">
                  {deleteError}
                </p>
              ) : null}
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => {
                    setConfirmOpen(false);
                    setDeleteError(null);
                  }}
                  disabled={deletePending}
                  className="bg-neutral-100 text-neutral-800 rounded px-3 py-2 font-medium hover:bg-neutral-200 transition-colors disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => {
                    void handleConfirmDelete();
                  }}
                  disabled={deletePending}
                  className="bg-red-600 text-white rounded px-3 py-2 font-medium disabled:opacity-50 disabled:cursor-not-allowed hover:bg-red-700 transition-colors"
                >
                  {deletePending ? 'Deleting…' : 'Confirm'}
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
