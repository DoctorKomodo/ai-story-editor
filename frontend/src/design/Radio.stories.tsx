import type { Meta, StoryObj } from '@storybook/react-vite';
import { RadioGroup } from './primitives';

const meta = {
  title: 'Primitives/Radio',
  component: RadioGroup,
  args: {
    name: 'demo',
    legend: 'Starting point',
    value: 'fork',
    onChange: () => {},
    options: [
      { value: 'fork', label: 'Fork active draft' },
      { value: 'blank', label: 'Start blank' },
    ],
  },
} satisfies Meta<typeof RadioGroup<string>>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
export const SrOnlyLegend: Story = { args: { srOnlyLegend: true } };
export const Disabled: Story = { args: { disabled: true } };
