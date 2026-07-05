import type { JSX } from 'react';
import { useState } from 'react';
import type { Draft } from 'story-editor-shared';
import {
  Button,
  Field,
  Input,
  Modal,
  ModalBody,
  ModalFooter,
  ModalHeader,
  useId,
} from '@/design/primitives';
import { positionalDraftLabel, useCreateDraftMutation } from '@/hooks/useDrafts';

/**
 * Whether the fork radio may say "Fork current draft" (spec D5). The API
 * always forks the target chapter's ACTIVE draft, so "current" is honest only
 * when the dialog targets the chapter open in the editor AND the draft being
 * viewed there is that chapter's active draft. For any other chapter no draft
 * of the target is in view at all, so the copy must say "active".
 */
export function deriveViewedIsActive(args: {
  dialogChapterId: string;
  activeChapterId: string | null;
  viewedDraftId: string | null;
  activeDraftId: string | null;
}): boolean {
  return (
    args.dialogChapterId === args.activeChapterId &&
    args.viewedDraftId !== null &&
    args.viewedDraftId === args.activeDraftId
  );
}

export interface NewDraftDialogProps {
  chapterId: string;
  storyId: string;
  /** Current number of drafts — the name placeholder is the NEXT positional label. */
  draftCount: number;
  /**
   * True when the fork source (always the chapter's ACTIVE draft — the API
   * has no source parameter) is also the draft being viewed. When false the
   * radio says "Fork active draft" so the UI never promises a copy the API
   * can't make (spec D5).
   */
  viewedIsActive: boolean;
  onClose: () => void;
  onCreated: (draft: Draft) => void;
}

export function NewDraftDialog({
  chapterId,
  storyId,
  draftCount,
  viewedIsActive,
  onClose,
  onCreated,
}: NewDraftDialogProps): JSX.Element {
  const titleId = useId();
  const nameId = useId();
  const [mode, setMode] = useState<'fork' | 'blank'>('fork');
  const [name, setName] = useState('');
  const createDraft = useCreateDraftMutation();

  const forkLabel = viewedIsActive ? 'Fork current draft' : 'Fork active draft';
  const placeholder = positionalDraftLabel(draftCount);

  const handleCreate = (): void => {
    const trimmed = name.trim();
    createDraft.mutate(
      {
        chapterId,
        storyId,
        input: { mode, ...(trimmed.length > 0 ? { label: trimmed } : {}) },
      },
      {
        onSuccess: (draft) => {
          onClose();
          onCreated(draft);
        },
      },
    );
  };

  return (
    <Modal
      open
      onClose={onClose}
      labelledBy={titleId}
      size="sm"
      testId="new-draft-dialog"
      dismissable={!createDraft.isPending}
    >
      <ModalHeader
        titleId={titleId}
        title="New draft"
        onClose={onClose}
        closeDisabled={createDraft.isPending}
      />
      <ModalBody className="flex flex-col gap-3">
        <fieldset className="flex flex-col gap-1.5 border-0 p-0 m-0">
          <legend className="sr-only">Starting point</legend>
          <label className="flex items-center gap-2 font-sans text-[13px] text-ink cursor-pointer">
            <input
              type="radio"
              name="new-draft-mode"
              checked={mode === 'fork'}
              onChange={() => {
                setMode('fork');
              }}
            />
            {forkLabel}
          </label>
          <label className="flex items-center gap-2 font-sans text-[13px] text-ink cursor-pointer">
            <input
              type="radio"
              name="new-draft-mode"
              checked={mode === 'blank'}
              onChange={() => {
                setMode('blank');
              }}
            />
            Start blank
          </label>
        </fieldset>
        <Field label="Name (optional)" htmlFor={nameId}>
          <Input
            id={nameId}
            value={name}
            placeholder={placeholder}
            disabled={createDraft.isPending}
            onChange={(e) => {
              setName(e.target.value);
            }}
          />
        </Field>
        {createDraft.isError ? (
          <p role="alert" className="font-sans text-[12.5px] text-danger m-0">
            Could not create the draft — try again.
          </p>
        ) : null}
      </ModalBody>
      <ModalFooter>
        <Button variant="ghost" onClick={onClose} disabled={createDraft.isPending}>
          Cancel
        </Button>
        <Button variant="primary" onClick={handleCreate} loading={createDraft.isPending}>
          Create draft
        </Button>
      </ModalFooter>
    </Modal>
  );
}
