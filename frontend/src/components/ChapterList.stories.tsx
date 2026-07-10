import type { Meta, StoryObj } from '@storybook/react-vite';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ChapterMeta, DraftMeta } from 'story-editor-shared';
import { chaptersQueryKey } from '@/hooks/useChapters';
import { draftsQueryKey } from '@/hooks/useDrafts';
import { ChapterList } from './ChapterList';

const STORY_ID = 'story-demo';

const sampleChapters: ChapterMeta[] = [
  {
    id: 'c1',
    storyId: STORY_ID,
    title: 'The Churn at Dawn',
    wordCount: 2800,
    orderIndex: 0,
    hasSummary: false,
    summaryIsStale: false,
    createdAt: '2026-04-01T12:00:00Z',
    updatedAt: '2026-04-30T12:00:00Z',
    draftCount: 1,
    activeDraftId: 'draft-c1',
  },
  {
    id: 'c2',
    storyId: STORY_ID,
    title: 'A Visitor from the Other Wing',
    wordCount: 3100,
    orderIndex: 1,
    hasSummary: false,
    summaryIsStale: false,
    createdAt: '2026-04-02T12:00:00Z',
    updatedAt: '2026-04-30T12:00:00Z',
    draftCount: 1,
    activeDraftId: 'draft-c2',
  },
  {
    id: 'c3',
    storyId: STORY_ID,
    title: 'What Ilonoré Brought',
    wordCount: 2900,
    orderIndex: 2,
    hasSummary: true,
    summaryIsStale: false,
    createdAt: '2026-04-03T12:00:00Z',
    updatedAt: '2026-04-30T12:00:00Z',
    draftCount: 1,
    activeDraftId: 'draft-c3',
  },
  {
    id: 'c4',
    storyId: STORY_ID,
    title: 'The Weight of Ash',
    wordCount: 3500,
    orderIndex: 3,
    hasSummary: true,
    summaryIsStale: true,
    createdAt: '2026-04-04T12:00:00Z',
    updatedAt: '2026-04-30T12:00:00Z',
    draftCount: 1,
    activeDraftId: 'draft-c4',
  },
  {
    id: 'c5',
    storyId: STORY_ID,
    title: "Maulster's Jaw",
    wordCount: 2600,
    orderIndex: 4,
    hasSummary: false,
    summaryIsStale: false,
    createdAt: '2026-04-05T12:00:00Z',
    updatedAt: '2026-04-30T12:00:00Z',
    draftCount: 1,
    activeDraftId: 'draft-c5',
  },
  {
    id: 'c6',
    storyId: STORY_ID,
    title: '',
    wordCount: 0,
    orderIndex: 5,
    hasSummary: false,
    summaryIsStale: false,
    createdAt: '2026-04-06T12:00:00Z',
    updatedAt: '2026-04-30T12:00:00Z',
    draftCount: 1,
    activeDraftId: 'draft-c6',
  },
];

function withClient(seed: ChapterMeta[] | null) {
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
    if (seed !== null) {
      client.setQueryData(chaptersQueryKey(STORY_ID), seed);
    }
    return (
      <QueryClientProvider client={client}>
        <div style={{ width: 260 }}>
          <Story />
        </div>
      </QueryClientProvider>
    );
  };
}

function metaOf(overrides: Partial<DraftMeta> & Pick<DraftMeta, 'id' | 'orderIndex'>): DraftMeta {
  return {
    chapterId: 'c1',
    label: null,
    wordCount: 1200,
    isActive: false,
    hasSummary: false,
    summaryIsStale: false,
    createdAt: '2026-06-01T00:00:00.000Z',
    updatedAt: '2026-06-01T01:00:00.000Z',
    chatCount: 0,
    ...overrides,
  };
}

const draftTreeChapters: ChapterMeta[] = [
  { ...sampleChapters[0], draftCount: 3 },
  ...sampleChapters.slice(1),
];

function withDraftTreeClient() {
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
    client.setQueryData(chaptersQueryKey(STORY_ID), draftTreeChapters);
    client.setQueryData(draftsQueryKey('c1'), [
      metaOf({ id: 'd-a', orderIndex: 0, isActive: true, wordCount: 2143 }),
      metaOf({ id: 'd-b', orderIndex: 1, label: 'Grimdark ending', wordCount: 1890 }),
      metaOf({ id: 'd-c', orderIndex: 2, wordCount: 260 }),
    ]);
    return (
      <QueryClientProvider client={client}>
        <div style={{ width: 260 }}>
          <Story />
        </div>
      </QueryClientProvider>
    );
  };
}

const meta = {
  title: 'Components/ChapterList',
  component: ChapterList,
  args: {
    storyId: STORY_ID,
    activeChapterId: null,
    onSelectChapter: () => {},
    onOpenSummary: () => {},
    viewedDraftId: null,
    onSelectDraft: () => {},
    onRequestNewDraft: () => {},
  },
} satisfies Meta<typeof ChapterList>;

export default meta;
type Story = StoryObj<typeof meta>;

/**
 * Titles run full-width at rest; the per-chapter word count is a hover overlay
 * that fades in over the title's tail (no reflow). Hover a row to see it.
 */
export const Default: Story = {
  args: { activeChapterId: 'c1' },
  decorators: [withClient(sampleChapters)],
};

export const Empty: Story = {
  decorators: [withClient([])],
};

export const Loading: Story = {
  decorators: [withClient(null)],
};

/**
 * Click the × on the active row to see the inline Delete/Cancel pair.
 * The mutation will fail (no MSW handler) — what's being eyeballed is the
 * visual swap from word-count slot to the buttons.
 */
export const DeleteConfirm: Story = {
  args: { activeChapterId: 'c1' },
  decorators: [withClient(sampleChapters)],
};

/**
 * "The Churn at Dawn" (c1) has three drafts — its caret expands into the
 * DraftList tree. The rest of the chapters have a single draft each and show
 * the hover-revealed ＋ affordance instead.
 */
export const WithDraftTree: Story = {
  args: { activeChapterId: 'c1' },
  decorators: [withDraftTreeClient()],
};

// Uniform rows: a multi-draft chapter (caret) alongside active + inactive
// single-draft chapters (invisible caret spacer) — all rows the same width,
// no reflow on hover/select. c1 is multi-draft but not active, so it stays
// collapsed (no DraftList mount → no draftsQueryKey seed needed).
const uniformRowChapters: ChapterMeta[] = [
  { ...sampleChapters[0], draftCount: 2 },
  sampleChapters[1],
  sampleChapters[2],
];

export const UniformRows: Story = {
  args: { activeChapterId: 'c2' },
  decorators: [withClient(uniformRowChapters)],
};
