import { type JSX, useState } from 'react';
import type { Message } from 'story-editor-shared';
import { Button, Textarea } from '@/design/primitives';
import { EditAction, MessageActions, RegenerateAction } from './primitives';

export interface UserMessageRowProps {
  message: Message;
  chapterTitle?: string | null;
  /** When true, the bubble renders an inline editable textarea. */
  isEditing?: boolean;
  /** Begin editing this message. Absent → no Edit/Resend actions (e.g. draft rows). */
  onBeginEdit?: (id: string) => void;
  onCancelEdit?: () => void;
  /** Called only when the text actually changed and is non-empty. */
  onConfirmEdit?: (id: string, content: string) => void;
  /** Resend (replay) from this user message. */
  onResend?: (id: string) => void;
  /** Disables Edit/Resend (e.g. a turn is streaming). */
  actionsDisabled?: boolean;
}

function chapterCaption(chapterTitle: string | null | undefined): string {
  if (chapterTitle && chapterTitle.length > 0) return chapterTitle.toUpperCase();
  return '—';
}

function EditBox({
  initial,
  onConfirm,
  onCancel,
}: {
  initial: string;
  onConfirm: (text: string) => void;
  onCancel: () => void;
}): JSX.Element {
  const [draft, setDraft] = useState(initial);
  const trimmed = draft.trim();
  const unchanged = draft === initial;
  const canConfirm = trimmed.length > 0;
  const confirm = (): void => {
    if (!canConfirm) return;
    if (unchanged) {
      onCancel(); // no-op edit — exit without a PATCH
      return;
    }
    onConfirm(draft);
  };
  return (
    <div className="flex flex-col items-end gap-1 w-full">
      <Textarea
        // biome-ignore lint/a11y/noAutofocus: editing affordance focuses its field on open
        autoFocus
        aria-label="Edit message"
        font="sans"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        className="bg-[var(--accent-soft)] rounded-[var(--radius-lg)] ml-auto w-[80%]"
        rows={2}
      />
      <div className="flex items-center gap-1.5">
        <Button variant="ghost" size="sm" onClick={onCancel}>
          Cancel
        </Button>
        <Button variant="primary" size="sm" disabled={!canConfirm} onClick={confirm}>
          Confirm
        </Button>
      </div>
    </div>
  );
}

export function UserMessageRow({
  message,
  chapterTitle,
  isEditing,
  onBeginEdit,
  onCancelEdit,
  onConfirmEdit,
  onResend,
  actionsDisabled,
}: UserMessageRowProps): JSX.Element {
  const text = message.content;
  const attachment = message.attachmentJson;
  const hasAttachmentText =
    attachment !== null &&
    typeof attachment.selectionText === 'string' &&
    attachment.selectionText.length > 0;
  const showActions = onBeginEdit !== undefined || onResend !== undefined;

  return (
    <li className="flex flex-col items-end" data-message-id={message.id} data-role="user">
      {hasAttachmentText && attachment !== null ? (
        <div
          className="pl-3 border-l-2 border-[var(--line-2)] mb-1 ml-auto max-w-[80%]"
          data-testid={`attachment-${message.id}`}
        >
          <span className="text-[10px] uppercase tracking-[.08em] font-mono text-[var(--ink-4)] block">
            {`FROM CH. ${chapterCaption(chapterTitle)}`}
          </span>
          <blockquote className="font-serif italic text-[13px] text-[var(--ink-3)] line-clamp-2">
            {attachment.selectionText}
          </blockquote>
        </div>
      ) : null}

      {isEditing ? (
        <EditBox
          initial={text}
          onConfirm={(t) => onConfirmEdit?.(message.id, t)}
          onCancel={() => onCancelEdit?.()}
        />
      ) : (
        <>
          <div className="bg-[var(--accent-soft)] rounded-[var(--radius-lg)] px-3 py-2 text-[13px] font-sans ml-auto max-w-[80%] whitespace-pre-wrap">
            {text}
          </div>
          {showActions ? (
            <MessageActions>
              {onBeginEdit ? (
                <EditAction onClick={() => onBeginEdit(message.id)} disabled={actionsDisabled} />
              ) : null}
              {onResend ? (
                <RegenerateAction
                  label="Resend"
                  onClick={() => onResend(message.id)}
                  disabled={actionsDisabled}
                />
              ) : null}
            </MessageActions>
          ) : null}
        </>
      )}
    </li>
  );
}
