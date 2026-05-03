import type { Meta, StoryObj } from '@storybook/react-vite';
import { ThinkingDots } from './ThinkingDots';

const meta: Meta<typeof ThinkingDots> = {
  title: 'Design/ThinkingDots',
  component: ThinkingDots,
  parameters: { layout: 'centered' },
};

export default meta;
type Story = StoryObj<typeof ThinkingDots>;

export const Default: Story = {};

export const CustomLabel: Story = {
  args: { label: 'Generating' },
};

export const InContext: Story = {
  render: () => (
    <div className="flex items-center gap-2 text-[13px] font-sans text-ink-3">
      <span>Inkwell is thinking</span>
      <ThinkingDots />
    </div>
  ),
};
