import type { Meta, StoryObj } from '@storybook/react';
import { useEffect } from 'react';
import { setDebugMode } from '@/lib/debug';
import { InlineErrorBanner } from './InlineErrorBanner';

const meta: Meta<typeof InlineErrorBanner> = {
  title: 'Errors/InlineErrorBanner',
  component: InlineErrorBanner,
};
export default meta;

type Story = StoryObj<typeof InlineErrorBanner>;

export const WithCodeAndMessage: Story = {
  args: {
    error: { code: 'venice_key_invalid', message: 'Your Venice API key was rejected.' },
  },
};

export const PlainMessage: Story = {
  args: {
    error: { code: null, message: 'Pick a model first.' },
  },
};

export const WithRetry: Story = {
  args: {
    error: { code: 'venice_unavailable', message: 'Venice is temporarily unavailable.' },
    onRetry: () => {
      // story-only
    },
  },
};

const DebugDecorator = (): React.ReactElement => {
  useEffect(() => {
    setDebugMode(true);
    return () => {
      setDebugMode(false);
    };
  }, []);
  return (
    <InlineErrorBanner
      error={{
        code: 'stream_error',
        message: 'The model stream errored mid-response.',
        httpStatus: 502,
        detail: { upstream: 'venice', frame: 'data: { ... }' },
      }}
      onRetry={() => {
        // story-only
      }}
    />
  );
};

export const DebugModeRawExpanded: Story = {
  render: () => <DebugDecorator />,
};
