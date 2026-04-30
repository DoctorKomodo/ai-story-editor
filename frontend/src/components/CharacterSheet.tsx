import type { JSX } from 'react';
import {
  type ChangeEvent,
  type FormEvent,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
} from 'react';
import {
  Button,
  Field,
  Input,
  Modal,
  ModalBody,
  ModalFooter,
  ModalHeader,
  Textarea,
} from '@/design/primitives';
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
 * Bundle-3 port: chrome and form fields are now composed from
 * `@/design/primitives` (Modal / ModalHeader / ModalBody / ModalFooter /
 * Field / Input / Textarea / Button). The nested confirm dialog uses a
 * second Modal so backdrop / escape / focus management is centralised.
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

  useEffect(() => {
    if (query.data) {
      setFields(toState(query.data));
    }
  }, [query.data]);

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
    <Modal
      open={open}
      onClose={onClose}
      labelledBy={headingId}
      size="lg"
      dismissable={!confirmOpen}
      testId="character-sheet"
    >
      <form onSubmit={handleSubmit} noValidate className="flex flex-col h-full min-h-0">
        <ModalHeader titleId={headingId} title="Edit character" onClose={onClose} />

        <ModalBody>
          {query.isLoading ? (
            <p
              role="status"
              aria-live="polite"
              className="font-sans text-[12.5px] text-ink-3"
              data-testid="character-sheet-loading"
            >
              Loading character…
            </p>
          ) : null}

          {query.isError ? (
            <p
              role="alert"
              className="font-sans text-[12.5px] text-danger"
              data-testid="character-sheet-load-error"
            >
              Could not load character
              {query.error instanceof Error && query.error.message
                ? `: ${query.error.message}`
                : ''}
            </p>
          ) : null}

          {fields !== null ? (
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
          ) : null}

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
          <Button
            type="button"
            variant="danger"
            onClick={() => {
              setConfirmOpen(true);
              setDeleteError(null);
            }}
            disabled={query.isLoading || savePending || deletePending}
            data-testid="character-sheet-delete"
          >
            Delete
          </Button>
          <div className="flex gap-2 ml-auto">
            <Button
              type="button"
              variant="ghost"
              onClick={onClose}
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

      <Modal
        open={confirmOpen}
        onClose={() => {
          setConfirmOpen(false);
          setDeleteError(null);
        }}
        labelledBy={`${headingId}-confirm`}
        size="sm"
        role="alertdialog"
        testId="character-sheet-confirm"
      >
        <ModalHeader titleId={`${headingId}-confirm`} title="Delete this character?" />
        <ModalBody>
          <p className="font-serif text-[13.5px] leading-[1.55] text-ink-2">
            Delete this character? This cannot be undone.
          </p>
          {deleteError ? (
            <p
              role="alert"
              className="mt-3 font-sans text-[12.5px] text-danger"
              data-testid="character-sheet-delete-error"
            >
              {deleteError}
            </p>
          ) : null}
        </ModalBody>
        <ModalFooter>
          <Button
            type="button"
            variant="ghost"
            onClick={() => {
              setConfirmOpen(false);
              setDeleteError(null);
            }}
            disabled={deletePending}
            data-testid="character-sheet-confirm-cancel"
          >
            Cancel
          </Button>
          <Button
            type="button"
            variant="danger"
            onClick={() => {
              void handleConfirmDelete();
            }}
            disabled={deletePending}
            data-testid="character-sheet-confirm-delete"
          >
            {deletePending ? 'Deleting…' : 'Confirm'}
          </Button>
        </ModalFooter>
      </Modal>
    </Modal>
  );
}
