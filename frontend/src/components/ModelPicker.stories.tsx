import type { Meta, StoryObj } from '@storybook/react-vite';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState } from 'react';
import { Button } from '@/design/primitives';
import type { Model } from '@/hooks/useModels';
import { modelsQueryKey } from '@/hooks/useModels';
import { DEFAULT_SETTINGS, userSettingsQueryKey } from '@/hooks/useUserSettings';
import { ModelPicker } from './ModelPicker';

const SAMPLE_MODELS: Model[] = [
  {
    id: 'venice-uncensored',
    name: 'Venice Uncensored',
    contextLength: 32_768,
    supportsReasoning: false,
    supportsVision: false,
    supportsWebSearch: false,
    description: null,
    pricing: null,
  },
  {
    id: 'llama-3.3-70b',
    name: 'Llama 3.3 70B',
    contextLength: 128_000,
    supportsReasoning: false,
    supportsVision: false,
    supportsWebSearch: true,
    description: null,
    pricing: null,
  },
  {
    id: 'deepseek-r1',
    name: 'DeepSeek R1',
    contextLength: 64_000,
    supportsReasoning: true,
    supportsVision: false,
    supportsWebSearch: false,
    description: null,
    pricing: null,
  },
];

function makeClient(models: Model[], selectedId: string | null): QueryClient {
  const client = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        staleTime: Number.POSITIVE_INFINITY,
        gcTime: Number.POSITIVE_INFINITY,
      },
    },
  });
  client.setQueryData(modelsQueryKey, models);
  // Seed the user-settings cache so one card renders as aria-checked=true.
  client.setQueryData(userSettingsQueryKey, {
    ...DEFAULT_SETTINGS,
    chat: { ...DEFAULT_SETTINGS.chat, model: selectedId },
  });
  return client;
}

function Demo({ models, selectedId }: { models: Model[]; selectedId: string | null }) {
  const [open, setOpen] = useState(true);
  return (
    <QueryClientProvider client={makeClient(models, selectedId)}>
      <Button variant="ghost" onClick={() => setOpen(true)}>
        Reopen picker
      </Button>
      <ModelPicker open={open} onClose={() => setOpen(false)} />
    </QueryClientProvider>
  );
}

const meta = {
  title: 'Components/ModelPicker',
  component: Demo,
} satisfies Meta<typeof Demo>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Open: Story = {
  args: { models: SAMPLE_MODELS, selectedId: 'llama-3.3-70b' },
};

export const Empty: Story = {
  args: { models: [], selectedId: null },
};
