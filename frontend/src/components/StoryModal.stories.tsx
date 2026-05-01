import type { Meta, StoryObj } from '@storybook/react-vite';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState } from 'react';
import { Button } from '@/design/primitives';
import type { StoryModalInitial, StoryModalMode } from './StoryModal';
import { StoryModal } from './StoryModal';

function makeClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        staleTime: Number.POSITIVE_INFINITY,
        gcTime: Number.POSITIVE_INFINITY,
      },
      mutations: { retry: false },
    },
  });
}

function Demo({ mode, initial }: { mode: StoryModalMode; initial?: StoryModalInitial }) {
  const [open, setOpen] = useState(true);
  return (
    <QueryClientProvider client={makeClient()}>
      <Button variant="ghost" onClick={() => setOpen(true)}>
        Reopen modal
      </Button>
      <StoryModal mode={mode} open={open} onClose={() => setOpen(false)} initial={initial} />
    </QueryClientProvider>
  );
}

const sampleStory: StoryModalInitial = {
  id: 's1',
  title: 'The Cartographer',
  genre: 'Literary fantasy',
  synopsis: 'A novel about borders, both real and imagined.',
  worldNotes:
    'The map is a contested document. Each region renders it differently; only one rendering is correct.',
};

const meta = {
  title: 'Components/StoryModal',
  component: Demo,
} satisfies Meta<typeof Demo>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Create: Story = {
  args: { mode: 'create' },
};

export const Edit: Story = {
  args: { mode: 'edit', initial: sampleStory },
};
