import type { Meta, StoryObj } from '@storybook/react';
import { VeniceErrorBanner } from './VeniceErrorBanner';

const meta: Meta<typeof VeniceErrorBanner> = {
  title: 'Components/VeniceErrorBanner',
  component: VeniceErrorBanner,
  parameters: { layout: 'padded' },
};

export default meta;
type Story = StoryObj<typeof VeniceErrorBanner>;

export const RateLimited: Story = {
  args: {
    error: {
      code: 'venice_rate_limited',
      message: 'Venice is rate limiting this request. Try again shortly.',
      retryAfterSeconds: 23,
      veniceMessage: 'Rate limit exceeded for model llama-3.1-70b.',
    },
    onRetry: () => {},
  },
};

export const KeyInvalid: Story = {
  args: {
    error: {
      code: 'venice_key_invalid',
      message: 'Your Venice API key was rejected. Please update it in Settings.',
      veniceMessage: 'Invalid bearer token.',
    },
    onRetry: () => {},
  },
};

export const KeyRequired: Story = {
  args: {
    error: {
      code: 'venice_key_required',
      message: 'No Venice API key is stored. Add yours in Settings to enable AI features.',
    },
  },
};

export const InsufficientBalance: Story = {
  args: {
    error: {
      code: 'venice_insufficient_balance',
      message:
        'Your Venice account is out of credits. Top up at https://venice.ai/settings/api to continue.',
      retryAfterSeconds: null,
      veniceMessage: 'INSUFFICIENT_BALANCE: account credit exhausted.',
    },
    onRetry: () => {},
  },
};

export const Unavailable: Story = {
  args: {
    error: {
      code: 'venice_unavailable',
      message: 'Venice is temporarily unavailable. Try again shortly.',
      veniceMessage: 'Upstream gateway timeout.',
    },
    onRetry: () => {},
  },
};

export const GenericError: Story = {
  args: {
    error: {
      code: 'venice_error',
      message: 'Venice rejected the request.',
      veniceMessage: 'Invalid model id "llama-99-trillion".',
    },
    onRetry: () => {},
  },
};

export const NoVeniceMessage: Story = {
  args: {
    error: {
      code: 'venice_error',
      message: 'Venice returned an unexpected error.',
    },
    onRetry: () => {},
  },
};
