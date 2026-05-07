import type { Meta, StoryObj } from '@storybook/react-vite';
import { BalanceDisplay } from './BalanceDisplay';

const meta = {
  title: 'Components/BalanceDisplay',
  component: BalanceDisplay,
} satisfies Meta<typeof BalanceDisplay>;

export default meta;
type Story = StoryObj<typeof meta>;

export const WithBalance: Story = {
  args: {
    balance: { verified: true, balanceUsd: 12.34, diem: 4200, endpoint: null, lastSix: null },
  },
};

export const PartialBalance: Story = {
  args: {
    balance: { verified: true, balanceUsd: 0.42, diem: null, endpoint: null, lastSix: null },
  },
};

export const Loading: Story = { args: { balance: null, isLoading: true } };

export const VeniceKeyRequired: Story = {
  args: { balance: null, isError: true, errorCode: 'venice_key_required' },
};

export const ErrorState: Story = {
  args: { balance: null, isError: true, errorCode: null },
};
