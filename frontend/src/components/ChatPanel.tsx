import { type JSX, type ReactNode, useState } from 'react';
/**
 * [F38] Chat panel shell — right-column side panel, mirrors the sidebar's
 * `clamp(260px, 22vw, 390px)` width.
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
 * Width is set by the F25 grid (`.app-shell` column 3). `min-w-[260px]` on
 * the root matches the grid floor so standalone (Storybook) renders at the
 * intended minimum width.
 */
import { ModelFooter } from '@/components/ModelFooter';

export interface ChatPanelProps {
  /** Slot for the Chat tab body ([ChatTab]). Rendered when the Chat tab is active. */
  chatBody: ReactNode;
  /** Slot for the Scene tab body ([SC18]). Rendered when the Scene tab is active. */
  sceneBody: ReactNode;
  /** Click handler for the model picker button — opens [F42]. */
  onOpenModelPicker?: () => void;
}

type TabId = 'chat' | 'scene';

export function ChatPanel({ chatBody, sceneBody, onOpenModelPicker }: ChatPanelProps): JSX.Element {
  const [activeTab, setActiveTab] = useState<TabId>('chat');

  const tabClass = (isActive: boolean): string =>
    [
      'px-2.5 py-1 text-[12px] rounded-full transition-colors',
      isActive ? 'bg-[var(--accent-soft)] text-ink' : 'text-ink-3 hover:text-ink-2',
    ].join(' ');

  return (
    <aside
      className="chat flex flex-col h-full bg-bg border-l border-line min-h-0 overflow-hidden min-w-[260px]"
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
