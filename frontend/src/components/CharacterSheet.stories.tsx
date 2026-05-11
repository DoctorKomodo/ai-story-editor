import type { Meta, StoryObj } from '@storybook/react-vite';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState } from 'react';
import type { Character } from 'story-editor-shared';
import { Button } from '@/design/primitives';
import { characterQueryKey } from '@/hooks/useCharacters';
import { CharacterSheet } from './CharacterSheet';

const STORY_ID = 'story-demo';
const CHARACTER_ID = 'ch1';
const CHARACTER_ID_FULL = 'ch2';

const sampleCharacter: Character = {
  id: CHARACTER_ID,
  storyId: STORY_ID,
  name: 'Lyra',
  role: 'protagonist',
  age: '27',
  appearance: 'Tall, with the kind of stillness that gets mistaken for shyness.',
  personality: 'Careful, curious, slow to anger but absolute once she gets there.',
  voice: 'Quiet, precise. Holds eye contact a beat longer than is comfortable.',
  backstory: null,
  arc: 'Learns to trust her own judgement after a series of avoidable misreadings.',
  relationships: null,
  orderIndex: 0,
  color: null,
  initial: null,
  createdAt: '2026-04-01T12:00:00Z',
  updatedAt: '2026-04-30T12:00:00Z',
};

const fullyPopulatedCharacter: Character = {
  id: CHARACTER_ID_FULL,
  storyId: STORY_ID,
  name: 'Imogen Thorne',
  role: 'protagonist',
  age: '34',
  appearance: 'tall, auburn hair shorn at the jaw',
  personality: 'wry, distrusts kindness, holds grudges',
  voice: 'measured alto with a Devon edge',
  backstory: 'Widowed at 28 when her husband died in the mining collapse.',
  arc: 'from grief-numbed widow to reluctant insurgent',
  relationships: 'Sister to Felix; estranged from her father.',
  orderIndex: 1,
  color: null,
  initial: null,
  createdAt: '2026-05-11T00:00:00.000Z',
  updatedAt: '2026-05-11T00:00:00.000Z',
};

function makeClient(): QueryClient {
  const client = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        staleTime: Number.POSITIVE_INFINITY,
        gcTime: Number.POSITIVE_INFINITY,
      },
    },
  });
  client.setQueryData(characterQueryKey(STORY_ID, CHARACTER_ID), sampleCharacter);
  return client;
}

function makeFullClient(): QueryClient {
  const client = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        staleTime: Number.POSITIVE_INFINITY,
        gcTime: Number.POSITIVE_INFINITY,
      },
    },
  });
  client.setQueryData(characterQueryKey(STORY_ID, CHARACTER_ID_FULL), fullyPopulatedCharacter);
  return client;
}

function Demo() {
  const [open, setOpen] = useState(true);
  return (
    <QueryClientProvider client={makeClient()}>
      <Button variant="ghost" onClick={() => setOpen(true)}>
        Reopen sheet
      </Button>
      {open ? (
        <CharacterSheet
          storyId={STORY_ID}
          mode="edit"
          characterId={CHARACTER_ID}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </QueryClientProvider>
  );
}

function DemoFullyPopulated() {
  const [open, setOpen] = useState(true);
  return (
    <QueryClientProvider client={makeFullClient()}>
      <Button variant="ghost" onClick={() => setOpen(true)}>
        Reopen sheet
      </Button>
      {open ? (
        <CharacterSheet
          storyId={STORY_ID}
          mode="edit"
          characterId={CHARACTER_ID_FULL}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </QueryClientProvider>
  );
}

const meta = {
  title: 'Components/CharacterSheet',
  component: Demo,
} satisfies Meta<typeof Demo>;

export default meta;
type Story = StoryObj<typeof meta>;

/**
 * Modal opens with the seeded character. Click "Delete" to reveal the
 * nested confirm alertdialog.
 */
export const Open: Story = {};

/**
 * All 9 fields populated — name, role, age, appearance, personality, voice,
 * backstory, arc, relationships. Exercises the full CharacterSheet surface
 * including the two fields added in the character-consolidation pass.
 */
export const FullyPopulated: Story = {
  render: () => <DemoFullyPopulated />,
};
