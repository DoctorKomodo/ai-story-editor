import type { Meta, StoryObj } from '@storybook/react-vite';
import type { ChatMessage } from '@/hooks/useChat';
import { UserMessageRow } from './UserMessageRow';

const baseMessage: ChatMessage = {
  id: 'msg-1',
  role: 'user',
  contentJson: 'Could you suggest an alternative title for this chapter?',
  attachmentJson: null,
  citationsJson: null,
  model: null,
  tokens: null,
  latencyMs: null,
  createdAt: new Date().toISOString(),
};

const meta: Meta<typeof UserMessageRow> = {
  title: 'MessageRow/UserMessageRow',
  component: UserMessageRow,
  decorators: [
    (Story) => (
      <ul className="bg-bg p-4 max-w-md flex flex-col gap-3">
        <Story />
      </ul>
    ),
  ],
};
export default meta;

type Story = StoryObj<typeof UserMessageRow>;

export const Plain: Story = {
  args: { message: baseMessage },
};

export const WithAttachment: Story = {
  args: {
    message: {
      ...baseMessage,
      attachmentJson: {
        selectionText: 'The fog rolled in over the moors that night, slow and silent.',
        chapterId: 'ch-1',
      },
    },
    chapterTitle: 'Chapter Three',
  },
};

export const LongContent: Story = {
  args: {
    message: {
      ...baseMessage,
      contentJson:
        'Could you draft three alternative chapter titles that emphasize tension rather than mystery? The current one is fine but feels too detached for the pacing of this section.',
    },
  },
};
