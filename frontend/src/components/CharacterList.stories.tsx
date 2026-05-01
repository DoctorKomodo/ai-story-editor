import type { Meta, StoryObj } from '@storybook/react-vite';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { Character } from '@/hooks/useCharacters';
import { charactersQueryKey } from '@/hooks/useCharacters';
import { CharacterList } from './CharacterList';

const STORY_ID = 'story-demo';

const sampleCharacters: Character[] = [
  {
    id: 'ch1',
    storyId: STORY_ID,
    name: 'Lyra',
    role: 'protagonist',
    age: '27',
    appearance: null,
    voice: null,
    arc: null,
    personality: null,
    createdAt: '2026-04-01T12:00:00Z',
    updatedAt: '2026-04-30T12:00:00Z',
  },
  {
    id: 'ch2',
    storyId: STORY_ID,
    name: 'Kade',
    role: 'antagonist',
    age: null,
    appearance: null,
    voice: null,
    arc: null,
    personality: null,
    createdAt: '2026-04-01T12:00:00Z',
    updatedAt: '2026-04-30T12:00:00Z',
  },
  {
    id: 'ch3',
    storyId: STORY_ID,
    name: '',
    role: null,
    age: null,
    appearance: null,
    voice: null,
    arc: null,
    personality: null,
    createdAt: '2026-04-01T12:00:00Z',
    updatedAt: '2026-04-30T12:00:00Z',
  },
];

function withClient(seed: Character[]) {
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
    client.setQueryData(charactersQueryKey(STORY_ID), seed);
    return (
      <QueryClientProvider client={client}>
        <div style={{ width: 240 }}>
          <Story />
        </div>
      </QueryClientProvider>
    );
  };
}

const meta = {
  title: 'Components/CharacterList',
  component: CharacterList,
  args: {
    storyId: STORY_ID,
    onOpenCharacter: () => {},
  },
} satisfies Meta<typeof CharacterList>;

export default meta;
type Story = StoryObj<typeof meta>;

export const WithCharacters: Story = {
  decorators: [withClient(sampleCharacters)],
};

export const Empty: Story = {
  decorators: [withClient([])],
};
