import type { Meta, StoryObj } from '@storybook/react-vite';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState } from 'react';
import { Button } from '@/design/primitives';
import type { Model } from '@/hooks/useModels';
import { modelsQueryKey } from '@/hooks/useModels';
import type { UserSettings } from '@/hooks/useUserSettings';
import { userSettingsQueryKey } from '@/hooks/useUserSettings';
import type { VeniceKeyStatus } from '@/hooks/useVeniceKey';
import { veniceKeyStatusQueryKey } from '@/hooks/useVeniceKey';
import type { SettingsTab } from './Settings';
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
  chat: { model: 'llama-3.3-70b', overrides: {} },
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
    maxCompletionTokens: 8_192,
    supportsReasoning: false,
    supportsVision: false,
    supportsWebSearch: false,
    description: 'An uncensored model tuned for creative and adult content.',
    pricing: { inputUsdPerMTok: 0.18, outputUsdPerMTok: 0.18 },
    defaultTemperature: null,
    defaultTopP: null,
  },
  {
    id: 'llama-3.3-70b',
    name: 'Llama 3.3 70B',
    contextLength: 128_000,
    maxCompletionTokens: 16_384,
    supportsReasoning: false,
    supportsVision: false,
    supportsWebSearch: true,
    description: "Meta's Llama 3.3 70B — fast and capable general-purpose model.",
    pricing: { inputUsdPerMTok: 0.12, outputUsdPerMTok: 0.36 },
    defaultTemperature: null,
    defaultTopP: null,
  },
];

// ModelsTabNoSelection variant: no model selected yet.
const SAMPLE_SETTINGS_NO_MODEL: UserSettings = {
  ...SAMPLE_SETTINGS,
  chat: { ...SAMPLE_SETTINGS.chat, model: null },
};

function makeClient(settings: UserSettings = SAMPLE_SETTINGS): QueryClient {
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
  client.setQueryData(userSettingsQueryKey, settings);
  client.setQueryData(modelsQueryKey, SAMPLE_MODELS);
  return client;
}

interface DemoProps {
  initialTab?: SettingsTab;
  noModelSelected?: boolean;
}

function Demo({ initialTab = 'venice', noModelSelected = false }: DemoProps) {
  const [open, setOpen] = useState(true);
  const settings = noModelSelected ? SAMPLE_SETTINGS_NO_MODEL : SAMPLE_SETTINGS;

  return (
    <QueryClientProvider client={makeClient(settings)}>
      <Button variant="ghost" onClick={() => setOpen(true)}>
        Reopen settings
      </Button>
      <SettingsModal open={open} onClose={() => setOpen(false)} initialTab={initialTab} />
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

export const ModelsTabNoSelection: Story = {
  args: { initialTab: 'models', noModelSelected: true },
};

export const Writing: Story = {
  args: { initialTab: 'writing' },
};

export const Appearance: Story = {
  args: { initialTab: 'appearance' },
};

export const Prompts: Story = {
  args: { initialTab: 'prompts' },
};
