/**
 * BRAINSTORMING MOCKUP — option C of the Scene-tab persistence design.
 *
 * Not production code. No real wiring. Each story paints a static visual of
 * the proposed ChatPanel chrome with a third "Scene" tab and a session-list
 * affordance scoped to that tab. Two sub-variants for where the session
 * picker lives:
 *
 *   C1 — dedicated sub-row under the tabs, above the model bar.
 *   C2 — session picker absorbed into the model bar's first row.
 *
 * Both variants share the same body: a chat-of-candidates transcript with
 * per-candidate "Insert at end" buttons, plus a composer pinned to the
 * bottom that asks for a scene direction rather than a chat message.
 *
 * Delete this file once the design is locked.
 */

import type { Meta, StoryObj } from '@storybook/react-vite';
import type { JSX, ReactNode } from 'react';

const PANEL_WIDTH = 360;

interface SessionRow {
  id: string;
  title: string;
  age: string;
}

const sampleSessions: SessionRow[] = [
  { id: 's1', title: 'Veranda confrontation', age: '2h ago' },
  { id: 's2', title: 'Cellar discovery', age: 'Yesterday' },
  { id: 's3', title: 'First meeting at the docks', age: '3 days ago' },
];

interface CandidateTurn {
  direction: string;
  candidate: string;
  state?: 'streaming' | 'done';
  model?: string;
}

const sampleTurns: CandidateTurn[] = [
  {
    direction: 'Jenny approaches Linda on the veranda and they talk about cheese.',
    candidate:
      'Linda was already at the railing when Jenny stepped onto the veranda, the boards giving a soft, settled sound under her shoes. The afternoon sun lay flat across the planters, and the smell of jasmine had thinned to almost nothing. Jenny cleared her throat. "I brought the cheese," she said, and held up the small wax-paper bundle as proof. Linda turned, and for a moment her face did the thing it always did — a beat of uncertainty, then warmth. "From the Tuesday market?" she asked.',
    state: 'done',
    model: 'Llama 3.3 70B',
  },
  {
    direction: 'Make Linda colder. She is hiding something.',
    candidate:
      'Linda did not turn at first. She let the silence sit, the way she always did when she wanted you to feel the shape of it. Jenny stopped two paces short of the railing. "I brought the cheese." Linda\'s shoulders moved — a breath, not a turn. "Did you," she said. It was not a question.',
    state: 'streaming',
    model: 'Llama 3.3 70B',
  },
];

// ─── Shared chrome pieces ────────────────────────────────────────────────────

function VeniceMark(): JSX.Element {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true" className="flex-shrink-0">
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

function HeaderTabs({ active }: { active: 'chat' | 'scene' | 'history' }): JSX.Element {
  const cls = (isActive: boolean): string =>
    [
      'px-2.5 py-1 text-[12px] rounded-full transition-colors',
      isActive ? 'bg-[var(--accent-soft)] text-ink' : 'text-ink-3',
    ].join(' ');
  return (
    <header
      className="flex items-center justify-between gap-2 h-10 px-3 border-b border-line"
      data-testid="chat-header"
    >
      <div className="flex gap-0.5" role="tablist">
        <button type="button" className={cls(active === 'chat')}>
          Chat
        </button>
        <button type="button" className={cls(active === 'scene')}>
          Scene
        </button>
        <button type="button" className={cls(active === 'history')}>
          History
        </button>
      </div>
      <div className="flex gap-0.5">
        <button type="button" className="icon-btn" aria-label="New scene">
          <PlusIcon />
        </button>
        <button type="button" className="icon-btn" aria-label="Settings">
          <SlidersIcon />
        </button>
      </div>
    </header>
  );
}

function ModelFooter(): JSX.Element {
  return (
    <div className="bg-[var(--bg-sunken)] border-t border-line px-3.5 py-2 flex items-center gap-2">
      <span className="text-[10px] uppercase tracking-[.08em] text-ink-4 font-sans">MODEL</span>
      <button
        type="button"
        className="flex items-center gap-1.5 px-2 py-1 rounded-[var(--radius)] flex-1 min-w-0 hover:bg-[var(--surface-hover)]"
      >
        <VeniceMark />
        <span className="font-mono text-[12px] text-ink truncate flex-1 min-w-0 text-left">
          Llama 3.3 70B
        </span>
        <span className="text-[10px] uppercase font-mono px-1.5 py-0.5 rounded bg-bg border border-line text-ink-3">
          32k
        </span>
        <ChevronDownIcon />
      </button>
    </div>
  );
}

function ScenePickerHeader({ open = false }: { open?: boolean } = {}): JSX.Element {
  return (
    <div className="px-3 py-2 border-b border-line bg-bg relative">
      <SessionPickerButton variant="subrow" />
      {open && <SessionPickerDropdown />}
    </div>
  );
}

function SessionPickerButton({
  variant,
}: {
  variant: 'subrow' | 'inline';
}): JSX.Element {
  const cls =
    variant === 'subrow'
      ? 'flex items-center gap-2 w-full px-2 py-1 rounded-[var(--radius)] text-left'
      : 'flex items-center gap-1.5 px-2 py-1 rounded-[var(--radius)] flex-1 min-w-0 text-left';
  return (
    <button type="button" className={cls}>
      <span className="text-[10px] uppercase tracking-[.08em] text-ink-4 font-sans">SCENE</span>
      <span className="font-mono text-[12px] text-ink truncate flex-1 min-w-0">
        {sampleSessions[0].title}
      </span>
      <span className="text-[11px] font-mono text-ink-4 flex-shrink-0">
        {sampleSessions[0].age}
      </span>
      <ChevronDownIcon />
    </button>
  );
}

function StopIcon(): JSX.Element {
  return (
    <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
      <rect x="1" y="1" width="8" height="8" rx="1" fill="currentColor" />
    </svg>
  );
}

function RetryIcon(): JSX.Element {
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
      <polyline points="23 4 23 10 17 10" />
      <path d="M20.49 15A9 9 0 1 1 5.64 5.64L23 10" />
    </svg>
  );
}

function CandidateBubble({ turn, last }: { turn: CandidateTurn; last: boolean }): JSX.Element {
  return (
    <div className="flex flex-col gap-2">
      <div className="self-end max-w-[85%] bg-[var(--accent-soft)] rounded-[var(--radius)] px-3 py-2 text-[13px] text-ink leading-snug">
        {turn.direction}
      </div>
      <article className="rounded-[var(--radius)] border border-line bg-bg px-3.5 py-3">
        <div
          className={`font-serif text-[14.5px] text-ink leading-[1.55] whitespace-pre-wrap${
            turn.state === 'streaming' ? ' streaming' : ''
          }`}
        >
          {turn.candidate}
        </div>
        {turn.state === 'done' && (
          <div className="flex flex-col gap-2 mt-3">
            <div className="flex items-center gap-1 text-[12px]">
              <button
                type="button"
                className="px-2 py-1 rounded-[var(--radius)] text-[var(--ai)] border border-[var(--ai)] hover:bg-[color-mix(in_srgb,var(--ai)_10%,transparent)]"
              >
                Insert at end
              </button>
              <button
                type="button"
                className="px-2 py-1 rounded-[var(--radius)] text-ink-2 inline-flex items-center gap-1"
                title="Generate another candidate with the current model"
              >
                <RetryIcon />
                Retry
              </button>
              <button type="button" className="px-2 py-1 rounded-[var(--radius)] text-ink-2">
                Copy
              </button>
              <span className="flex-1" aria-hidden="true" />
            </div>
            <div className="flex items-center gap-2 text-[10px] font-mono text-ink-4">
              {turn.model && <span>{turn.model}</span>}
              {!last && <span>· superseded</span>}
            </div>
          </div>
        )}
        {turn.state === 'streaming' && (
          <div className="mt-3 flex items-center justify-between text-[11px] font-mono text-ink-4">
            <span>streaming via {turn.model ?? 'model'}…</span>
          </div>
        )}
      </article>
    </div>
  );
}

function SceneComposer({
  state = 'idle',
}: {
  state?: 'idle' | 'streaming';
} = {}): JSX.Element {
  const isStreaming = state === 'streaming';
  return (
    <div className="border-t border-line p-3 bg-bg flex flex-col gap-2">
      <textarea
        rows={3}
        defaultValue="Refine: dial back the warmth, Linda is suspicious."
        disabled={isStreaming}
        className="resize-none bg-[var(--bg-sunken)] border border-line rounded-[var(--radius)] px-3 py-2 text-[13px] text-ink placeholder:text-ink-4 focus:outline-none disabled:opacity-60"
        placeholder="Describe a scene or refinement…"
      />
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-mono text-ink-4">
          {isStreaming ? 'generating… ⎋ to stop' : '⌘↵ to send'}
        </span>
        {isStreaming ? (
          <button
            type="button"
            className="px-3 py-1 rounded-[var(--radius)] bg-danger text-bg text-[12px] inline-flex items-center gap-1.5"
            aria-label="Stop generation"
          >
            <StopIcon />
            Stop
          </button>
        ) : (
          <button
            type="button"
            className="px-3 py-1 rounded-[var(--radius)] bg-ink text-bg text-[12px]"
          >
            Generate
          </button>
        )}
      </div>
    </div>
  );
}

function PanelShell({ children }: { children: ReactNode }): JSX.Element {
  return (
    <aside
      className="flex flex-col bg-bg border-l border-line min-h-0 overflow-hidden"
      style={{ width: PANEL_WIDTH, height: 720 }}
      aria-label="AI chat panel"
    >
      {children}
    </aside>
  );
}

function TranscriptBody(): JSX.Element {
  return (
    <section className="flex-1 min-h-0 overflow-y-auto p-3 flex flex-col gap-4">
      {sampleTurns.map((t, i) => (
        <CandidateBubble key={i} turn={t} last={i === sampleTurns.length - 1} />
      ))}
    </section>
  );
}

// ─── Scene panel — picker at top, model footer at bottom ────────────────────

function ScenePanel({
  pickerOpen = false,
  composerState = 'idle',
}: {
  pickerOpen?: boolean;
  composerState?: 'idle' | 'streaming';
} = {}): JSX.Element {
  return (
    <PanelShell>
      <HeaderTabs active="scene" />
      <ScenePickerHeader open={pickerOpen} />
      <TranscriptBody />
      <SceneComposer state={composerState} />
      <ModelFooter />
    </PanelShell>
  );
}

// ─── Chat panel — same global change (no top model bar; model footer) ───────

function ChatTranscript(): JSX.Element {
  return (
    <section className="flex-1 min-h-0 overflow-y-auto p-3 flex flex-col gap-3">
      <div className="self-end max-w-[85%] bg-[var(--accent-soft)] rounded-[var(--radius)] px-3 py-2 text-[13px] text-ink leading-snug">
        Is Linda's mother still alive in this chapter?
      </div>
      <div className="self-start max-w-[90%] text-[13px] text-ink leading-snug">
        Based on chapter 4 ("The Letter"), Linda's mother is alive but estranged.
        She is mentioned by name (Margery) once, in a flashback, and Linda has not
        seen her in seven years.
      </div>
    </section>
  );
}

function ChatComposerStub(): JSX.Element {
  return (
    <div className="border-t border-line p-3 bg-bg flex flex-col gap-2">
      <textarea
        rows={2}
        placeholder="Ask about your story…"
        className="resize-none bg-[var(--bg-sunken)] border border-line rounded-[var(--radius)] px-3 py-2 text-[13px] text-ink placeholder:text-ink-4 focus:outline-none"
      />
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-mono text-ink-4">⌘↵ to send</span>
        <button
          type="button"
          className="px-3 py-1 rounded-[var(--radius)] bg-ink text-bg text-[12px]"
        >
          Send
        </button>
      </div>
    </div>
  );
}

function ChatPanelMockup(): JSX.Element {
  return (
    <PanelShell>
      <HeaderTabs active="chat" />
      <ChatTranscript />
      <ChatComposerStub />
      <ModelFooter />
    </PanelShell>
  );
}

// ─── Session picker dropdown — open state ────────────────────────────────────

function TrashIcon(): JSX.Element {
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
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
      <path d="M10 11v6M14 11v6" />
      <path d="M9 6V4a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2" />
    </svg>
  );
}

function PencilIcon(): JSX.Element {
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
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.121 2.121 0 1 1 3 3L7 19l-4 1 1-4 12.5-12.5z" />
    </svg>
  );
}

function SessionPickerDropdown(): JSX.Element {
  return (
    <div
      className="absolute left-3 right-3 top-[calc(100%-2px)] z-10 bg-bg border border-line rounded-[var(--radius)] shadow-lg overflow-hidden"
      role="listbox"
      aria-label="Scene sessions"
    >
      <div className="px-3 py-1.5 text-[10px] uppercase tracking-[.08em] text-ink-4 font-sans border-b border-line bg-[var(--bg-sunken)]">
        Scenes in this chapter
      </div>
      {sampleSessions.map((s, i) => (
        <div
          key={s.id}
          className={`group flex items-center gap-2 px-3 py-2 hover:bg-[var(--surface-hover)] ${
            i === 0 ? 'bg-[var(--accent-soft)]' : ''
          }`}
          role="option"
          aria-selected={i === 0}
        >
          <div className="flex flex-col flex-1 min-w-0">
            <span className="text-[13px] text-ink truncate">{s.title}</span>
            <span className="text-[11px] font-mono text-ink-4">{s.age}</span>
          </div>
          <button
            type="button"
            className="opacity-0 group-hover:opacity-100 p-1 rounded text-ink-3 hover:text-ink-2 hover:bg-[var(--surface-hover)]"
            aria-label={`Rename ${s.title}`}
            title="Rename"
          >
            <PencilIcon />
          </button>
          <button
            type="button"
            className="opacity-0 group-hover:opacity-100 p-1 rounded text-ink-3 hover:text-danger hover:bg-[var(--surface-hover)]"
            aria-label={`Delete ${s.title}`}
            title="Delete"
          >
            <TrashIcon />
          </button>
        </div>
      ))}
      <button
        type="button"
        className="flex items-center gap-2 w-full px-3 py-2 border-t border-line text-[13px] text-ink-2 hover:bg-[var(--surface-hover)]"
      >
        <PlusIcon />
        New scene
      </button>
    </div>
  );
}

// ─── Delete confirm — undo toast ─────────────────────────────────────────────

function DeleteUndoToast(): JSX.Element {
  return (
    <div
      className="absolute left-3 right-3 top-[calc(100%-2px)] z-10 bg-ink text-bg rounded-[var(--radius)] px-3 py-2 flex items-center gap-3 text-[12px] shadow-lg"
      role="status"
    >
      <span className="flex-1">Deleted "Cellar discovery"</span>
      <button type="button" className="font-mono text-[11px] underline">
        Undo
      </button>
    </div>
  );
}

function ScenePanelWithUndo(): JSX.Element {
  return (
    <PanelShell>
      <HeaderTabs active="scene" />
      <div className="px-3 py-2 border-b border-line bg-bg relative">
        <SessionPickerButton variant="subrow" />
        <DeleteUndoToast />
      </div>
      <TranscriptBody />
      <SceneComposer />
      <ModelFooter />
    </PanelShell>
  );
}

// ─── Empty state — first time on Scene tab, no sessions yet ─────────────────

function EmptyState(): JSX.Element {
  return (
    <PanelShell>
      <HeaderTabs active="scene" />
      <div className="px-3 py-2 border-b border-line flex items-center gap-2 bg-bg">
        <span className="text-[10px] uppercase tracking-[.08em] text-ink-4 font-sans">SCENE</span>
        <span className="font-mono text-[12px] text-ink-3 flex-1">No session yet</span>
      </div>
      <section className="flex-1 min-h-0 overflow-y-auto p-6 flex flex-col items-center justify-center gap-3 text-center">
        <div className="font-serif italic text-[15px] text-ink-3 max-w-[280px]">
          Describe what happens next — a scene, a beat, an action — and the assistant
          will draft it in your voice.
        </div>
        <div className="text-[11px] font-mono text-ink-4">
          Try: "Jenny approaches Linda on the veranda and they talk about cheese."
        </div>
      </section>
      <div className="border-t border-line p-3 bg-bg flex flex-col gap-2">
        <textarea
          rows={3}
          placeholder="Describe a scene…"
          className="resize-none bg-[var(--bg-sunken)] border border-line rounded-[var(--radius)] px-3 py-2 text-[13px] text-ink placeholder:text-ink-4 focus:outline-none"
        />
        <div className="flex items-center justify-between">
          <span className="text-[11px] font-mono text-ink-4">⌘↵ to send</span>
          <button
            type="button"
            className="px-3 py-1 rounded-[var(--radius)] bg-ink text-bg text-[12px]"
          >
            Generate
          </button>
        </div>
      </div>
      <ModelFooter />
    </PanelShell>
  );
}

// ─── Side-by-side comparison ────────────────────────────────────────────────

function ChatVsScene(): JSX.Element {
  return (
    <div className="flex gap-6 p-6 bg-[var(--bg-sunken)] min-h-screen items-start">
      <div className="flex flex-col gap-2">
        <div className="text-[11px] uppercase tracking-[.08em] text-ink-3 font-sans">
          Chat tab — model footer
        </div>
        <ChatPanelMockup />
      </div>
      <div className="flex flex-col gap-2">
        <div className="text-[11px] uppercase tracking-[.08em] text-ink-3 font-sans">
          Scene tab — picker top, model footer
        </div>
        <ScenePanel />
      </div>
    </div>
  );
}

function ManagementShowcase(): JSX.Element {
  return (
    <div className="flex gap-6 p-6 bg-[var(--bg-sunken)] min-h-screen items-start">
      <div className="flex flex-col gap-2">
        <div className="text-[11px] uppercase tracking-[.08em] text-ink-3 font-sans">
          Closed
        </div>
        <ScenePanel />
      </div>
      <div className="flex flex-col gap-2">
        <div className="text-[11px] uppercase tracking-[.08em] text-ink-3 font-sans">
          Picker open — list, rename, delete
        </div>
        <ScenePanel pickerOpen />
      </div>
      <div className="flex flex-col gap-2">
        <div className="text-[11px] uppercase tracking-[.08em] text-ink-3 font-sans">
          After delete — undo toast
        </div>
        <ScenePanelWithUndo />
      </div>
    </div>
  );
}

// ─── Storybook glue ──────────────────────────────────────────────────────────

const meta: Meta = {
  title: 'Mockups/SceneTab (Brainstorming)',
  parameters: { layout: 'fullscreen' },
};
export default meta;

type Story = StoryObj;

export const Scene_Default: Story = { render: () => <ScenePanel /> };
export const Scene_Streaming: Story = {
  render: () => <ScenePanel composerState="streaming" />,
};
export const Scene_PickerOpen: Story = { render: () => <ScenePanel pickerOpen /> };
export const Scene_DeleteUndoToast: Story = { render: () => <ScenePanelWithUndo /> };
export const Scene_Empty: Story = { render: () => <EmptyState /> };
export const Chat_WithModelFooter: Story = { render: () => <ChatPanelMockup /> };
export const ChatVsSceneSideBySide: Story = { render: () => <ChatVsScene /> };
export const Management_Showcase: Story = { render: () => <ManagementShowcase /> };
