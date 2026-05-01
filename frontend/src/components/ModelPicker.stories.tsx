import type { Meta, StoryObj } from '@storybook/react-vite';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState } from 'react';
import { Button } from '@/design/primitives';
import type { Model } from '@/hooks/useModels';
import { modelsQueryKey } from '@/hooks/useModels';
import { useModelStore } from '@/store/model';
import { ModelPicker } from './ModelPicker';

const SAMPLE_MODELS: Model[] = [
  {
    id: 'venice-uncensored',
    name: 'Venice Uncensored',
    contextLength: 32_768,
    supportsReasoning: false,
    supportsVision: false,
    supportsWebSearch: false,
  },
  {
    id: 'llama-3.3-70b',
    name: 'Llama 3.3 70B',
    contextLength: 128_000,
    supportsReasoning: false,
    supportsVision: false,
    supportsWebSearch: true,
  },
  {
    id: 'deepseek-r1',
    name: 'DeepSeek R1',
    contextLength: 64_000,
    supportsReasoning: true,
    supportsVision: false,
    supportsWebSearch: false,
  },
];

function makeClient(models: Model[]): QueryClient {
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
  return client;
}

function Demo({ models, selectedId }: { models: Model[]; selectedId: string | null }) {
  const [open, setOpen] = useState(true);
  // Seed the selection so one card renders as `aria-checked=true`.
  if (useModelStore.getState().modelId !== selectedId) {
    useModelStore.setState({ modelId: selectedId });
  }
  return (
    <QueryClientProvider client={makeClient(models)}>
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
