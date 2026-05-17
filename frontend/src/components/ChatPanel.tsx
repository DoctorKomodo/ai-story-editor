import { type JSX, type ReactNode, useState } from 'react';
/**
 * [F38] Chat panel shell — 360px wide right column.
 *
 * Owns the structural chrome of the AI chat side panel:
 *   - 40px header with `Chat / Scene` pill tabs.
 *   - Body slot for the active tab — `chatBody` ([ChatTab]) on Chat,
 *     `sceneBody` ([SceneTab]) on Scene.
 *   - ModelFooter at the very bottom: model picker button showing the active
 *     model and context-window chip (opens [F42]).
 *
 * The active tab (`chat` | `scene`) is local state — no cross-component need
 * for it yet.
 *
 * Width is set by the F25 grid (`.app-shell` column 3 = 360px). For
 * standalone testing we add `min-w-[360px]` so the panel renders at its
 * intended width without the shell.
 */
import { ModelFooter } from '@/components/ModelFooter';

export interface ChatPanelProps {
  /** Slot for the Chat tab body ([ChatTab]). Rendered when the Chat tab is active. */
  chatBody: ReactNode;
  /** Slot for the Scene tab body ([SC18]). Rendered when the Scene tab is active. */
  sceneBody: ReactNode;
  /** Click handler for the model picker button — opens [F42]. */
  onOpenModelPicker?: () => void;
  /** Click handler for the Settings icon button — opens [F43]. */
  onOpenSettings?: () => void;
}

type TabId = 'chat' | 'scene';

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

export function ChatPanel({
  chatBody,
  sceneBody,
  onOpenModelPicker,
  onOpenSettings,
}: ChatPanelProps): JSX.Element {
  const [activeTab, setActiveTab] = useState<TabId>('chat');

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
            aria-selected={activeTab === 'scene'}
            className={tabClass(activeTab === 'scene')}
            onClick={() => {
              setActiveTab('scene');
            }}
          >
            Scene
          </button>
        </div>
        <div className="chat-actions flex gap-0.5">
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

      <section
        className="flex-1 min-h-0 overflow-hidden"
        aria-label="Chat messages"
        data-testid="chat-body"
      >
        {activeTab === 'chat' && chatBody}
        {activeTab === 'scene' && sceneBody}
      </section>

      <ModelFooter onOpenModelPicker={onOpenModelPicker} />
    </aside>
  );
}
