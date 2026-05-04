import type { Meta, StoryObj } from '@storybook/react-vite';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Button } from '@/design/primitives';
import type { Model } from '@/hooks/useModels';
import { modelsQueryKey } from '@/hooks/useModels';
import type { UserSettings } from '@/hooks/useUserSettings';
import { userSettingsQueryKey } from '@/hooks/useUserSettings';
import type { VeniceKeyStatus } from '@/hooks/useVeniceKey';
import { veniceKeyStatusQueryKey } from '@/hooks/useVeniceKey';
import { SettingsModal } from './Settings';

const SAMPLE_VENICE_STATUS: VeniceKeyStatus = {
  hasKey: true,
  lastSix: 'aB4f9c',
  endpoint: 'https://api.venice.ai/api/v1',
};

const SAMPLE_SETTINGS: UserSettings = {
  theme: 'paper',
  prose: { font: 'serif', size: 16, lineHeight: 1.6 },
  writing: {
    spellcheck: true,
    typewriterMode: false,
    focusMode: false,
    dailyWordGoal: 1000,
    smartQuotes: true,
    emDashExpansion: true,
  },
  chat: { model: 'llama-3.3-70b', temperature: 0.7, topP: 1, maxTokens: 2048 },
  ai: { includeVeniceSystemPrompt: true },
  prompts: {
    system: null,
    continue: null,
    rewrite: null,
    expand: null,
    summarise: null,
    describe: null,
  },
};

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
];

function makeClient(): QueryClient {
  const client = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        staleTime: Number.POSITIVE_INFINITY,
        gcTime: Number.POSITIVE_INFINITY,
      },
      mutations: { retry: false },
    },
  });
  client.setQueryData(veniceKeyStatusQueryKey, SAMPLE_VENICE_STATUS);
  client.setQueryData(userSettingsQueryKey, SAMPLE_SETTINGS);
  client.setQueryData(modelsQueryKey, SAMPLE_MODELS);
  return client;
}

interface DemoProps {
  initialTab?: 'venice' | 'models' | 'writing' | 'appearance';
}

function Demo({ initialTab = 'venice' }: DemoProps) {
  const [open, setOpen] = useState(true);

  // Settings always opens on the Venice tab. To preview a different tab
  // in Storybook we synthesise a click on the matching tab button after
  // the modal mounts.
  useEffect(() => {
    if (!open || initialTab === 'venice') return;
    const id = window.setTimeout(() => {
      const target = document.querySelector<HTMLButtonElement>(
        `[data-testid="settings-tab-${initialTab}"]`,
      );
      target?.click();
    }, 0);
    return () => {
      window.clearTimeout(id);
    };
  }, [open, initialTab]);

  return (
    <QueryClientProvider client={makeClient()}>
      <Button variant="ghost" onClick={() => setOpen(true)}>
        Reopen settings
      </Button>
      <SettingsModal open={open} onClose={() => setOpen(false)} />
    </QueryClientProvider>
  );
}

const meta = {
  title: 'Components/Settings',
  component: Demo,
} satisfies Meta<typeof Demo>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Venice: Story = {
  args: { initialTab: 'venice' },
};

export const Models: Story = {
  args: { initialTab: 'models' },
};

export const Writing: Story = {
  args: { initialTab: 'writing' },
};

export const Appearance: Story = {
  args: { initialTab: 'appearance' },
};
