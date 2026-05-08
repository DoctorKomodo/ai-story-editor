import type { Meta, StoryObj } from '@storybook/react-vite';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useEffect } from 'react';
import { type Model, modelsQueryKey } from '@/hooks/useModels';
import { DEFAULT_SETTINGS, type UserSettings, userSettingsQueryKey } from '@/hooks/useUserSettings';
import { useAttachedSelectionStore } from '@/store/attachedSelection';
import { ChatComposer } from './ChatComposer';

const PLAIN_MODEL: Model = {
  id: 'qwen-3-6-plus',
  name: 'Qwen 3.6 Plus',
  contextLength: 32_000,
  maxCompletionTokens: 4096,
  supportsReasoning: false,
  supportsVision: false,
  supportsWebSearch: false,
  description: null,
  pricing: null,
  defaultTemperature: 0.7,
  defaultTopP: 1,
};

const WEB_SEARCH_MODEL: Model = {
  ...PLAIN_MODEL,
  id: 'venice-uncensored',
  supportsWebSearch: true,
};

function makeClient(model: Model): QueryClient {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  qc.setQueryData<UserSettings>(userSettingsQueryKey, {
    ...DEFAULT_SETTINGS,
    chat: { ...DEFAULT_SETTINGS.chat, model: model.id },
  });
  qc.setQueryData<Model[]>(modelsQueryKey, [model]);
  return qc;
}

const meta: Meta<typeof ChatComposer> = {
  title: 'Chat/ChatComposer',
  component: ChatComposer,
  args: { onSend: () => {}, onStop: () => {} },
  decorators: [
    (Story) => (
      <QueryClientProvider client={makeClient(PLAIN_MODEL)}>
        <div style={{ width: 360 }}>
          <Story />
        </div>
      </QueryClientProvider>
    ),
  ],
};
export default meta;
type Story = StoryObj<typeof ChatComposer>;

export const Idle: Story = { args: { state: 'idle' } };

export const Streaming: Story = { args: { state: 'streaming' } };

export const IdleWithAttachment: Story = {
  args: { state: 'idle' },
  decorators: [
    (Story) => {
      // Seed the attached-selection store on mount; clear on unmount so other
      // stories don't inherit the attachment.
      useEffect(() => {
        useAttachedSelectionStore.getState().setAttachedSelection({
          chapter: { id: 'ch1', number: 4, title: 'The veranda' },
          text: 'Linda was already there with two glasses of something sweating onto the rail.',
        });
        return () => {
          useAttachedSelectionStore.getState().clear();
        };
      }, []);
      return <Story />;
    },
  ],
};

export const WebSearchToggleVisible: Story = {
  args: { state: 'idle' },
  decorators: [
    (Story) => (
      <QueryClientProvider client={makeClient(WEB_SEARCH_MODEL)}>
        <div style={{ width: 360 }}>
          <Story />
        </div>
      </QueryClientProvider>
    ),
  ],
};
