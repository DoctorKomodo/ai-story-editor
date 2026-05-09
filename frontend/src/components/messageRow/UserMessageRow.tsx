import type { JSX } from 'react';
import type { ChatMessage } from '@/hooks/useChat';

export interface UserMessageRowProps {
  message: ChatMessage;
  chapterTitle?: string | null;
}

function getMessageText(contentJson: unknown): string {
  if (typeof contentJson === 'string') return contentJson;
  if (contentJson === null || contentJson === undefined) return '';
  try {
    return JSON.stringify(contentJson);
  } catch {
    return '';
  }
}

function chapterCaption(
  attachment: { chapterId?: string },
  chapterTitle: string | null | undefined,
): string {
  if (chapterTitle && chapterTitle.length > 0) return chapterTitle.toUpperCase();
  if (attachment.chapterId !== undefined && attachment.chapterId.length > 0) {
    return '—';
  }
  return '—';
}

export function UserMessageRow({ message, chapterTitle }: UserMessageRowProps): JSX.Element {
  const text = getMessageText(message.contentJson);
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
            {`FROM CH. ${chapterCaption(attachment, chapterTitle)}`}
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
