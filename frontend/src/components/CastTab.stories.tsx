import type { Meta, StoryObj } from '@storybook/react-vite';
import type { Character } from '@/hooks/useCharacters';
import { CastTab } from './CastTab';

const STORY_ID = 'story-demo';

const sampleCharacters: Character[] = [
  {
    id: 'ch1',
    storyId: STORY_ID,
    name: 'Maren Oake',
    role: 'protagonist',
    age: '19',
    appearance: null,
    voice: null,
    arc: null,
    personality: null,
    orderIndex: 0,
    createdAt: '2026-04-01T12:00:00Z',
    updatedAt: '2026-04-30T12:00:00Z',
  },
  {
    id: 'ch2',
    storyId: STORY_ID,
    name: 'The Stranger',
    role: 'mentor / mystery',
    age: null,
    appearance: null,
    voice: null,
    arc: null,
    personality: null,
    orderIndex: 1,
    createdAt: '2026-04-01T12:00:00Z',
    updatedAt: '2026-04-30T12:00:00Z',
  },
  {
    id: 'ch3',
    storyId: STORY_ID,
    name: 'Captain Brel',
    role: 'antagonist',
    age: '54',
    appearance: null,
    voice: null,
    arc: null,
    personality: null,
    orderIndex: 2,
    createdAt: '2026-04-01T12:00:00Z',
    updatedAt: '2026-04-30T12:00:00Z',
  },
  {
    id: 'ch4',
    storyId: STORY_ID,
    name: 'Inken Vael',
    role: 'supporting',
    age: null,
    appearance: null,
    voice: null,
    arc: null,
    personality: null,
    orderIndex: 3,
    createdAt: '2026-04-01T12:00:00Z',
    updatedAt: '2026-04-30T12:00:00Z',
  },
  {
    id: 'ch5',
    storyId: STORY_ID,
    // Anonymous + role/age unset — exercises the "Untitled" fallback and
    // suppresses the secondary line.
    name: '',
    role: null,
    age: null,
    appearance: null,
    voice: null,
    arc: null,
    personality: null,
    orderIndex: 4,
    createdAt: '2026-04-01T12:00:00Z',
    updatedAt: '2026-04-30T12:00:00Z',
  },
];

function sidebarFrame(Story: () => React.ReactElement): React.ReactElement {
  return (
    <div style={{ width: 240 }}>
      <Story />
    </div>
  );
}

const meta = {
  title: 'Components/CastTab',
  component: CastTab,
  args: {
    onOpenCharacter: () => {},
  },
  decorators: [sidebarFrame],
} satisfies Meta<typeof CastTab>;

export default meta;
type Story = StoryObj<typeof meta>;

export const PrincipalAndSupporting: Story = {
  args: { characters: sampleCharacters },
};

export const PrincipalOnly: Story = {
  args: { characters: sampleCharacters.slice(0, 2) },
};

export const Empty: Story = {
  args: { characters: [] },
};

export const Loading: Story = {
  args: { characters: [], isLoading: true },
};

export const ErrorState: Story = {
  args: { characters: [], isError: true },
};
