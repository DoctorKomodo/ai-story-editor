import type { Meta, StoryObj } from '@storybook/react-vite';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { chatMessagesQueryKey } from '@/hooks/useChat';
import type { ChatMessage } from '@/hooks/useChat';
import { modelsQueryKey } from '@/hooks/useModels';
import type { Model } from '@/hooks/useModels';
import { AssistantMessageRow } from './AssistantMessageRow';
import { CopyAction, MessageActions, RegenerateAction } from './primitives';
import { TranscriptView } from './TranscriptView';
import { UserMessageRow } from './UserMessageRow';

function buildMessages(): ChatMessage[] {
  return [
    {
      id: 'm-1',
      role: 'user',
      contentJson: 'Could you suggest an alternative title for this chapter?',
      attachmentJson: null,
      citationsJson: null,
      model: null,
      tokens: null,
      latencyMs: null,
      createdAt: new Date(Date.now() - 60_000).toISOString(),
    },
    {
      id: 'm-2',
      role: 'assistant',
      contentJson:
        'Three alternative titles: "After the Fog"; "Silent Moors"; "What Came That Night."',
      attachmentJson: null,
      citationsJson: null,
      model: 'venice-test',
      tokens: 412,
      latencyMs: 1800,
      createdAt: new Date().toISOString(),
    },
  ];
}

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

function withSeed(messages: ChatMessage[]): QueryClient {
  const qc = new QueryClient();
  qc.setQueryData(chatMessagesQueryKey('demo-chat'), messages);
  qc.setQueryData<Model[]>(modelsQueryKey, [FIXTURE_MODEL]);
  return qc;
}

const meta: Meta<typeof TranscriptView> = {
  title: 'MessageRow/TranscriptView',
  component: TranscriptView,
};
export default meta;

type Story = StoryObj<typeof TranscriptView>;

export const WithMessages: Story = {
  render: () => {
    const qc = withSeed(buildMessages());
    return (
      <QueryClientProvider client={qc}>
        <div className="bg-bg h-[400px] flex flex-col">
          <TranscriptView
            chatId="demo-chat"
            emptyState={<div className="m-auto text-ink-3">Start a conversation</div>}
          >
            {(rows) =>
              rows.map((r, i) => {
                if (r.kind === 'persisted' && r.message.role === 'user') {
                  return <UserMessageRow key={i} message={r.message} />;
                }
                if (r.kind === 'persisted') {
                  return (
                    <AssistantMessageRow
                      key={i}
                      message={r.message}
                      actions={
                        <MessageActions>
                          <CopyAction onClick={() => {}} />
                          <RegenerateAction onClick={() => {}} />
                        </MessageActions>
                      }
                    />
                  );
                }
                return null;
              })
            }
          </TranscriptView>
        </div>
      </QueryClientProvider>
    );
  },
};

export const Empty: Story = {
  render: () => {
    const qc = new QueryClient();
    qc.setQueryData(chatMessagesQueryKey('demo-chat'), []);
    return (
      <QueryClientProvider client={qc}>
        <div className="bg-bg h-[400px] flex flex-col">
          <TranscriptView
            chatId="demo-chat"
            emptyState={<div className="m-auto text-ink-3">Start a conversation</div>}
          >
            {() => null}
          </TranscriptView>
        </div>
      </QueryClientProvider>
    );
  },
};
