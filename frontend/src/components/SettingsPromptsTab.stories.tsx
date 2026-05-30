// frontend/src/components/SettingsPromptsTab.stories.tsx
//
// [X29] Storybook coverage for SettingsPromptsTab. Three states: all-default,
// system-overridden, every-row-overridden.

import type { Meta, StoryObj } from '@storybook/react-vite';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { JSX } from 'react';
import { type DefaultPrompts, defaultPromptsQueryKey } from '@/hooks/useDefaultPrompts';
import { DEFAULT_SETTINGS, type UserSettings, userSettingsQueryKey } from '@/hooks/useUserSettings';
import { SettingsPromptsTab } from './SettingsPromptsTab';

const DEFAULTS: DefaultPrompts = {
  system:
    'You are an expert creative-writing assistant. Help the author continue, refine, and develop their story…',
  continue:
    'continue the story from where the selection ends, matching the established voice. Aim for roughly 80–150 words.',
  rewrite:
    'rewrite the selection with different phrasing while preserving meaning and voice. Return a single alternative version.',
  expand:
    'expand the selection with more detail, description, and depth. Keep the same POV, tense, and voice.',
  summarise: 'summarise the selection to its essential points. Use 1–3 sentences.',
  summariseChapter:
    'Analyse the chapter and produce a structured JSON summary with keys: events (key plot events), stateAtEnd (character/world state at chapter end), openThreads (unresolved questions or threads).',
  describe:
    "describe the subject of the selection with vivid sensory, physical, and emotional detail. Maintain the story's POV and tense.",
  scene:
    'write a passage of prose that depicts the scene the user describes. Render the action and dialogue directly — do not summarise. Match the established voice, POV, and tense from the chapter so far. Aim for roughly 100–200 words unless the user specifies otherwise.',
  ask: "answer the user's question about the story. Use the chapter and character context to inform your answer.",
};

function withQueryClient(settings: UserSettings) {
  return (Story: () => JSX.Element): JSX.Element => {
    const qc = new QueryClient({
      defaultOptions: {
        queries: {
          retry: false,
          staleTime: Number.POSITIVE_INFINITY,
          gcTime: Number.POSITIVE_INFINITY,
        },
        mutations: { retry: false },
      },
    });
    qc.setQueryData(userSettingsQueryKey, settings);
    qc.setQueryData(defaultPromptsQueryKey, DEFAULTS);
    return (
      <QueryClientProvider client={qc}>
        <div className="bg-bg p-4 max-w-[640px]">
          <Story />
        </div>
      </QueryClientProvider>
    );
  };
}

const meta = {
  title: 'Settings/PromptsTab',
  component: SettingsPromptsTab,
} satisfies Meta<typeof SettingsPromptsTab>;
export default meta;
type Story = StoryObj<typeof meta>;

export const AllDefaults: Story = {
  decorators: [withQueryClient(DEFAULT_SETTINGS)],
};

export const SystemOverridden: Story = {
  decorators: [
    withQueryClient({
      ...DEFAULT_SETTINGS,
      prompts: { ...DEFAULT_SETTINGS.prompts, system: 'You are a gothic horror novelist.' },
    }),
  ],
};

export const EverythingOverridden: Story = {
  decorators: [
    withQueryClient({
      ...DEFAULT_SETTINGS,
      prompts: {
        system: 'Custom system.',
        continue: 'Custom continue.',
        rewrite: 'Custom rewrite.',
        expand: 'Custom expand.',
        summarise: 'Custom summarise.',
        summariseChapter: 'Custom chapter summary prompt.',
        describe: 'Custom describe.',
        scene: 'Custom scene.',
        ask: 'Custom ask.',
      },
    }),
  ],
};
