import {
  type ChangeEvent,
  type JSX,
  type KeyboardEvent,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { Checkbox } from '@/design/primitives';
import { useModelsQuery } from '@/hooks/useModels';
import { useUserSettings } from '@/hooks/useUserSettings';
import { type AttachedSelectionValue, useAttachedSelectionStore } from '@/store/attachedSelection';
import { useComposerDraftStore } from '@/store/composerDraft';

/**
 * [F40] Chat composer.
 *
 * Visual sibling of SceneComposer: identical container chrome, sunken-paper
 * textarea, and footer-pill button. Differs in three chat-specific affordances:
 * the auto-grow textarea (28–120px), the optional attachment preview block,
 * and the optional web-search toggle.
 *
 * State contract (mirrors SceneComposer):
 * - `state="idle"`      → Send pill, textarea enabled, Cmd/Ctrl+Enter submits.
 * - `state="streaming"` → Stop pill, textarea disabled, Escape calls onStop.
 *
 * Attachment: when `attachedSelection` is set in the Zustand store, renders the
 * attachment preview block above the textarea. On submit the store is cleared.
 */

export interface SendArgs {
  content: string;
  attachment: AttachedSelectionValue | null;
  /**
   * [F50] When true, the next `POST /chats/:chatId/messages` should set
   * `enableWebSearch: true`. Per-turn, not session-wide — the composer
   * resets the toggle to false after each successful send so credits are
   * never silently burned across a long conversation.
   */
  enableWebSearch: boolean;
}

export interface ChatComposerProps {
  // `void` in the union is deliberate: handlers that return nothing (and
  // async handlers returning Promise<void>) must stay assignable — only an
  // explicit `false` means "not consumed, restore the draft".
  // biome-ignore lint/suspicious/noConfusingVoidType: back-compat acceptance contract, see comment above.
  onSend: (args: SendArgs) => void | boolean | Promise<void | boolean>;
  disabled?: boolean;
  state?: 'idle' | 'streaming';
  onStop?: () => void;
}

const MAX_TEXTAREA_HEIGHT_PX = 120;

function PaperclipIcon(): JSX.Element {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className="flex-shrink-0 mt-0.5 text-ink-4"
    >
      <path d="M21.44 11.05 12.25 20.24a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.49" />
    </svg>
  );
}

function XIcon(): JSX.Element {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}

function StopIcon(): JSX.Element {
  return (
    <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
      <rect x="1" y="1" width="8" height="8" rx="1" fill="currentColor" />
    </svg>
  );
}

export function ChatComposer({
  onSend,
  disabled = false,
  state = 'idle',
  onStop,
}: ChatComposerProps): JSX.Element {
  const [value, setValue] = useState<string>('');
  const [useWebSearch, setUseWebSearch] = useState<boolean>(false);
  const attachment = useAttachedSelectionStore((s) => s.attachedSelection);
  const clearAttachment = useAttachedSelectionStore((s) => s.clear);
  const pendingDraft = useComposerDraftStore((s) => s.draft);
  const clearDraft = useComposerDraftStore((s) => s.clearDraft);
  const focusToken = useComposerDraftStore((s) => s.focusToken);
  const modelId = useUserSettings().chat.model;
  const modelsQuery = useModelsQuery();
  const selectedModel = useMemo(() => {
    const list = modelsQuery.data ?? [];
    if (modelId === null) return null;
    return list.find((m) => m.id === modelId) ?? null;
  }, [modelsQuery.data, modelId]);
  const showWebSearchToggle = selectedModel !== null && selectedModel.supportsWebSearch === true;

  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  const isStreaming = state === 'streaming';

  // Auto-grow: reset to 'auto' so scrollHeight reflects current content,
  // then cap at MAX_TEXTAREA_HEIGHT_PX.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `value` is the trigger — every keystroke must re-measure scrollHeight, the body reads it via the ref
  useLayoutEffect(() => {
    const el = textareaRef.current;
    if (el === null) return;
    el.style.height = 'auto';
    el.style.height = `${String(Math.min(el.scrollHeight, MAX_TEXTAREA_HEIGHT_PX))}px`;
  }, [value]);

  // [F41] When a pending draft is pushed via the composer-draft slice
  // (e.g. from `triggerAskAI`), prepend it to the current value and clear
  // the slice. If the textarea is empty, the draft becomes the value.
  useEffect(() => {
    if (pendingDraft === null) return;
    setValue((prev) => (prev.length === 0 ? pendingDraft : pendingDraft + prev));
    clearDraft();
  }, [pendingDraft, clearDraft]);

  // [F41] Focus the textarea whenever a focus request comes in. Skip the
  // initial render (token === 0) so mounting the composer doesn't steal
  // focus from elsewhere on the page.
  useEffect(() => {
    if (focusToken === 0) return;
    textareaRef.current?.focus();
  }, [focusToken]);

  const trimmed = value.trim();
  const isSendDisabled = disabled || isStreaming || (trimmed.length === 0 && attachment === null);

  function handleSend(): void {
    if (isSendDisabled) return;
    const args: SendArgs = {
      content: trimmed,
      attachment,
      enableWebSearch: useWebSearch,
    };
    // Optimistic clear (unchanged feel for accepted sends)…
    setValue('');
    clearAttachment();
    // [F50] Per-turn semantics: reset the toggle so the next message
    // does not inadvertently re-trigger web search.
    setUseWebSearch(false);
    // …then restore the draft iff the send was explicitly not consumed
    // (pre-send guard). Failed sends resolve true — their content lives on
    // in the draft row + banner retry, so restoring would duplicate it.
    void Promise.resolve(onSend(args)).then(
      (accepted) => {
        if (accepted !== false) return;
        setValue((cur) => (cur.length === 0 ? args.content : cur));
        if (
          args.attachment !== null &&
          useAttachedSelectionStore.getState().attachedSelection === null
        ) {
          useAttachedSelectionStore.getState().setAttachedSelection(args.attachment);
        }
      },
      () => {
        // onSend rejections are handled upstream (banner/error store) — never
        // let the composer re-introduce an unhandled rejection.
      },
    );
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>): void {
    if (e.key === 'Escape' && isStreaming && onStop) {
      e.preventDefault();
      onStop();
      return;
    }
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      if (isStreaming) {
        e.preventDefault();
        return;
      }
      e.preventDefault();
      handleSend();
    }
  }

  function onChange(e: ChangeEvent<HTMLTextAreaElement>): void {
    setValue(e.target.value);
  }

  return (
    <div
      className="border-t border-line p-3 bg-bg flex flex-col gap-2"
      data-testid="chat-composer-root"
    >
      {attachment !== null ? (
        <div
          className="attachment-preview flex items-start gap-2 px-2 py-1.5 rounded-[var(--radius)] bg-bg-sunken border border-line"
          data-testid="composer-attachment"
        >
          <PaperclipIcon />
          <div className="flex-1 min-w-0">
            <div className="text-[10px] uppercase tracking-[.08em] font-mono text-ink-4">
              {`ATTACHED FROM CH. ${String(attachment.chapter.number)}`}
            </div>
            <blockquote className="font-serif italic text-[12.5px] text-ink-3 line-clamp-2">
              {attachment.text}
            </blockquote>
          </div>
          <button
            type="button"
            onClick={() => {
              clearAttachment();
            }}
            aria-label="Clear attachment"
            className="icon-btn flex-shrink-0 w-5 h-5"
          >
            <XIcon />
          </button>
        </div>
      ) : null}

      <textarea
        ref={textareaRef}
        value={value}
        onChange={onChange}
        onKeyDown={onKeyDown}
        placeholder="Send a message…"
        rows={1}
        disabled={isStreaming}
        className="resize-none bg-bg-sunken border border-line rounded-[var(--radius)] px-3 py-2 text-[13px] text-ink placeholder:text-ink-4 focus:outline-none focus:border-ink-3 disabled:opacity-60 max-h-[120px] min-h-[28px]"
        aria-label="Message"
      />

      <div className="flex items-center justify-between">
        <span className="text-[11px] font-mono text-ink-4">
          {isStreaming ? 'generating… ⎋ to stop' : '⌘↵ to send'}
        </span>
        {isStreaming ? (
          <button
            type="button"
            onClick={onStop}
            aria-label="Stop generation"
            className="px-3 py-1 rounded-[var(--radius)] bg-danger text-bg text-[12px] inline-flex items-center gap-1.5"
          >
            <StopIcon />
            Stop
          </button>
        ) : (
          <button
            type="button"
            onClick={handleSend}
            disabled={isSendDisabled}
            aria-label="Send"
            className="px-3 py-1 rounded-[var(--radius)] bg-ink text-bg text-[12px] disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Send
          </button>
        )}
      </div>

      {showWebSearchToggle ? (
        <div className="flex items-center gap-2" data-testid="composer-web-search-toggle">
          <label
            htmlFor="chat-web-search"
            className="flex items-center gap-1.5 font-sans text-[11px] text-ink-3"
          >
            <Checkbox
              id="chat-web-search"
              checked={useWebSearch}
              onChange={(e) => {
                setUseWebSearch(e.target.checked);
              }}
              aria-describedby="chat-web-search-hint"
            />
            <span>Web search</span>
          </label>
          <span id="chat-web-search-hint" className="font-sans text-[11px] text-ink-4">
            Web search — may increase response time + cost.
          </span>
        </div>
      ) : null}
    </div>
  );
}
