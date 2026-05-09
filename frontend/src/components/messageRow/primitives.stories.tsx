import type { Meta, StoryObj } from '@storybook/react-vite';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { type Model, modelsQueryKey } from '@/hooks/useModels';
import {
  AssistantBubble,
  CitationsSlot,
  CopyAction,
  InsertAtEndAction,
  MessageActions,
  MessageMeta,
  RegenerateAction,
  ThinkingBubble,
} from './primitives';

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
    <div className="bg-bg p-4 max-w-md">{Story()}</div>
  </QueryClientProvider>
);

const meta: Meta = {
  title: 'MessageRow/Primitives',
  decorators: [decorator],
};
export default meta;

type StoryT = StoryObj;

export const AssistantBubbleStory: StoryT = {
  name: 'AssistantBubble',
  render: () => (
    <AssistantBubble>
      Lorem ipsum dolor sit amet — a generated assistant response in the familiar serif body with an
      AI border accent.
    </AssistantBubble>
  ),
};

export const ThinkingBubbleStory: StoryT = {
  name: 'ThinkingBubble',
  render: () => (
    <div className="flex flex-col gap-3">
      <ThinkingBubble />
      <ThinkingBubble label="Generating scene…" />
    </div>
  ),
};

export const MessageMetaStory: StoryT = {
  name: 'MessageMeta',
  render: () => (
    <div className="flex flex-col gap-3">
      <MessageMeta model="venice-test" tokens={412} latencyMs={1800} />
      <MessageMeta model="venice-test" tokens={null} latencyMs={null} />
      <MessageMeta model={null} tokens={412} latencyMs={1800} />
    </div>
  ),
};

export const Actions: StoryT = {
  render: () => (
    <MessageActions>
      <CopyAction onClick={() => {}} />
      <RegenerateAction onClick={() => {}} />
      <InsertAtEndAction onClick={() => {}} />
    </MessageActions>
  ),
};

export const ActionsDisabled: StoryT = {
  name: 'Actions (disabled)',
  render: () => (
    <MessageActions>
      <CopyAction onClick={() => {}} disabled />
      <RegenerateAction onClick={() => {}} disabled />
      <InsertAtEndAction onClick={() => {}} disabled />
    </MessageActions>
  ),
};

export const CitationsSlotStory: StoryT = {
  name: 'CitationsSlot',
  render: () => (
    <div className="flex flex-col gap-3">
      <CitationsSlot citations={null} messageId="msg-empty" />
      <CitationsSlot
        citations={[
          {
            title: 'Example source',
            url: 'https://example.com',
            snippet: 'A representative snippet of relevant text.',
            publishedAt: null,
          },
        ]}
        messageId="msg-with"
      />
    </div>
  ),
};
