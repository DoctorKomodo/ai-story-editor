import type { Meta, StoryObj } from '@storybook/react-vite';
import { SceneCandidateCard } from './SceneCandidateCard';

const meta: Meta<typeof SceneCandidateCard> = {
  title: 'Chat/SceneCandidateCard',
  component: SceneCandidateCard,
  args: {
    direction: 'Jenny approaches Linda on the veranda and they talk about cheese.',
    candidate:
      'Linda was already at the railing when Jenny stepped onto the veranda, a glass of something amber in her hand. The late sun caught the liquid as she raised it in a half-toast, not quite meeting Jenny\'s eyes.\n\n"Gruyère or Comté?" Linda said, as though the conversation had never stopped.',
    model: 'Llama 3.3 70B',
    onInsert: () => {},
    onRetry: () => {},
    onCopy: () => {},
  },
  parameters: { layout: 'centered' },
  decorators: [
    (Story) => (
      <div style={{ width: 360 }}>
        <Story />
      </div>
    ),
  ],
};
export default meta;
type Story = StoryObj<typeof SceneCandidateCard>;

export const LatestDone: Story = { args: { state: 'done', isLatest: true } };
export const SupersededDone: Story = { args: { state: 'done', isLatest: false } };
/** Streaming with content — LLM is mid-response, tokens are arriving. */
export const Streaming: Story = { args: { state: 'streaming', isLatest: true } };
/** Streaming, empty — request just fired, no tokens yet; shows thinking dots. */
export const StreamingEmpty: Story = {
  args: { state: 'streaming', isLatest: true, candidate: '' },
};
export const ErrorState: Story = { args: { state: 'error', isLatest: true } };
