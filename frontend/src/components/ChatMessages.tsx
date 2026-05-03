import type { JSX } from 'react';
import { InlineErrorBanner } from '@/components/InlineErrorBanner';
import { MessageCitations } from '@/components/MessageCitations';
import { ThinkingDots } from '@/design/ThinkingDots';
import {
  type ChatMessage,
  type ChatMessageAttachment,
  useChatMessagesQuery,
} from '@/hooks/useChat';
import { type ChatDraft, useChatDraftStore } from '@/store/chatDraft';

/**
 * [F39] Chat messages list.
 *
 * Renders the message log inside the F38 ChatPanel `messagesBody` slot.
 *
 *  - User: 13px sans pill bubble in `--accent-soft`, right-aligned, with an
 *    optional attachment preview above (serif italic quote + mono "FROM CH. N"
 *    caption + 2px left border).
 *  - Assistant: 13.5/1.55 serif body with a 2px `--ai` left border, no
 *    background. A meta row underneath holds Copy / Regenerate buttons and a
 *    mono `412 tok · 1.8s` figure when both metrics are present.
 *  - Suggestion chips (empty state only here): 8/10 sans 12.5px with icon +
 *    label.
 *  - Dashed context chip at the end of the list (mono 11px) summarising the
 *    attached chapter / character / token count.
 *
 * [F50] mounts `<MessageCitations />` inside the `data-citations-slot`
 * wrapper under each assistant message. The slot remains in the DOM
 * for every assistant bubble so the per-message-id invariant is stable;
 * the citations component itself returns null when there are no
 * citations to render.
 *
 * `system` messages are skipped — they exist server-side for prompt
 * construction and are not part of the user-facing transcript.
 */

export type SuggestionKind = 'rewrite' | 'describe' | 'expand';

export interface ChatMessagesProps {
  /** When `null`, renders the empty / suggestion-chip state. */
  chatId: string | null;
  /** Used for the trailing context chip and for "FROM CH." attachment captions. */
  chapterTitle?: string | null;
  attachedCharacterCount?: number;
  attachedTokenCount?: number;
  onCopyMessage?: (id: string) => void;
  onRegenerateMessage?: (id: string) => void;
  onPickSuggestion?: (kind: SuggestionKind) => void;
  /** When set, renders an InlineErrorBanner at the end of the message list. */
  sendError?: Error | null;
  /** Wired to the banner's Retry button. */
  onRetrySend?: () => void;
}

/**
 * `12` → `12`, `1234` → `1.2k`, `0` → `0`. Used by the context chip's
 * "tokens attached to context" label so a thousand+ count compresses.
 */
export function formatTokens(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '0';
  if (n < 1000) return String(Math.trunc(n));
  return `${(n / 1000).toFixed(1)}k`;
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
  attachment: ChatMessageAttachment,
  chapterTitle: string | null | undefined,
): string {
  if (chapterTitle && chapterTitle.length > 0) return chapterTitle.toUpperCase();
  if (attachment.chapterId !== undefined && attachment.chapterId.length > 0) {
    // No chapter number/title available — fall back to a stable placeholder
    // so the caption row layout doesn't collapse. F50 will revisit when
    // attachments carry chapter labels directly.
    return '—';
  }
  return '—';
}

function WandIcon(): JSX.Element {
  return (
    <svg
      width="13"
      height="13"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M15 4V2" />
      <path d="M15 16v-2" />
      <path d="M8 9h2" />
      <path d="M20 9h2" />
      <path d="M17.8 11.8 19 13" />
      <path d="M15 9h0" />
      <path d="M17.8 6.2 19 5" />
      <path d="m3 21 9-9" />
      <path d="M12.2 6.2 11 5" />
    </svg>
  );
}

function SparklesIcon(): JSX.Element {
  return (
    <svg
      width="13"
      height="13"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="m12 3-1.9 5.8a2 2 0 0 1-1.3 1.3L3 12l5.8 1.9a2 2 0 0 1 1.3 1.3L12 21l1.9-5.8a2 2 0 0 1 1.3-1.3L21 12l-5.8-1.9a2 2 0 0 1-1.3-1.3Z" />
    </svg>
  );
}

function ExpandIcon(): JSX.Element {
  return (
    <svg
      width="13"
      height="13"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M21 21H3" />
      <path d="m6 8 6-6 6 6" />
      <path d="M12 2v15" />
    </svg>
  );
}

function CopyIcon(): JSX.Element {
  return (
    <svg
      width="11"
      height="11"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </svg>
  );
}

function RefreshIcon(): JSX.Element {
  return (
    <svg
      width="11"
      height="11"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M21 12a9 9 0 1 1-3-6.7L21 8" />
      <path d="M21 3v5h-5" />
    </svg>
  );
}

const SUGGESTION_DEFS: ReadonlyArray<{
  kind: SuggestionKind;
  label: string;
  Icon: () => JSX.Element;
}> = [
  { kind: 'rewrite', label: 'Rewrite this passage', Icon: WandIcon },
  { kind: 'describe', label: 'Describe a scene', Icon: SparklesIcon },
  { kind: 'expand', label: 'Expand the next paragraph', Icon: ExpandIcon },
];

interface ContextChipProps {
  chapterTitle: string | null | undefined;
  attachedCharacterCount: number | undefined;
  attachedTokenCount: number | undefined;
}

function ContextChip({
  chapterTitle,
  attachedCharacterCount,
  attachedTokenCount,
}: ContextChipProps): JSX.Element {
  const chars = attachedCharacterCount ?? 0;
  const toks = formatTokens(attachedTokenCount ?? 0);
  const chap = chapterTitle && chapterTitle.length > 0 ? chapterTitle : 'No chapter';
  return (
    <div
      className="context-chip mt-2 mx-3 self-center px-2.5 py-1.5 rounded-[var(--radius)] border border-dashed border-line-2 text-[11px] font-mono text-ink-4 text-center"
      data-testid="context-chip"
    >
      {`${chap} · ${String(chars)} characters · ${toks} tokens attached to context`}
    </div>
  );
}

interface UserMessageProps {
  message: ChatMessage;
  chapterTitle: string | null | undefined;
}

function UserMessage({ message, chapterTitle }: UserMessageProps): JSX.Element {
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
          className="attachment-preview pl-3 border-l-2 border-line-2 mb-1 ml-auto max-w-[80%]"
          data-testid={`attachment-${message.id}`}
        >
          <span className="text-[10px] uppercase tracking-[.08em] font-mono text-ink-4 block">
            {`FROM CH. ${chapterCaption(attachment, chapterTitle)}`}
          </span>
          <blockquote className="font-serif italic text-[13px] text-ink-3 line-clamp-2">
            {attachment.selectionText}
          </blockquote>
        </div>
      ) : null}
      <div className="user-bubble bg-[var(--accent-soft)] rounded-[var(--radius-lg)] px-3 py-2 text-[13px] font-sans ml-auto max-w-[80%] whitespace-pre-wrap">
        {text}
      </div>
    </li>
  );
}

interface AssistantMessageProps {
  message: ChatMessage;
  onCopy: ((id: string) => void) | undefined;
  onRegenerate: ((id: string) => void) | undefined;
}

function AssistantMessage({ message, onCopy, onRegenerate }: AssistantMessageProps): JSX.Element {
  const text = getMessageText(message.contentJson);
  const showStats = message.tokens !== null && message.latencyMs !== null;
  const handleCopy = (): void => {
    // Best-effort clipboard write. jsdom provides a stub; tests spy on this.
    const clip: unknown = (navigator as { clipboard?: { writeText?: (s: string) => unknown } })
      .clipboard;
    if (
      clip !== null &&
      typeof clip === 'object' &&
      'writeText' in clip &&
      typeof (clip as { writeText: unknown }).writeText === 'function'
    ) {
      void (clip as { writeText: (s: string) => unknown }).writeText(text);
    }
    if (onCopy) onCopy(message.id);
  };
  const handleRegenerate = (): void => {
    if (onRegenerate) onRegenerate(message.id);
  };

  return (
    <li className="flex flex-col items-start" data-role="assistant">
      <div
        className="assistant-bubble pl-3 border-l-2 border-[var(--ai)] font-serif text-[13.5px] leading-[1.55] text-ink whitespace-pre-wrap max-w-full"
        data-message-id={message.id}
        data-testid={`assistant-${message.id}`}
      >
        {text}
      </div>
      <div className="meta-row flex items-center gap-2 mt-1.5 text-[11px] text-ink-4 font-mono">
        <button
          type="button"
          className="icon-btn"
          aria-label="Copy"
          title="Copy"
          onClick={handleCopy}
        >
          <CopyIcon />
        </button>
        <button
          type="button"
          className="icon-btn"
          aria-label="Regenerate"
          title="Regenerate"
          onClick={handleRegenerate}
        >
          <RefreshIcon />
        </button>
        {showStats ? (
          <span data-testid={`stats-${message.id}`}>
            {`${String(message.tokens ?? 0)} tok · ${((message.latencyMs ?? 0) / 1000).toFixed(
              1,
            )}s`}
          </span>
        ) : null}
      </div>
      {/*
        [F50] Citations slot. The wrapper stays in the DOM for every
        assistant bubble (so the F39 mount-point invariant remains
        testable). When the message has citations, `<MessageCitations />`
        renders the disclosure inline; otherwise the slot is empty.
      */}
      <div data-citations-slot data-message-id={message.id}>
        <MessageCitations citations={message.citationsJson} />
      </div>
    </li>
  );
}

interface DraftPairProps {
  draft: ChatDraft;
  chapterTitle: string | null | undefined;
}

function DraftPair({ draft, chapterTitle }: DraftPairProps): JSX.Element {
  const hasAttachment = draft.attachment !== null && draft.attachment.selectionText.length > 0;
  return (
    <>
      <li className="flex flex-col items-end" data-role="user" data-testid="draft-user">
        {hasAttachment && draft.attachment !== null ? (
          <div className="attachment-preview pl-3 border-l-2 border-line-2 mb-1 ml-auto max-w-[80%]">
            <span className="text-[10px] uppercase tracking-[.08em] font-mono text-ink-4 block">
              {`FROM CH. ${chapterCaption(draft.attachment, chapterTitle)}`}
            </span>
            <blockquote className="font-serif italic text-[13px] text-ink-3 line-clamp-2">
              {draft.attachment.selectionText}
            </blockquote>
          </div>
        ) : null}
        <div className="user-bubble bg-[var(--accent-soft)] rounded-[var(--radius-lg)] px-3 py-2 text-[13px] font-sans ml-auto max-w-[80%] whitespace-pre-wrap">
          {draft.userContent}
        </div>
      </li>
      <li className="flex flex-col items-start" data-role="assistant" data-testid="draft-assistant">
        {draft.status === 'error' && draft.error !== null ? (
          <div className="w-full">
            <InlineErrorBanner error={draft.error} />
          </div>
        ) : draft.status === 'thinking' ||
          (draft.status === 'streaming' && draft.assistantText.length === 0) ? (
          <div
            className="assistant-bubble pl-3 border-l-2 border-[var(--ai)] py-1"
            data-testid="draft-thinking"
          >
            <ThinkingDots />
          </div>
        ) : (
          <div className="assistant-bubble pl-3 border-l-2 border-[var(--ai)] font-serif text-[13.5px] leading-[1.55] text-ink whitespace-pre-wrap max-w-full">
            {draft.assistantText}
          </div>
        )}
      </li>
    </>
  );
}

export function ChatMessages({
  chatId,
  chapterTitle,
  attachedCharacterCount,
  attachedTokenCount,
  onCopyMessage,
  onRegenerateMessage,
  onPickSuggestion,
  sendError,
  onRetrySend,
}: ChatMessagesProps): JSX.Element {
  const query = useChatMessagesQuery(chatId);
  const draft = useChatDraftStore((s) => s.draft);
  const draftForThisChat = draft !== null && draft.chatId === chatId ? draft : null;

  if (chatId === null) {
    return (
      <div className="flex flex-col gap-3 p-4 text-center" data-testid="chat-empty">
        <p className="text-[13px] text-ink-3 font-sans">Start a conversation</p>
        <div className="suggestion-chips flex flex-col gap-1.5 items-stretch">
          {SUGGESTION_DEFS.map(({ kind, label, Icon }) => (
            <button
              key={kind}
              type="button"
              className="suggestion-chip inline-flex items-center gap-1.5 px-2.5 py-2 rounded-[var(--radius)] text-[12.5px] font-sans bg-[var(--bg-sunken)] hover:bg-[var(--surface-hover)] text-left"
              onClick={() => {
                if (onPickSuggestion) onPickSuggestion(kind);
              }}
              data-testid={`suggestion-${kind}`}
            >
              <span className="text-ink-4 flex-shrink-0">
                <Icon />
              </span>
              <span className="text-ink-2">{label}</span>
            </button>
          ))}
        </div>
      </div>
    );
  }

  if (query.isLoading) {
    return (
      <div className="px-4 py-6 text-[12px] text-ink-4" data-testid="chat-loading">
        Loading messages…
      </div>
    );
  }

  if (query.isError) {
    return (
      <div
        className="px-4 py-6 text-[12px] text-[var(--danger)]"
        role="alert"
        data-testid="chat-error"
      >
        Could not load messages.
      </div>
    );
  }

  const messages = query.data ?? [];
  const visible = messages.filter((m) => m.role !== 'system');

  const bannerError = sendError != null ? { code: null, message: sendError.message } : null;

  return (
    <div className="flex flex-col">
      <ol className="flex flex-col gap-3 p-3" role="log" aria-label="Chat messages">
        {visible.map((m) => {
          if (m.role === 'user') {
            return <UserMessage key={m.id} message={m} chapterTitle={chapterTitle} />;
          }
          return (
            <AssistantMessage
              key={m.id}
              message={m}
              onCopy={onCopyMessage}
              onRegenerate={onRegenerateMessage}
            />
          );
        })}
        {draftForThisChat ? (
          <DraftPair draft={draftForThisChat} chapterTitle={chapterTitle} />
        ) : null}
      </ol>
      <ContextChip
        chapterTitle={chapterTitle}
        attachedCharacterCount={attachedCharacterCount}
        attachedTokenCount={attachedTokenCount}
      />
      {bannerError ? (
        <div className="px-3 pb-3">
          <InlineErrorBanner error={bannerError} onRetry={onRetrySend} />
        </div>
      ) : null}
    </div>
  );
}
