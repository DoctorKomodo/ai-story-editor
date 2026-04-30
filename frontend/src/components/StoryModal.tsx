import type { JSX } from 'react';
import { type FormEvent, useEffect, useId, useRef, useState } from 'react';
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
  type StoryInput,
  useCreateStoryMutation,
  useUpdateStoryMutation,
} from '@/hooks/useStories';
import { ApiError } from '@/lib/api';

export type StoryModalMode = 'create' | 'edit';

export interface StoryModalInitial {
  id?: string;
  title?: string;
  genre?: string | null;
  synopsis?: string | null;
  worldNotes?: string | null;
}

export interface StoryModalProps {
  mode: StoryModalMode;
  open: boolean;
  onClose: () => void;
  initial?: StoryModalInitial;
}

const TITLE_MAX = 500;
const GENRE_MAX = 200;
const SYNOPSIS_MAX = 10_000;
const WORLD_NOTES_MAX = 50_000;

function nullable(v: string): string | null {
  const trimmed = v.trim();
  return trimmed.length === 0 ? null : trimmed;
}

function mapError(err: unknown): string {
  if (err instanceof ApiError) return err.message;
  if (err instanceof Error) return err.message;
  return 'Something went wrong. Please try again.';
}

function diffForPatch(
  initial: StoryModalInitial,
  current: { title: string; genre: string; synopsis: string; worldNotes: string },
): Partial<StoryInput> {
  const payload: Partial<StoryInput> = {};

  const initialTitle = initial.title ?? '';
  if (current.title.trim() !== initialTitle.trim()) {
    payload.title = current.title.trim();
  }

  const initialGenre = initial.genre ?? null;
  const nextGenre = nullable(current.genre);
  if (nextGenre !== initialGenre) payload.genre = nextGenre;

  const initialSynopsis = initial.synopsis ?? null;
  const nextSynopsis = nullable(current.synopsis);
  if (nextSynopsis !== initialSynopsis) payload.synopsis = nextSynopsis;

  const initialWorldNotes = initial.worldNotes ?? null;
  const nextWorldNotes = nullable(current.worldNotes);
  if (nextWorldNotes !== initialWorldNotes) payload.worldNotes = nextWorldNotes;

  return payload;
}

export function StoryModal({ mode, open, onClose, initial }: StoryModalProps): JSX.Element | null {
  const titleId = useId();
  const genreId = useId();
  const synopsisId = useId();
  const worldNotesId = useId();
  const headingId = useId();
  const titleErrorId = useId();

  const [title, setTitle] = useState(initial?.title ?? '');
  const [genre, setGenre] = useState(initial?.genre ?? '');
  const [synopsis, setSynopsis] = useState(initial?.synopsis ?? '');
  const [worldNotes, setWorldNotes] = useState(initial?.worldNotes ?? '');
  const [titleTouched, setTitleTouched] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const titleInputRef = useRef<HTMLInputElement | null>(null);

  const createMutation = useCreateStoryMutation();
  const updateMutation = useUpdateStoryMutation();
  const pending = mode === 'create' ? createMutation.isPending : updateMutation.isPending;

  // Reset fields whenever the modal is re-opened or the initial payload changes.
  useEffect(() => {
    if (!open) return;
    setTitle(initial?.title ?? '');
    setGenre(initial?.genre ?? '');
    setSynopsis(initial?.synopsis ?? '');
    setWorldNotes(initial?.worldNotes ?? '');
    setTitleTouched(false);
    setFormError(null);
  }, [open, initial]);

  // Focus the title input on open.
  useEffect(() => {
    if (!open) return;
    const id = window.setTimeout(() => {
      titleInputRef.current?.focus();
    }, 0);
    return () => {
      window.clearTimeout(id);
    };
  }, [open]);

  if (!open) return null;

  const trimmedTitle = title.trim();
  const titleInvalid = trimmedTitle.length === 0 || trimmedTitle.length > TITLE_MAX;
  const submitDisabled = titleInvalid || pending;
  const showTitleError = titleTouched && titleInvalid;

  const handleSubmit = async (e: FormEvent<HTMLFormElement>): Promise<void> => {
    e.preventDefault();
    setTitleTouched(true);
    setFormError(null);
    if (titleInvalid) return;

    try {
      if (mode === 'create') {
        const payload: StoryInput = {
          title: trimmedTitle,
          genre: nullable(genre),
          synopsis: nullable(synopsis),
          worldNotes: nullable(worldNotes),
        };
        await createMutation.mutateAsync(payload);
      } else {
        if (!initial?.id) {
          setFormError('Cannot save: missing story id.');
          return;
        }
        const diff = diffForPatch(initial, { title, genre, synopsis, worldNotes });
        if (Object.keys(diff).length === 0) {
          onClose();
          return;
        }
        await updateMutation.mutateAsync({ id: initial.id, input: diff });
      }
      onClose();
    } catch (err) {
      setFormError(mapError(err));
    }
  };

  const heading = mode === 'create' ? 'New Story' : 'Edit Story';
  const submitLabel = pending
    ? mode === 'create'
      ? 'Creating…'
      : 'Saving…'
    : mode === 'create'
      ? 'Create story'
      : 'Save changes';

  return (
    <Modal open={open} onClose={onClose} labelledBy={headingId} size="md" testId="story-modal">
      <form onSubmit={handleSubmit} noValidate className="flex flex-col h-full min-h-0">
        <ModalHeader titleId={headingId} title={heading} onClose={onClose} />

        <ModalBody>
          <div className="flex flex-col gap-3">
            <Field
              label="Title"
              htmlFor={titleId}
              hint="Required"
              error={showTitleError ? <span id={titleErrorId}>Title is required.</span> : null}
            >
              <Input
                id={titleId}
                ref={titleInputRef}
                name="title"
                value={title}
                maxLength={TITLE_MAX}
                required
                aria-required="true"
                invalid={showTitleError}
                aria-describedby={showTitleError ? titleErrorId : undefined}
                onChange={(e) => {
                  setTitle(e.target.value);
                  if (formError) setFormError(null);
                }}
                onBlur={() => {
                  setTitleTouched(true);
                }}
              />
            </Field>

            <Field label="Genre" htmlFor={genreId}>
              <Input
                id={genreId}
                name="genre"
                value={genre}
                maxLength={GENRE_MAX}
                onChange={(e) => {
                  setGenre(e.target.value);
                }}
              />
            </Field>

            <Field label="Synopsis" htmlFor={synopsisId}>
              <Textarea
                id={synopsisId}
                name="synopsis"
                value={synopsis}
                maxLength={SYNOPSIS_MAX}
                rows={3}
                onChange={(e) => {
                  setSynopsis(e.target.value);
                }}
              />
            </Field>

            <Field label="World notes" htmlFor={worldNotesId}>
              <Textarea
                id={worldNotesId}
                name="worldNotes"
                value={worldNotes}
                maxLength={WORLD_NOTES_MAX}
                rows={5}
                onChange={(e) => {
                  setWorldNotes(e.target.value);
                }}
              />
            </Field>
          </div>

          {formError ? (
            <p
              role="alert"
              className="mt-3 font-sans text-[12.5px] text-danger"
              data-testid="story-modal-form-error"
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
              onClick={onClose}
              data-testid="story-modal-cancel"
            >
              Cancel
            </Button>
            <Button
              type="submit"
              variant="primary"
              disabled={submitDisabled}
              data-testid="story-modal-submit"
            >
              {submitLabel}
            </Button>
          </div>
        </ModalFooter>
      </form>
    </Modal>
  );
}
