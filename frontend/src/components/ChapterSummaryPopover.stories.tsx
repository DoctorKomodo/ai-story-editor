import type { Meta, StoryObj } from '@storybook/react-vite';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useRef } from 'react';
import type { Chapter, ChapterMeta } from 'story-editor-shared';
import { chapterQueryKey } from '@/hooks/useChapters';
import { ChapterSummaryPopover } from './ChapterSummaryPopover';

const STORY_ID = 'story-demo';
const CHAPTER_ID = 'c1';

const baseMeta: ChapterMeta = {
  id: CHAPTER_ID,
  storyId: STORY_ID,
  title: 'The Bronze Key',
  wordCount: 2800,
  orderIndex: 0,
  status: 'draft',
  hasSummary: false,
  summaryIsStale: false,
  createdAt: '2026-04-01T12:00:00Z',
  updatedAt: '2026-04-30T12:00:00Z',
};

const sampleSummary = {
  events:
    "Lyra crosses the threshold against Kade's warning and reaches the inner chamber. They argue about the corridor's purpose; Kade reveals he was watching her.",
  stateAtEnd:
    'Lyra and Kade together in the inner chamber. Lyra holds the bronze key. The corridor behind them is sealed.',
  openThreads:
    "-- Whose breathing was in the corridor.\n-- Kade's real reason for being there.\n-- What the bronze key actually opens.",
};

const SUMMARY_UPDATED_AT = '2026-04-29T09:00:00Z';

function buildBaseDetail(overrides: Partial<Chapter>): Chapter {
  return {
    id: CHAPTER_ID,
    storyId: STORY_ID,
    title: 'The Bronze Key',
    wordCount: 2800,
    orderIndex: 0,
    status: 'draft',
    hasSummary: false,
    summaryIsStale: false,
    bodyJson: null,
    summary: null,
    summaryUpdatedAt: null,
    createdAt: '2026-04-01T12:00:00Z',
    updatedAt: '2026-04-30T12:00:00Z',
    ...overrides,
  };
}

const neverResolve = (): Promise<never> => new Promise(() => {});

function withClient(detail: Chapter | null, options?: { mockFetch?: boolean }) {
  return (Story: () => React.ReactElement) => {
    const client = new QueryClient({
      defaultOptions: {
        queries: {
          retry: false,
          staleTime: Number.POSITIVE_INFINITY,
          gcTime: Number.POSITIVE_INFINITY,
        },
      },
    });

    if (detail !== null) {
      client.setQueryData(chapterQueryKey(CHAPTER_ID), detail);
    }

    if (options?.mockFetch) {
      // Intercept all fetch calls so the summarise POST never resolves —
      // summariseMutation.isPending stays true for the lifetime of the story.
      // Also intercepts the detail query fetch, but the cache is pre-seeded
      // so detail.data is already populated from the seeded data above.
      const real = globalThis.fetch.bind(globalThis);
      globalThis.fetch = (input, init) => {
        const url =
          typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
        if (url.includes('/summarise')) return neverResolve() as Promise<Response>;
        return real(input, init);
      };
    }

    return (
      <QueryClientProvider client={client}>
        <Story />
      </QueryClientProvider>
    );
  };
}

function AnchoredPopover(
  props: Omit<React.ComponentProps<typeof ChapterSummaryPopover>, 'anchorEl'>,
): React.ReactElement {
  const anchorRef = useRef<HTMLButtonElement | null>(null);
  return (
    <div style={{ position: 'relative', minHeight: 340, padding: '40px 0 0 40px' }}>
      <button
        ref={anchorRef}
        type="button"
        className="text-[12px] px-2 py-1 rounded-[var(--radius)] border border-line"
      >
        ● Chapter 1
      </button>
      <ChapterSummaryPopover {...props} anchorEl={anchorRef.current} />
    </div>
  );
}

const meta = {
  title: 'Components/ChapterSummaryPopover',
  component: AnchoredPopover,
  args: {
    chapter: { ...baseMeta, hasSummary: false, summaryIsStale: false },
    storyId: STORY_ID,
    modelId: 'venice-uncensored',
    onClose: () => {},
    onEdit: () => {},
  },
} satisfies Meta<typeof AnchoredPopover>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Current: Story = {
  args: {
    chapter: { ...baseMeta, hasSummary: true, summaryIsStale: false },
  },
  decorators: [
    withClient(
      buildBaseDetail({
        hasSummary: true,
        summaryIsStale: false,
        summary: sampleSummary,
        summaryUpdatedAt: SUMMARY_UPDATED_AT,
      }),
    ),
  ],
};

export const Stale: Story = {
  args: {
    chapter: { ...baseMeta, hasSummary: true, summaryIsStale: true },
  },
  decorators: [
    withClient(
      buildBaseDetail({
        hasSummary: true,
        summaryIsStale: true,
        summary: sampleSummary,
        summaryUpdatedAt: SUMMARY_UPDATED_AT,
      }),
    ),
  ],
};

export const Missing: Story = {
  args: {
    chapter: { ...baseMeta, hasSummary: false, summaryIsStale: false },
  },
  decorators: [
    withClient(
      buildBaseDetail({
        hasSummary: false,
        summaryIsStale: false,
        summary: null,
        summaryUpdatedAt: null,
      }),
    ),
  ],
};

export const Corrupted: Story = {
  args: {
    chapter: { ...baseMeta, hasSummary: true, summaryIsStale: false },
  },
  decorators: [
    withClient(
      buildBaseDetail({
        hasSummary: true,
        summaryIsStale: false,
        summary: null,
        summaryUpdatedAt: SUMMARY_UPDATED_AT,
      }),
    ),
  ],
};

/*
 * Generating: fetch is mocked so the summarise POST never resolves —
 * summariseMutation.isPending stays true after clicking "Generate summary".
 * The detail cache is pre-seeded (hasSummary:false) so the button is visible
 * on load; clicking it triggers the spinner + Cancel button.
 */
export const Generating: Story = {
  args: {
    chapter: { ...baseMeta, hasSummary: false, summaryIsStale: false },
    modelId: 'venice-uncensored',
  },
  decorators: [
    withClient(
      buildBaseDetail({
        hasSummary: false,
        summaryIsStale: false,
        summary: null,
        summaryUpdatedAt: null,
      }),
      { mockFetch: true },
    ),
  ],
};
