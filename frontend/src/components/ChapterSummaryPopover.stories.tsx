import type { Meta, StoryObj } from '@storybook/react-vite';
import type { JSX } from 'react';
import { useState } from 'react';
import { Spinner } from '../design/primitives';

/* ============================================================================
 * Design-mockup-only component set.
 *
 * Proposes a Cast-style popover for per-chapter summaries (mirrors
 * CharacterPopover + CharacterSheet). Triggered by an always-visible state
 * icon on each ChapterRow. Used to validate the Cast-pattern direction
 * before writing the real ChapterSummaryPopover.tsx / ChapterSummarySheet.tsx
 * during implementation.
 *
 * NOT imported by production code. Will be replaced with a real
 * ChapterSummaryPopover.stories.tsx against the live components.
 * ========================================================================== */

type SummaryState = 'missing' | 'current' | 'stale' | 'generating' | 'corrupted';

interface MockChapter {
  id: string;
  orderIndex: number;
  title: string;
  wordCount: number;
  summaryState: SummaryState;
}

interface MockSummary {
  events: string;
  stateAtEnd: string;
  openThreads: string;
}

const SAMPLE_SUMMARY: MockSummary = {
  events:
    'Lyra crosses the threshold against Kade’s warning and reaches the inner chamber. They argue about the corridor’s purpose; Kade reveals he was watching her.',
  stateAtEnd:
    'Lyra and Kade together in the inner chamber. Lyra holds the bronze key. The corridor behind them is sealed.',
  openThreads:
    '— Whose breathing was in the corridor.\n— Kade’s real reason for being there.\n— What the bronze key actually opens.',
};

const SAMPLE_CHAPTERS: MockChapter[] = [
  { id: 'c1', orderIndex: 0, title: 'The Churn at Dawn', wordCount: 2800, summaryState: 'current' },
  {
    id: 'c2',
    orderIndex: 1,
    title: 'A Visitor from the Other Wing',
    wordCount: 3100,
    summaryState: 'current',
  },
  { id: 'c3', orderIndex: 2, title: 'What Ilonoré Brought', wordCount: 2900, summaryState: 'stale' },
  { id: 'c4', orderIndex: 3, title: 'The Weight of Ash', wordCount: 3500, summaryState: 'missing' },
  {
    id: 'c5',
    orderIndex: 4,
    title: "Maulster's Jaw",
    wordCount: 2600,
    summaryState: 'corrupted',
  },
  { id: 'c6', orderIndex: 5, title: 'The Bronze Key', wordCount: 0, summaryState: 'missing' },
];

/* ──────────────────────────────────────────────────────────────────────────
 * SummaryStateIcon — always-visible per-row indicator.
 *
 * Sits between the chapter title and the word count, mirrors the right-side
 * metadata cluster. State distinctions kept minimal: shape + color do the
 * lifting, no text. Click bubbles up so the row can open the popover.
 * ────────────────────────────────────────────────────────────────────────── */

function SummaryStateIcon({
  state,
  onClick,
  ariaPressed,
}: {
  state: SummaryState;
  onClick: (e: React.MouseEvent) => void;
  ariaPressed: boolean;
}): JSX.Element {
  const labelByState: Record<SummaryState, string> = {
    missing: 'No summary yet — click to generate',
    current: 'Summary present — click to view',
    stale: 'Summary possibly stale — click to view',
    generating: 'Generating summary…',
    corrupted: 'Summary unreadable — click to regenerate',
  };

  return (
    <button
      type="button"
      aria-label={labelByState[state]}
      aria-pressed={ariaPressed}
      onClick={(e) => {
        e.stopPropagation();
        onClick(e);
      }}
      title={labelByState[state]}
      className="flex-shrink-0 inline-flex h-4 w-4 items-center justify-center rounded hover:bg-[var(--surface-hover)] text-ink-4 hover:text-ink-2 transition-colors"
    >
      {state === 'missing' && (
        <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden>
          <circle cx="5" cy="5" r="3.5" stroke="currentColor" strokeWidth="1" fill="none" />
        </svg>
      )}
      {state === 'current' && (
        <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden>
          <circle cx="5" cy="5" r="3" fill="currentColor" />
        </svg>
      )}
      {state === 'stale' && (
        <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden>
          <circle cx="5" cy="5" r="3" fill="currentColor" />
          <circle cx="8.5" cy="1.5" r="1.5" className="text-accent" fill="currentColor" />
        </svg>
      )}
      {state === 'generating' && <Spinner size={10} />}
      {state === 'corrupted' && (
        <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden className="text-danger">
          <path d="M5 1 L9 9 L1 9 Z" stroke="currentColor" strokeWidth="1" fill="none" />
          <path d="M5 4 L5 6.5" stroke="currentColor" strokeWidth="1" strokeLinecap="round" />
          <circle cx="5" cy="7.5" r="0.5" fill="currentColor" />
        </svg>
      )}
    </button>
  );
}

/* ──────────────────────────────────────────────────────────────────────────
 * ChapterRowMockup — stub of the real ChapterRow with the new summary icon
 * inserted to the LEFT of the word count.
 * ────────────────────────────────────────────────────────────────────────── */

function ChapterRowMockup({
  chapter,
  active,
  popoverOpen,
  onSelect,
  onOpenPopover,
}: {
  chapter: MockChapter;
  active: boolean;
  popoverOpen: boolean;
  onSelect: (id: string) => void;
  onOpenPopover: (id: string) => void;
}): JSX.Element {
  return (
    <li
      data-active={active ? 'true' : undefined}
      className={[
        'group flex items-center gap-2 pl-3 pr-2 h-8 rounded-[var(--radius)]',
        'transition-colors cursor-pointer',
        active ? 'bg-[var(--accent-soft)]' : 'hover:bg-[var(--surface-hover)]',
      ].join(' ')}
    >
      <span
        aria-hidden="true"
        className="font-mono text-[11px] text-ink-4 tabular-nums w-5 flex-shrink-0"
      >
        {String(chapter.orderIndex + 1).padStart(2, '0')}
      </span>
      <button
        type="button"
        onClick={() => onSelect(chapter.id)}
        className="flex-1 min-w-0 text-left font-serif text-[14px] text-ink leading-tight truncate"
      >
        {chapter.title || 'Untitled'}
      </button>
      <SummaryStateIcon
        state={chapter.summaryState}
        ariaPressed={popoverOpen}
        onClick={() => onOpenPopover(chapter.id)}
      />
      <span className="font-mono text-[11px] text-ink-4 tabular-nums w-14 flex-shrink-0 text-right">
        {chapter.wordCount === 0 ? '—' : `${(chapter.wordCount / 1000).toFixed(1)}k`}
      </span>
    </li>
  );
}

/* ──────────────────────────────────────────────────────────────────────────
 * ChapterSummaryPopoverMockup — mirrors CharacterPopover.
 *
 * 280px-wide card. In production it's absolute-positioned next to the anchor;
 * in this mockup it's rendered as a sibling block so Storybook shows its
 * full visual without DOM-positioning logic.
 * ────────────────────────────────────────────────────────────────────────── */

function FieldRow({ label, value }: { label: string; value: string | null }): JSX.Element {
  const display = value && value.trim().length > 0 ? value : '—';
  return (
    <div>
      <dt className="text-[10px] uppercase tracking-[.08em] text-ink-4 font-mono mt-2">{label}</dt>
      <dd className="font-serif text-[13px] text-ink mt-0.5 whitespace-pre-wrap">{display}</dd>
    </div>
  );
}

function ChapterSummaryPopoverMockup({
  chapter,
  state,
  summary,
}: {
  chapter: MockChapter;
  state: SummaryState;
  summary: MockSummary | null;
}): JSX.Element {
  const headerCaption = `Chapter ${chapter.orderIndex + 1}`;

  return (
    <div
      role="dialog"
      aria-label={`Chapter summary: ${chapter.title}`}
      className="w-[280px] bg-bg-elevated border border-line rounded-[var(--radius-lg)] shadow-pop p-3"
    >
      <header className="mb-1">
        <h3 className="font-serif text-[16px] text-ink leading-tight">
          {chapter.title || 'Untitled'}
        </h3>
        <div className="mt-0.5 text-[10px] uppercase tracking-[.08em] text-ink-4 font-mono flex items-center gap-2">
          <span>{headerCaption}</span>
          {state === 'stale' && (
            <span className="rounded border border-line px-1.5 py-0.5 normal-case tracking-normal text-ink-3 italic">
              possibly stale
            </span>
          )}
          {state === 'corrupted' && (
            <span className="rounded border border-line px-1.5 py-0.5 normal-case tracking-normal text-ink-3">
              unreadable
            </span>
          )}
        </div>
      </header>

      {(state === 'current' || state === 'stale') && summary && (
        <dl>
          <FieldRow label="Events" value={summary.events} />
          <FieldRow label="State at end" value={summary.stateAtEnd} />
          <FieldRow label="Open threads" value={summary.openThreads} />
        </dl>
      )}

      {state === 'missing' && (
        <p className="mt-2 font-serif text-[13px] text-ink-3 leading-relaxed">
          No summary yet. Generate one so this chapter contributes context when you write later
          chapters.
        </p>
      )}

      {state === 'corrupted' && (
        <p className="mt-2 font-serif text-[13px] text-ink-3 leading-relaxed">
          A summary is stored but couldn’t be decoded in this session. Regenerating will replace
          it.
        </p>
      )}

      {state === 'generating' && (
        <div className="mt-2 flex items-center gap-2 font-serif text-[13px] text-ink-3">
          <Spinner /> Generating summary…
        </div>
      )}

      <div className="mt-3 flex items-center gap-2">
        {(state === 'current' || state === 'stale') && (
          <>
            <button
              type="button"
              className="text-[12px] px-2 py-1 rounded-[var(--radius)] hover:bg-[var(--surface-hover)]"
            >
              Edit
            </button>
            <button
              type="button"
              className="text-[12px] px-2 py-1 rounded-[var(--radius)] hover:bg-[var(--surface-hover)]"
            >
              Regenerate
            </button>
          </>
        )}
        {(state === 'missing' || state === 'corrupted') && (
          <button
            type="button"
            className="text-[12px] px-2 py-1 rounded-[var(--radius)] hover:bg-[var(--surface-hover)]"
          >
            Generate summary
          </button>
        )}
        {state === 'generating' && (
          <button
            type="button"
            className="text-[12px] px-2 py-1 rounded-[var(--radius)] hover:bg-[var(--surface-hover)]"
          >
            Cancel
          </button>
        )}
        <span className="ml-auto text-[10px] text-ink-4 font-mono">
          {state === 'missing' || state === 'corrupted' ? '~480 tok · gpt-4o' : ''}
          {state === 'generating' ? 'est. ~480 tok' : ''}
        </span>
      </div>
    </div>
  );
}

/* ──────────────────────────────────────────────────────────────────────────
 * Composition: sidebar-ish chapter list (left) + popover anchored to the
 * chapter row that's currently "open" (right).
 * ────────────────────────────────────────────────────────────────────────── */

function ListWithPopover({
  initialOpenId,
  popoverState,
  popoverSummary,
}: {
  initialOpenId: string | null;
  popoverState: SummaryState;
  popoverSummary: MockSummary | null;
}): JSX.Element {
  const [activeId, setActiveId] = useState<string>('c1');
  const [openId, setOpenId] = useState<string | null>(initialOpenId);

  const openChapter = openId ? SAMPLE_CHAPTERS.find((c) => c.id === openId) ?? null : null;

  return (
    <div className="flex gap-6 items-start" style={{ minHeight: 380 }}>
      {/* Stub sidebar — width matches the real Sidebar's chapters column */}
      <div className="rounded border border-line bg-bg p-2" style={{ width: 280 }}>
        <div className="px-3 pb-2 pt-1 text-[10px] uppercase tracking-[.08em] text-ink-4 font-mono">
          Chapters
        </div>
        <ul className="flex flex-col gap-0.5">
          {SAMPLE_CHAPTERS.map((c) => (
            <ChapterRowMockup
              key={c.id}
              chapter={c}
              active={c.id === activeId}
              popoverOpen={c.id === openId}
              onSelect={setActiveId}
              onOpenPopover={(id) => setOpenId((cur) => (cur === id ? null : id))}
            />
          ))}
        </ul>
      </div>

      {/* Popover faked next to the row instead of absolute-positioned */}
      {openChapter && (
        <ChapterSummaryPopoverMockup
          chapter={openChapter}
          state={popoverState}
          summary={popoverSummary}
        />
      )}
    </div>
  );
}

const meta = {
  title: 'Design Mockups/ChapterSummaryPopover',
  component: ListWithPopover,
  parameters: {
    docs: {
      description: {
        component:
          'Cast-pattern mockup for per-chapter summaries. The icon on each chapter row signals state at-a-glance and is also the popover trigger — same affordance plays both roles. The popover mirrors CharacterPopover (280px, rounded, shadow-pop). Edit opens a ChapterSummarySheet (mirrors CharacterSheet, not mocked here). Replaces the earlier collapsible-panel-above-editor proposal.',
      },
    },
  },
} satisfies Meta<typeof ListWithPopover>;

export default meta;
type Story = StoryObj<typeof meta>;

export const AllStates: Story = {
  args: { initialOpenId: null, popoverState: 'current', popoverSummary: null },
  parameters: {
    docs: {
      description: {
        story:
          'Per-row icons across the five states (current / current / stale / missing / corrupted / missing). Click any icon to open its popover — this story has no initial popover so the row icons themselves are the focus.',
      },
    },
  },
};

export const PopoverCurrent: Story = {
  args: { initialOpenId: 'c1', popoverState: 'current', popoverSummary: SAMPLE_SUMMARY },
};

export const PopoverStale: Story = {
  args: { initialOpenId: 'c3', popoverState: 'stale', popoverSummary: SAMPLE_SUMMARY },
};

export const PopoverMissing: Story = {
  args: { initialOpenId: 'c4', popoverState: 'missing', popoverSummary: null },
};

export const PopoverCorrupted: Story = {
  args: { initialOpenId: 'c5', popoverState: 'corrupted', popoverSummary: null },
};

export const PopoverGenerating: Story = {
  args: { initialOpenId: 'c4', popoverState: 'generating', popoverSummary: null },
};
