import type { Meta, StoryObj } from '@storybook/react-vite';
import { type JSX, useEffect, useState } from 'react';
import { type Session, SessionPicker } from './SessionPicker';
import { UndoToast } from './UndoToast';

const meta: Meta<typeof UndoToast> = {
  title: 'Chat/UndoToast',
  component: UndoToast,
  args: {
    title: 'Veranda confrontation',
    onUndo: () => {},
    timeoutMs: 5000,
  },
  decorators: [
    (Story) => (
      <div style={{ width: 360 }}>
        <Story />
      </div>
    ),
  ],
};
export default meta;
type Story = StoryObj<typeof UndoToast>;

export const Default: Story = {};

export const LongTitle: Story = {
  args: {
    title: 'A very long scene title that will be truncated by the toast layout',
  },
};

export const ShortTimeout: Story = {
  args: {
    title: 'Cellar discovery',
    timeoutMs: 2500,
  },
};

/**
 * Sepia theme — applied via the `data-theme` attribute on the decorator wrapper
 * (mirrors how the app switches themes on `<html>`).
 */
export const Sepia: Story = {
  decorators: [
    (Story) => (
      <div data-theme="sepia" style={{ width: 360, padding: 16, background: 'var(--bg)' }}>
        <Story />
      </div>
    ),
  ],
};

export const Dark: Story = {
  decorators: [
    (Story) => (
      <div data-theme="dark" style={{ width: 360, padding: 16, background: 'var(--bg)' }}>
        <Story />
      </div>
    ),
  ],
};

/**
 * In-context preview: the toast pinned at the bottom of a faux SceneTab pane,
 * just above the composer, with the picker open on top to demonstrate that the
 * dropdown no longer occludes the toast.
 */
function InContextDemo({ pickerOpen }: { pickerOpen: boolean }): JSX.Element {
  const sessions: Session[] = [
    {
      id: 's1',
      title: 'Veranda confrontation',
      updatedAt: new Date(Date.now() - 2 * 3600_000).toISOString(),
    },
    {
      id: 's2',
      title: 'Cellar discovery',
      updatedAt: new Date(Date.now() - 26 * 3600_000).toISOString(),
    },
  ];
  const [activeId, setActiveId] = useState<string>('s1');

  // The picker is uncontrolled; to demonstrate the open state for the story we
  // synthesise a click on mount when `pickerOpen` is requested.
  useEffect(() => {
    if (!pickerOpen) return;
    const btn = document.querySelector<HTMLButtonElement>(
      '[data-story-id="in-context"] button[aria-label^="Scene session"]',
    );
    btn?.click();
  }, [pickerOpen]);

  return (
    <div
      data-story-id="in-context"
      className="flex flex-col bg-bg border border-line"
      style={{ width: 360, height: 520 }}
    >
      <SessionPicker
        labels={{
          kindLabel: 'SCENE',
          ariaPrefix: 'Scene session: ',
          dropdownHeader: 'Scenes in this chapter',
          newButtonLabel: 'New scene',
        }}
        sessions={sessions}
        activeSessionId={activeId}
        onSelect={setActiveId}
        onRename={() => {}}
        onDelete={() => {}}
        onNew={() => {}}
      />

      <section className="flex-1 min-h-0 overflow-y-auto p-3 flex flex-col gap-3">
        <div className="self-end max-w-[70%] bg-accent-soft text-ink rounded-[var(--radius)] px-3 py-2 text-[13px]">
          Jenny approaches Linda on the veranda and they talk about cheese.
        </div>
        <div className="font-serif text-[14px] text-ink-2 leading-[1.55]">
          Jenny pushed open the screen door. Cicadas. The veranda boards groaned the way they always
          had, and Linda was already there with two glasses of something sweating onto the rail.
        </div>
        <div className="font-serif text-[14px] text-ink-2 leading-[1.55]">
          &ldquo;You came,&rdquo; Linda said, not turning. &ldquo;I almost packed the camembert
          away.&rdquo;
        </div>
      </section>

      <div className="relative">
        <div className="absolute left-3 right-3 bottom-[calc(100%+8px)] z-20">
          <UndoToast title="Cellar discovery" onUndo={() => {}} timeoutMs={5000} />
        </div>

        {/* Faux SceneComposer — mirrors the real component's layout (3-row
            textarea + footer row) so the in-context preview reflects the
            actual composer height instead of an underestimate. */}
        <div className="border-t border-line p-3 bg-bg flex flex-col gap-2">
          <textarea
            rows={3}
            className="resize-none bg-bg-sunken border border-line rounded-[var(--radius)] px-3 py-2 text-[13px] text-ink placeholder:text-ink-4 focus:outline-none"
            placeholder="Describe a scene…"
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
      </div>
    </div>
  );
}

export const InContext: Story = {
  render: () => <InContextDemo pickerOpen={false} />,
};

export const InContextWithPickerOpen: Story = {
  render: () => <InContextDemo pickerOpen={true} />,
};

/**
 * Side-by-side: old (bg-ink slab) vs new design, in the paper theme. Useful
 * for design review.
 */
export const Comparison: Story = {
  render: () => (
    <div className="flex flex-col gap-6" style={{ width: 360 }}>
      <div>
        <div className="text-[10px] uppercase tracking-[.08em] font-sans text-ink-4 mb-1.5">
          Before
        </div>
        <div
          className="bg-ink text-bg rounded-[var(--radius)] px-3 py-2 flex items-center gap-3 text-[12px] shadow-pop"
          role="status"
        >
          <span className="flex-1">Deleted &ldquo;Veranda confrontation&rdquo;</span>
          <button type="button" className="font-mono text-[11px] underline">
            Undo
          </button>
        </div>
      </div>
      <div>
        <div className="text-[10px] uppercase tracking-[.08em] font-sans text-ink-4 mb-1.5">
          After
        </div>
        <UndoToast title="Veranda confrontation" onUndo={() => {}} timeoutMs={5000} />
      </div>
    </div>
  ),
};
