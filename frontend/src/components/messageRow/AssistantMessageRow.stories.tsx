import type { Meta, StoryObj } from '@storybook/react-vite';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ChatMessage } from '@/hooks/useChat';
import { type Model, modelsQueryKey } from '@/hooks/useModels';
import { AssistantMessageRow } from './AssistantMessageRow';
import { CopyAction, InsertAtEndAction, MessageActions, RegenerateAction } from './primitives';

const FIXTURE_MODEL: Model = {
  id: 'venice-test',
  name: 'Venice Test 70B',
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

const qc = new QueryClient();
qc.setQueryData<Model[]>(modelsQueryKey, [FIXTURE_MODEL]);

const decorator = (Story: () => React.ReactNode) => (
  <QueryClientProvider client={qc}>
    <ul className="bg-bg p-4 max-w-md flex flex-col gap-3">
      <Story />
    </ul>
  </QueryClientProvider>
);

const baseMessage: ChatMessage = {
  id: 'msg-a1',
  role: 'assistant',
  contentJson:
    'The fog rolled in over the moors that night, slow and silent, as if the land itself were exhaling after a long day of pretending to be ordinary.',
  attachmentJson: null,
  citationsJson: null,
  model: 'venice-test',
  tokens: 312,
  latencyMs: 2100,
  createdAt: new Date().toISOString(),
};

const meta: Meta<typeof AssistantMessageRow> = {
  title: 'MessageRow/AssistantMessageRow',
  component: AssistantMessageRow,
  decorators: [decorator],
};
export default meta;

type Story = StoryObj<typeof AssistantMessageRow>;

/** Chat tab variant — Copy + Regenerate actions. */
export const ChatVariant: Story = {
  args: {
    message: baseMessage,
    actions: (
      <MessageActions>
        <CopyAction onClick={() => {}} />
        <RegenerateAction onClick={() => {}} />
      </MessageActions>
    ),
  },
};

/** Scene tab variant — Insert at end + Copy + Regenerate actions. */
export const SceneVariant: Story = {
  args: {
    message: {
      ...baseMessage,
      id: 'msg-a2',
      contentJson:
        'She adjusted her collar against the wind and stepped onto the empty platform. No one had come to meet her. No one ever did anymore.',
    },
    actions: (
      <MessageActions>
        <InsertAtEndAction onClick={() => {}} />
        <CopyAction onClick={() => {}} />
        <RegenerateAction onClick={() => {}} />
      </MessageActions>
    ),
  },
};

/** Streaming state — empty content, no label (default ThinkingDots). */
export const StreamingChat: Story = {
  args: {
    message: {
      ...baseMessage,
      id: 'msg-a3',
      contentJson: '',
      tokens: null,
      latencyMs: null,
    },
    actions: null,
    isStreaming: true,
  },
};

/** Streaming state — empty content, custom label passed to ThinkingBubble. */
export const StreamingScene: Story = {
  args: {
    message: {
      ...baseMessage,
      id: 'msg-a4',
      contentJson: '',
      tokens: null,
      latencyMs: null,
    },
    actions: null,
    isStreaming: true,
    thinkingLabel: 'Generating scene…',
  },
};
