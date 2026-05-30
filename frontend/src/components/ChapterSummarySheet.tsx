import type { JSX } from 'react';
import { type ChangeEvent, type FormEvent, useCallback, useEffect, useId, useState } from 'react';
import type { ChapterSummary } from 'story-editor-shared';
import {
  Button,
  Field,
  Modal,
  ModalBody,
  ModalFooter,
  ModalHeader,
  Textarea,
} from '@/design/primitives';
import { useUpdateChapterSummaryMutation } from '@/hooks/useChapterSummary';
import { ApiError } from '@/lib/api';

export interface ChapterSummarySheetProps {
  chapterId: string;
  storyId: string;
  open: boolean;
  onClose: () => void;
  initialSummary?: ChapterSummary;
}

const EMPTY: ChapterSummary = { events: '', stateAtEnd: '', openThreads: '' };

function mapError(err: unknown): string {
  if (err instanceof ApiError) return err.message;
  if (err instanceof Error) return err.message;
  return 'Something went wrong. Please try again.';
}

export function ChapterSummarySheet({
  chapterId,
  storyId,
  open,
  onClose,
  initialSummary,
}: ChapterSummarySheetProps): JSX.Element | null {
  if (!open) return null;

  return (
    <ChapterSummarySheetInner
      chapterId={chapterId}
      storyId={storyId}
      onClose={onClose}
      initialSummary={initialSummary ?? EMPTY}
    />
  );
}

function ChapterSummarySheetInner({
  chapterId,
  storyId,
  onClose,
  initialSummary,
}: {
  chapterId: string;
  storyId: string;
  onClose: () => void;
  initialSummary: ChapterSummary;
}): JSX.Element {
  const headingId = useId();
  const eventsId = useId();
  const stateAtEndId = useId();
  const openThreadsId = useId();

  const mutation = useUpdateChapterSummaryMutation(chapterId, storyId);
  const [fields, setFields] = useState<ChapterSummary>(initialSummary);
  useEffect(() => {
    setFields(initialSummary ?? EMPTY);
  }, [initialSummary]);
  const [formError, setFormError] = useState<string | null>(null);

  const handleChange =
    (key: keyof ChapterSummary) =>
    (e: ChangeEvent<HTMLTextAreaElement>): void => {
      setFields((prev) => ({ ...prev, [key]: e.target.value }));
      if (formError) setFormError(null);
    };

  const handleCancel = useCallback((): void => {
    onClose();
  }, [onClose]);

  const handleSubmit = async (e: FormEvent<HTMLFormElement>): Promise<void> => {
    e.preventDefault();
    setFormError(null);
    try {
      await mutation.mutateAsync(fields);
      onClose();
    } catch (err) {
      setFormError(mapError(err));
    }
  };

  const savePending = mutation.isPending;

  return (
    <Modal
      open
      onClose={handleCancel}
      labelledBy={headingId}
      size="lg"
      testId="chapter-summary-sheet"
    >
      <form onSubmit={handleSubmit} noValidate className="flex flex-col h-full min-h-0">
        <ModalHeader titleId={headingId} title="Edit chapter summary" onClose={handleCancel} />
        <ModalBody>
          <div className="flex flex-col gap-3">
            <Field label="Events" htmlFor={eventsId}>
              <Textarea
                id={eventsId}
                name="events"
                value={fields.events}
                rows={4}
                onChange={handleChange('events')}
              />
            </Field>
            <Field label="State at end" htmlFor={stateAtEndId}>
              <Textarea
                id={stateAtEndId}
                name="stateAtEnd"
                value={fields.stateAtEnd}
                rows={4}
                onChange={handleChange('stateAtEnd')}
              />
            </Field>
            <Field label="Open threads" htmlFor={openThreadsId}>
              <Textarea
                id={openThreadsId}
                name="openThreads"
                value={fields.openThreads}
                rows={4}
                onChange={handleChange('openThreads')}
              />
            </Field>
          </div>
          {formError ? (
            <p
              role="alert"
              className="mt-3 font-sans text-[12.5px] text-danger"
              data-testid="chapter-summary-sheet-form-error"
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
              data-testid="chapter-summary-sheet-cancel"
            >
              Cancel
            </Button>
            <Button
              type="submit"
              variant="primary"
              disabled={savePending}
              data-testid="chapter-summary-sheet-save"
            >
              {savePending ? 'Saving…' : 'Save'}
            </Button>
          </div>
        </ModalFooter>
      </form>
    </Modal>
  );
}
