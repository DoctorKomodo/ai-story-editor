import type { Meta, StoryObj } from '@storybook/react-vite';
import { SceneComposer } from './SceneComposer';

const meta: Meta<typeof SceneComposer> = {
  title: 'Chat/SceneComposer',
  component: SceneComposer,
  args: { onGenerate: () => {}, onStop: () => {} },
  decorators: [
    (Story) => (
      <div style={{ width: 360 }}>
        <Story />
      </div>
    ),
  ],
};
export default meta;
type Story = StoryObj<typeof SceneComposer>;

export const Idle: Story = { args: { state: 'idle' } };
export const Streaming: Story = { args: { state: 'streaming' } };
