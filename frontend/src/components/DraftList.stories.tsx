import type { Meta, StoryObj } from '@storybook/react-vite';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { DraftMeta } from 'story-editor-shared';
import { userEvent, within } from 'storybook/test';
import { DraftList } from '@/components/DraftList';
import { draftsQueryKey } from '@/hooks/useDrafts';

function seeded(drafts: DraftMeta[]): QueryClient {
  // staleTime: Infinity — no network in Storybook; the seed is the data.
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  qc.setQueryData(draftsQueryKey('ch-1'), drafts);
  return qc;
}

function metaOf(overrides: Partial<DraftMeta> & Pick<DraftMeta, 'id' | 'orderIndex'>): DraftMeta {
  return {
    chapterId: 'ch-1',
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

const THREE_DRAFTS = [
  metaOf({ id: 'd-a', orderIndex: 0, isActive: true, wordCount: 2143 }),
  metaOf({ id: 'd-b', orderIndex: 1, label: 'Grimdark ending', wordCount: 1890 }),
  metaOf({ id: 'd-c', orderIndex: 2, wordCount: 260 }),
];

const meta: Meta<typeof DraftList> = {
  title: 'Components/DraftList',
  component: DraftList,
  args: {
    chapterId: 'ch-1',
    storyId: 'story-1',
    viewedDraftId: 'd-b',
  },
  argTypes: {
    onSelectDraft: { action: 'selectDraft' },
    onRequestNewDraft: { action: 'requestNewDraft' },
    onStatus: { action: 'status' },
  },
  decorators: [
    (Story) => (
      <QueryClientProvider client={seeded(THREE_DRAFTS)}>
        <div className="w-64 p-2 bg-bg">
          <Story />
        </div>
      </QueryClientProvider>
    ),
  ],
};
export default meta;

type Story = StoryObj<typeof DraftList>;

export const ViewingNonActiveDraft: Story = {};

export const FollowingActiveDraft: Story = {
  args: { viewedDraftId: 'd-a' },
};

const WITH_ATTACHED_CHATS = [
  metaOf({ id: 'd-a', orderIndex: 0, isActive: true, wordCount: 2143 }),
  metaOf({ id: 'd-b', orderIndex: 1, label: 'Grimdark ending', wordCount: 1890, chatCount: 3 }),
  metaOf({ id: 'd-c', orderIndex: 2, wordCount: 260 }),
];

export const DeleteWarnsOnAttachedChats: Story = {
  decorators: [
    (Story) => (
      <QueryClientProvider client={seeded(WITH_ATTACHED_CHATS)}>
        <div className="w-64 p-2 bg-bg">
          <Story />
        </div>
      </QueryClientProvider>
    ),
  ],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByTestId('draft-row-d-b-delete'));
    await canvas.findByTestId('draft-row-d-b-confirm-modal');
  },
};
