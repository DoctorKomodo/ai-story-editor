import type { JSX } from 'react';
import type { Message } from 'story-editor-shared';

export interface UserMessageRowProps {
  message: Message;
  chapterTitle?: string | null;
}

function chapterCaption(chapterTitle: string | null | undefined): string {
  if (chapterTitle && chapterTitle.length > 0) return chapterTitle.toUpperCase();
  return '—';
}

export function UserMessageRow({ message, chapterTitle }: UserMessageRowProps): JSX.Element {
  const text = message.content;
  const attachment = message.attachmentJson;
  const hasAttachmentText =
    attachment !== null &&
    typeof attachment.selectionText === 'string' &&
    attachment.selectionText.length > 0;

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
      <div className="bg-[var(--accent-soft)] rounded-[var(--radius-lg)] px-3 py-2 text-[13px] font-sans ml-auto max-w-[80%] whitespace-pre-wrap">
        {text}
      </div>
    </li>
  );
}
