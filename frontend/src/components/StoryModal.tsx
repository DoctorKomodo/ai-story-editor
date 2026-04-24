import { type FormEvent, type MouseEvent, useEffect, useId, useRef, useState } from 'react';
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

/**
 * Compute the PATCH payload as the diff between `initial` and current field
 * values: we only send fields the user actually changed. Missing from the
 * object ⇒ leave untouched server-side. Explicit `null` ⇒ clear the value.
 */
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
    // Defer a tick so the element is definitely mounted.
    const id = window.setTimeout(() => {
      titleInputRef.current?.focus();
    }, 0);
    return () => {
      window.clearTimeout(id);
    };
  }, [open]);

  // Escape to close.
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', handler);
    return () => {
      window.removeEventListener('keydown', handler);
    };
  }, [open, onClose]);

  if (!open) return null;

  const trimmedTitle = title.trim();
  const titleInvalid = trimmedTitle.length === 0 || trimmedTitle.length > TITLE_MAX;
  const submitDisabled = titleInvalid || pending;

  const handleBackdropClick = (e: MouseEvent<HTMLDivElement>): void => {
    if (e.target === e.currentTarget) onClose();
  };

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
        // If nothing changed, just close — saves a pointless round trip.
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
    <div
      role="presentation"
      onMouseDown={handleBackdropClick}
      className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 px-4"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={headingId}
        className="bg-white rounded-md shadow-lg w-full max-w-lg"
      >
        <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-4 p-6">
          <h2 id={headingId} className="text-xl font-semibold">
            {heading}
          </h2>

          <label htmlFor={titleId} className="flex flex-col gap-1 text-sm">
            <span className="font-medium">
              Title<span aria-hidden="true"> *</span>
            </span>
            <input
              id={titleId}
              ref={titleInputRef}
              name="title"
              value={title}
              maxLength={TITLE_MAX}
              required
              aria-required="true"
              aria-invalid={titleTouched && titleInvalid}
              aria-describedby={titleTouched && titleInvalid ? `${titleId}-error` : undefined}
              onChange={(e) => {
                setTitle(e.target.value);
                if (formError) setFormError(null);
              }}
              onBlur={() => {
                setTitleTouched(true);
              }}
              className="border border-neutral-300 rounded px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            {titleTouched && titleInvalid ? (
              <span id={`${titleId}-error`} className="text-sm text-red-600">
                Title is required.
              </span>
            ) : null}
          </label>

          <label htmlFor={genreId} className="flex flex-col gap-1 text-sm">
            <span className="font-medium">Genre</span>
            <input
              id={genreId}
              name="genre"
              value={genre}
              maxLength={GENRE_MAX}
              onChange={(e) => {
                setGenre(e.target.value);
              }}
              className="border border-neutral-300 rounded px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </label>

          <label htmlFor={synopsisId} className="flex flex-col gap-1 text-sm">
            <span className="font-medium">Synopsis</span>
            <textarea
              id={synopsisId}
              name="synopsis"
              value={synopsis}
              maxLength={SYNOPSIS_MAX}
              rows={3}
              onChange={(e) => {
                setSynopsis(e.target.value);
              }}
              className="border border-neutral-300 rounded px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 resize-y"
            />
          </label>

          <label htmlFor={worldNotesId} className="flex flex-col gap-1 text-sm">
            <span className="font-medium">World notes</span>
            <textarea
              id={worldNotesId}
              name="worldNotes"
              value={worldNotes}
              maxLength={WORLD_NOTES_MAX}
              rows={5}
              onChange={(e) => {
                setWorldNotes(e.target.value);
              }}
              className="border border-neutral-300 rounded px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 resize-y"
            />
          </label>

          {formError ? (
            <p role="alert" className="text-sm text-red-600">
              {formError}
            </p>
          ) : null}

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="bg-neutral-100 text-neutral-800 rounded px-3 py-2 font-medium hover:bg-neutral-200 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitDisabled}
              className="bg-blue-600 text-white rounded px-3 py-2 font-medium disabled:opacity-50 disabled:cursor-not-allowed hover:bg-blue-700 transition-colors"
            >
              {submitLabel}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
