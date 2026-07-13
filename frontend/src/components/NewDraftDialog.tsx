import type { JSX } from 'react';
import { useState } from 'react';
import type { Draft } from 'story-editor-shared';
import {
  Button,
  CheckboxField,
  Field,
  Input,
  Modal,
  ModalBody,
  ModalFooter,
  ModalHeader,
  RadioGroup,
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
  const copyChatsId = useId();
  const [mode, setMode] = useState<'fork' | 'blank'>('fork');
  const [name, setName] = useState('');
  const [copyChats, setCopyChats] = useState(false);
  const createDraft = useCreateDraftMutation();

  const forkLabel = viewedIsActive ? 'Fork current draft' : 'Fork active draft';
  const placeholder = positionalDraftLabel(draftCount);

  const handleCreate = (): void => {
    const trimmed = name.trim();
    createDraft.mutate(
      {
        chapterId,
        storyId,
        input: {
          mode,
          ...(trimmed.length > 0 ? { label: trimmed } : {}),
          ...(mode === 'fork' && copyChats ? { copyChats: true } : {}),
        },
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
        <RadioGroup
          name="new-draft-mode"
          legend="Starting point"
          srOnlyLegend
          value={mode}
          onChange={setMode}
          options={[
            { value: 'fork', label: forkLabel },
            { value: 'blank', label: 'Start blank' },
          ]}
        />
        {mode === 'fork' ? (
          <div className="pl-6">
            <CheckboxField
              id={copyChatsId}
              label="Also copy chats & scenes"
              checked={copyChats}
              disabled={createDraft.isPending}
              onChange={setCopyChats}
              testId="new-draft-copy-chats"
            />
          </div>
        ) : null}
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
