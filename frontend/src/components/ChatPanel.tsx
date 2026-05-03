import { type JSX, type ReactNode, useState } from 'react';
/**
 * [F38] Chat panel shell — 360px wide right column.
 *
 * Owns the structural chrome of the AI chat side panel:
 *   - 40px header with `Chat / History` pill tabs + `New chat` and `Settings`
 *     icon buttons.
 *   - Model bar (`var(--bg-sunken)` background) with two rows:
 *       row 1: `MODEL` label + a model picker button that fires
 *              `onOpenModelPicker` (opens [F42]).
 *       row 2: mono `temp / top_p / max` and a right-aligned model label.
 *   - Scrollable body slot for the message list ([F39]).
 *   - Composer slot pinned to the bottom ([F40]).
 *
 * The active tab (`chat` | `history`) is local state for now — there is no
 * cross-component need for it yet; future history work may lift it.
 *
 * Width is set by the F25 grid (`.app-shell` column 3 = 360px). For
 * standalone testing we add `min-w-[360px]` so the panel renders at its
 * intended width without the shell.
 */
import { type Model, useModelsQuery } from '@/hooks/useModels';
import { useUserSettings } from '@/hooks/useUserSettings';

export interface ChatPanelProps {
  /** Slot for the message list ([F39]). Rendered when the Chat tab is active. */
  messagesBody: ReactNode;
  /** Slot for the composer ([F40]). Rendered when the Chat tab is active. */
  composer: ReactNode;
  /** Click handler for the model picker button — opens [F42]. */
  onOpenModelPicker?: () => void;
  /** Click handler for the New chat icon button. */
  onNewChat?: () => void;
  /** Click handler for the Settings icon button — opens [F43]. */
  onOpenSettings?: () => void;
}

type TabId = 'chat' | 'history';

function VeniceMark(): JSX.Element {
  // 18×18 black square with a white serif "V" centred. The mockup uses a
  // styled <div> with `font-family: var(--serif)`; we mirror that with a
  // foreignObject-free SVG so the mark survives in environments that strip
  // CSS (and so the test can pluck it out by `data-testid`).
  return (
    <svg
      data-testid="venice-mark"
      width="18"
      height="18"
      viewBox="0 0 18 18"
      aria-hidden="true"
      className="flex-shrink-0"
    >
      <rect width="18" height="18" rx="3" fill="var(--ink)" />
      <text
        x="9"
        y="13"
        textAnchor="middle"
        fontFamily="var(--serif)"
        fontStyle="italic"
        fontSize="12"
        fontWeight="500"
        fill="var(--bg)"
      >
        V
      </text>
    </svg>
  );
}

function PlusIcon(): JSX.Element {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  );
}

function SlidersIcon(): JSX.Element {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <line x1="4" y1="21" x2="4" y2="14" />
      <line x1="4" y1="10" x2="4" y2="3" />
      <line x1="12" y1="21" x2="12" y2="12" />
      <line x1="12" y1="8" x2="12" y2="3" />
      <line x1="20" y1="21" x2="20" y2="16" />
      <line x1="20" y1="12" x2="20" y2="3" />
      <line x1="1" y1="14" x2="7" y2="14" />
      <line x1="9" y1="8" x2="15" y2="8" />
      <line x1="17" y1="16" x2="23" y2="16" />
    </svg>
  );
}

function ChevronDownIcon(): JSX.Element {
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
      className="text-ink-4"
    >
      <polyline points="6 9 12 15 18 9" />
    </svg>
  );
}

/**
 * Format a context-window size as a short label, e.g.
 *   32_000 → "32k"
 *   128_000 → "128k"
 *   500 → "500"
 *
 * Note: this differs from `formatContextLength` used by `<ModelPicker />`,
 * which uses 1024-based "K". The mockup model bar uses 1000-based "k", so we
 * keep the F38 helper local rather than reuse the F13 one.
 */
export function formatCtxLabel(contextLength: number): string {
  if (contextLength <= 0) return '—';
  if (contextLength >= 1000) {
    const k = Math.round(contextLength / 1000);
    return `${String(k)}k`;
  }
  return String(contextLength);
}

export function ChatPanel({
  messagesBody,
  composer,
  onOpenModelPicker,
  onNewChat,
  onOpenSettings,
}: ChatPanelProps): JSX.Element {
  const [activeTab, setActiveTab] = useState<TabId>('chat');

  const settings = useUserSettings();
  const modelId = settings.chat.model;
  const { data: models } = useModelsQuery();
  const params = settings.chat;

  const selectedModel: Model | undefined = models?.find((m) => m.id === modelId);
  const modelName = selectedModel?.name ?? 'No model';
  const ctxLabel = selectedModel ? formatCtxLabel(selectedModel.contextLength) : '—';
  const modelLabel = selectedModel?.name ?? selectedModel?.id ?? modelId ?? '';

  const tabClass = (isActive: boolean): string =>
    [
      'px-2.5 py-1 text-[12px] rounded-full transition-colors',
      isActive ? 'bg-[var(--accent-soft)] text-ink' : 'text-ink-3 hover:text-ink-2',
    ].join(' ');

  return (
    <aside
      className="chat flex flex-col h-full bg-bg border-l border-line min-h-0 overflow-hidden min-w-[360px]"
      aria-label="AI chat panel"
    >
      <header
        className="chat-header flex items-center justify-between gap-2 h-10 px-3 border-b border-line"
        data-testid="chat-header"
      >
        <div className="chat-tabs flex gap-0.5" role="tablist" aria-label="Chat sections">
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'chat'}
            className={tabClass(activeTab === 'chat')}
            onClick={() => {
              setActiveTab('chat');
            }}
          >
            Chat
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'history'}
            className={tabClass(activeTab === 'history')}
            onClick={() => {
              setActiveTab('history');
            }}
          >
            History
          </button>
        </div>
        <div className="chat-actions flex gap-0.5">
          <button
            type="button"
            className="icon-btn"
            aria-label="New chat"
            title="New chat"
            onClick={onNewChat}
          >
            <PlusIcon />
          </button>
          <button
            type="button"
            className="icon-btn"
            aria-label="Settings"
            title="Settings"
            onClick={onOpenSettings}
          >
            <SlidersIcon />
          </button>
        </div>
      </header>

      <div
        className="model-bar bg-[var(--bg-sunken)] px-3.5 py-2.5 flex flex-col gap-1.5 border-b border-line"
        data-testid="model-bar"
      >
        <div className="flex items-center gap-2">
          <span className="text-[10px] uppercase tracking-[.08em] text-ink-4 font-sans">MODEL</span>
          <button
            type="button"
            onClick={onOpenModelPicker}
            aria-label="Open model picker"
            className="model-picker-btn flex items-center gap-1.5 hover:bg-[var(--surface-hover)] px-2 py-1 rounded-[var(--radius)] flex-1 min-w-0"
          >
            <VeniceMark />
            <span className="font-mono text-[12px] text-ink truncate flex-1 min-w-0 text-left">
              {modelName}
            </span>
            <span
              className="ctx-chip text-[10px] uppercase font-mono px-1.5 py-0.5 rounded bg-bg border border-line text-ink-3"
              data-testid="ctx-chip"
            >
              {ctxLabel}
            </span>
            <ChevronDownIcon />
          </button>
        </div>
        <div className="flex items-center justify-between font-mono text-[11px] text-ink-4">
          <span data-testid="model-params">
            {`temp ${params.temperature}  top_p ${params.topP}  max ${params.maxTokens}`}
          </span>
          <span data-testid="model-label">{modelLabel}</span>
        </div>
      </div>

      <section
        className="flex-1 overflow-y-auto"
        aria-label="Chat messages"
        data-testid="chat-body"
      >
        {activeTab === 'chat' ? (
          messagesBody
        ) : (
          <div className="px-4 py-6 text-[12px] text-ink-4">History — coming in a future task</div>
        )}
      </section>

      {activeTab === 'chat' ? (
        <div className="border-t border-line" data-testid="chat-composer">
          {composer}
        </div>
      ) : null}
    </aside>
  );
}
