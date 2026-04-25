import {
  type ChangeEvent,
  type JSX,
  type KeyboardEvent,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { type AttachedSelectionValue, useAttachedSelectionStore } from '@/store/attachedSelection';

/**
 * [F40] Chat composer.
 *
 * - Auto-grow textarea capped at 120px.
 * - When `attachedSelection` is set in the Zustand store, renders the
 *   attachment preview block above the textarea (paperclip + "ATTACHED FROM
 *   CH. N" mono caption + a 2-line-clamped serif italic quote + an X to
 *   clear). The composer reads the store directly (the slice was provisioned
 *   by F22; the F33 selection bubble + F41 routing populate it). On submit
 *   the store is cleared so the next turn starts fresh.
 * - Send button: 28×28 black square with an arrow-up icon. Disabled when the
 *   value is empty AND no attachment is attached.
 * - Below the input: mode tabs (Ask / Rewrite / Describe — sans 11px; active
 *   uses `--accent-soft`) on the left and a right-aligned "⌘↵ send" hint.
 * - `Cmd/Ctrl+Enter` submits.
 *
 * The component is a controlled-input shell — the parent (later
 * EditorPage) supplies `onSend` and is responsible for posting to
 * `/api/chats/:chatId/messages`. F40 never fetches.
 */

export type ChatComposerMode = 'ask' | 'rewrite' | 'describe';

export interface SendArgs {
  content: string;
  attachment: AttachedSelectionValue | null;
  mode: ChatComposerMode;
}

export interface ChatComposerProps {
  onSend: (args: SendArgs) => void | Promise<void>;
  disabled?: boolean;
}

const MAX_TEXTAREA_HEIGHT_PX = 120;

const MODE_TABS: ReadonlyArray<{ id: ChatComposerMode; label: string }> = [
  { id: 'ask', label: 'Ask' },
  { id: 'rewrite', label: 'Rewrite' },
  { id: 'describe', label: 'Describe' },
];

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

function ArrowUpIcon(): JSX.Element {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <line x1="12" y1="19" x2="12" y2="5" />
      <polyline points="5 12 12 5 19 12" />
    </svg>
  );
}

export function ChatComposer({ onSend, disabled = false }: ChatComposerProps): JSX.Element {
  const [value, setValue] = useState<string>('');
  const [mode, setMode] = useState<ChatComposerMode>('ask');
  const attachment = useAttachedSelectionStore((s) => s.attachedSelection);
  const clearAttachment = useAttachedSelectionStore((s) => s.clear);

  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  // Auto-grow: reset to 'auto' so scrollHeight reflects current content,
  // then cap at MAX_TEXTAREA_HEIGHT_PX.
  useLayoutEffect(() => {
    const el = textareaRef.current;
    if (el === null) return;
    el.style.height = 'auto';
    el.style.height = `${String(Math.min(el.scrollHeight, MAX_TEXTAREA_HEIGHT_PX))}px`;
  }, [value]);

  const trimmed = value.trim();
  const isSendDisabled = disabled || (trimmed.length === 0 && attachment === null);

  function handleSend(): void {
    if (isSendDisabled) return;
    const args: SendArgs = {
      content: trimmed,
      attachment,
      mode,
    };
    void onSend(args);
    setValue('');
    clearAttachment();
    setMode('ask');
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>): void {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      handleSend();
    }
  }

  function onChange(e: ChangeEvent<HTMLTextAreaElement>): void {
    setValue(e.target.value);
  }

  const modeTabClass = (isActive: boolean): string =>
    [
      'px-2 py-0.5 rounded-[var(--radius)] font-sans text-[11px] transition-colors',
      isActive ? 'bg-[var(--accent-soft)] text-ink' : 'text-ink-4 hover:text-ink-2',
    ].join(' ');

  return (
    <div className="composer flex flex-col gap-2 px-3 py-2.5" data-testid="chat-composer-root">
      {attachment !== null ? (
        <div
          className="attachment-preview flex items-start gap-2 px-2 py-1.5 rounded-[var(--radius)] bg-[var(--bg-sunken)] border border-line"
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

      <div className="flex items-end gap-2 px-2 py-1.5 rounded-[var(--radius)] border border-line bg-bg focus-within:border-ink-3">
        <textarea
          ref={textareaRef}
          value={value}
          onChange={onChange}
          onKeyDown={onKeyDown}
          placeholder="Ask, rewrite, describe…"
          rows={1}
          className="flex-1 resize-none bg-transparent outline-none font-sans text-[13px] py-1 max-h-[120px] min-h-[28px]"
          aria-label="Message"
        />
        <button
          type="button"
          onClick={handleSend}
          disabled={isSendDisabled}
          className="w-7 h-7 rounded-[var(--radius)] bg-ink text-bg grid place-items-center disabled:opacity-50 flex-shrink-0"
          aria-label="Send"
        >
          <ArrowUpIcon />
        </button>
      </div>

      <div className="flex items-center gap-1">
        <div role="tablist" aria-label="Composer mode" className="flex items-center gap-0.5">
          {MODE_TABS.map((tab) => {
            const isActive = mode === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={isActive}
                className={modeTabClass(isActive)}
                onClick={() => {
                  setMode(tab.id);
                }}
              >
                {tab.label}
              </button>
            );
          })}
        </div>
        <span className="ml-auto font-mono text-[11px] text-ink-4">⌘↵ send</span>
      </div>
    </div>
  );
}
