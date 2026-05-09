import {
  type JSX,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
} from 'react';
import { InlineErrorBanner } from '@/components/InlineErrorBanner';
import {
  type ChatDraftAttachment,
  type ChatDraftError,
  type ChatDraftStatus,
  useChatDraftStore,
} from '@/store/chatDraft';
import { type ChatMessage, useChatMessagesQuery } from '@/hooks/useChat';

export type TranscriptRow =
  | { kind: 'persisted'; message: ChatMessage }
  | {
      kind: 'draft-user';
      userContent: string;
      attachment: ChatDraftAttachment | null;
    }
  | {
      kind: 'draft-assistant';
      assistantText: string;
      status: ChatDraftStatus;
      error: ChatDraftError | null;
    };

export interface TranscriptViewProps {
  chatId: string | null;
  emptyState: ReactNode;
  sendError?: Error | null;
  onRetrySend?: () => void;
  /** Disables the InlineErrorBanner's Retry button (banner-retry's `isDispatching` window + `mutation.isPending`). */
  disableRetrySend?: boolean;
  /** Render-prop receives the merged row stream. */
  children: (rows: TranscriptRow[]) => ReactNode;
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

function buildRows(
  messages: ChatMessage[],
  draft: { userContent: string; attachment: ChatDraftAttachment | null; assistantText: string; status: ChatDraftStatus; error: ChatDraftError | null } | undefined,
): TranscriptRow[] {
  const rows: TranscriptRow[] = messages.map((m) => ({ kind: 'persisted', message: m }));
  if (!draft) return rows;

  // Suppress draft-user when EITHER:
  //   (a) draft.userContent === '' — retry path (mutateAsync with retry: true
  //       calls start() with empty userContent; the user message is already
  //       persisted on the backend, so a synthetic empty bubble would be ugly).
  //   (b) the trailing persisted user message's content matches draft.userContent
  //       — mid-stream-error → banner-retry path, where the post-refetch cache
  //       catches up while the error draft is still in the store. Without this,
  //       there's a brief duplicate-user flicker.
  // Either rule on its own leaves a duplicate-user flicker in the other case.
  const trailingUser = [...messages].reverse().find((m) => m.role === 'user');
  const trailingUserMatches =
    trailingUser !== undefined &&
    getMessageText(trailingUser.contentJson) === draft.userContent;
  const skipDraftUser = draft.userContent === '' || trailingUserMatches;
  if (!skipDraftUser) {
    rows.push({
      kind: 'draft-user',
      userContent: draft.userContent,
      attachment: draft.attachment,
    });
  }
  if (draft.status !== 'error') {
    rows.push({
      kind: 'draft-assistant',
      assistantText: draft.assistantText,
      status: draft.status,
      error: draft.error,
    });
  }
  return rows;
}

export function TranscriptView({
  chatId,
  emptyState,
  sendError,
  onRetrySend,
  disableRetrySend,
  children,
}: TranscriptViewProps): JSX.Element {
  const query = useChatMessagesQuery(chatId);
  const draft = useChatDraftStore((s) => (chatId !== null ? s.drafts[chatId] : undefined));

  const messages = query.data ?? [];
  const rows = useMemo(() => buildRows(messages, draft), [messages, draft]);

  const transcriptRef = useRef<HTMLElement>(null);
  const stickToBottomRef = useRef(true);

  useEffect(() => {
    stickToBottomRef.current = true;
  }, [chatId]);

  const handleScroll = useCallback(() => {
    const el = transcriptRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    stickToBottomRef.current = distanceFromBottom < 50;
  }, []);

  useEffect(() => {
    if (stickToBottomRef.current && transcriptRef.current) {
      transcriptRef.current.scrollTop = transcriptRef.current.scrollHeight;
    }
  }, [rows]);

  // ── Render branches ──────────────────────────────────────────────────
  if (chatId === null) {
    return (
      <section
        ref={transcriptRef}
        className="flex-1 min-h-0 overflow-y-auto p-3"
        data-testid="transcript-empty"
        onScroll={handleScroll}
      >
        {emptyState}
      </section>
    );
  }

  if (query.isLoading) {
    return (
      <section
        ref={transcriptRef}
        className="flex-1 min-h-0 overflow-y-auto p-3 text-[12px] text-ink-4"
        data-testid="transcript-loading"
        onScroll={handleScroll}
      >
        Loading messages…
      </section>
    );
  }

  if (query.isError) {
    return (
      <section
        ref={transcriptRef}
        className="flex-1 min-h-0 overflow-y-auto p-3"
        data-testid="transcript-error"
        onScroll={handleScroll}
      >
        <InlineErrorBanner
          error={{
            code: null,
            message:
              query.error instanceof Error
                ? query.error.message
                : "Couldn't load transcript.",
          }}
          onRetry={() => {
            void query.refetch();
          }}
        />
      </section>
    );
  }

  const isEmpty = rows.length === 0;
  if (isEmpty) {
    return (
      <section
        ref={transcriptRef}
        className="flex-1 min-h-0 overflow-y-auto p-3"
        data-testid="transcript-empty"
        onScroll={handleScroll}
      >
        {emptyState}
      </section>
    );
  }

  const bannerError = sendError != null ? { code: null, message: sendError.message } : null;

  return (
    <section
      ref={transcriptRef}
      className="flex-1 min-h-0 overflow-y-auto p-3 flex flex-col gap-4"
      data-testid="transcript-rows"
      onScroll={handleScroll}
    >
      <ol className="flex flex-col gap-3" role="log" aria-label="Chat messages">
        {children(rows)}
      </ol>
      {bannerError ? (
        <InlineErrorBanner
          error={bannerError}
          {...(onRetrySend ? { onRetry: onRetrySend } : {})}
          {...(disableRetrySend ? { disabled: true } : {})}
        />
      ) : null}
    </section>
  );
}
