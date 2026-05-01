import type { Meta, StoryObj } from '@storybook/react-vite';
import { BalanceDisplay } from './BalanceDisplay';

const meta = {
  title: 'Components/BalanceDisplay',
  component: BalanceDisplay,
} satisfies Meta<typeof BalanceDisplay>;

export default meta;
type Story = StoryObj<typeof meta>;

export const WithBalance: Story = {
  args: { balance: { credits: 12.34, diem: 4200 } },
};

export const PartialBalance: Story = {
  args: { balance: { credits: 0.42, diem: null } },
};

export const Loading: Story = { args: { balance: null, isLoading: true } };

export const VeniceKeyRequired: Story = {
  args: { balance: null, isError: true, errorCode: 'venice_key_required' },
};

export const ErrorState: Story = {
  args: { balance: null, isError: true, errorCode: null },
};
