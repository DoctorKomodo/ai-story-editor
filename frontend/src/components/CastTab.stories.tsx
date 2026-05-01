import type { Meta, StoryObj } from '@storybook/react-vite';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useEffect } from 'react';
import type { Character } from '@/hooks/useCharacters';
import { useSelectedCharacterStore } from '@/store/selectedCharacter';
import { CastTab } from './CastTab';

const STORY_ID = 'story-demo';

const sampleCharacters: Character[] = [
  {
    id: 'c1',
    storyId: STORY_ID,
    name: 'Ilonoré Maulster',
    role: 'protagonist',
    age: '34',
    appearance: null,
    voice: null,
    arc: null,
    personality: null,
    orderIndex: 0,
    createdAt: '2026-04-01T12:00:00Z',
    updatedAt: '2026-04-01T12:00:00Z',
  },
  {
    id: 'c2',
    storyId: STORY_ID,
    name: 'Eliza Halsey',
    role: 'mentor',
    age: '62',
    appearance: null,
    voice: null,
    arc: null,
    personality: null,
    orderIndex: 1,
    createdAt: '2026-04-02T12:00:00Z',
    updatedAt: '2026-04-02T12:00:00Z',
  },
  {
    id: 'c3',
    storyId: STORY_ID,
    name: 'The Stranger',
    role: 'antagonist',
    age: null,
    appearance: null,
    voice: null,
    arc: null,
    personality: null,
    orderIndex: 2,
    createdAt: '2026-04-03T12:00:00Z',
    updatedAt: '2026-04-03T12:00:00Z',
  },
  {
    id: 'c4',
    storyId: STORY_ID,
    name: 'Cassidy Wren',
    role: 'ally',
    age: '28',
    appearance: null,
    voice: null,
    arc: null,
    personality: null,
    orderIndex: 3,
    createdAt: '2026-04-04T12:00:00Z',
    updatedAt: '2026-04-04T12:00:00Z',
  },
  {
    id: 'c5',
    storyId: STORY_ID,
    name: 'Father Obed',
    role: null,
    age: null,
    appearance: null,
    voice: null,
    arc: null,
    personality: null,
    orderIndex: 4,
    createdAt: '2026-04-05T12:00:00Z',
    updatedAt: '2026-04-05T12:00:00Z',
  },
];

function ResetSelected({
  to,
  children,
}: {
  to: string | null;
  children: React.ReactNode;
}): React.ReactElement {
  useEffect(() => {
    useSelectedCharacterStore.setState({ selectedCharacterId: to });
    return () => {
      useSelectedCharacterStore.setState({ selectedCharacterId: null });
    };
  }, [to]);
  return <>{children}</>;
}

function withClient(selected: string | null) {
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
    return (
      <QueryClientProvider client={client}>
        <ResetSelected to={selected}>
          <div style={{ width: 280, border: '1px solid var(--line)' }}>
            <Story />
          </div>
        </ResetSelected>
      </QueryClientProvider>
    );
  };
}

const meta = {
  title: 'Components/CastTab',
  component: CastTab,
  args: {
    storyId: STORY_ID,
    characters: sampleCharacters,
    onOpenCharacter: () => {},
    onCreateCharacter: () => undefined,
  },
} satisfies Meta<typeof CastTab>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  decorators: [withClient(null)],
};

export const WithSelected: Story = {
  decorators: [withClient('c2')],
};

/**
 * Click `×` on the selected card to see the inline Delete/Cancel pair. The
 * mutation will fail (no MSW handler) — the visual swap is what's being
 * eyeballed.
 */
export const DeleteConfirm: Story = {
  decorators: [withClient('c2')],
};

export const Empty: Story = {
  args: { characters: [] },
  decorators: [withClient(null)],
};

export const Loading: Story = {
  args: { characters: [], isLoading: true },
  decorators: [withClient(null)],
};

export const ErrorState: Story = {
  args: { characters: [], isError: true },
  decorators: [withClient(null)],
};
