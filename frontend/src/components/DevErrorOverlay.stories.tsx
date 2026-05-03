import type { Meta, StoryObj } from '@storybook/react';
import { useEffect } from 'react';
import { setDebugMode } from '@/lib/debug';
import { useErrorStore } from '@/store/errors';
import { DevErrorOverlay } from './DevErrorOverlay';

const meta: Meta<typeof DevErrorOverlay> = {
  title: 'Errors/DevErrorOverlay',
  component: DevErrorOverlay,
};
export default meta;

type Story = StoryObj<typeof DevErrorOverlay>;

function Seeder({ debug, seed }: { debug: boolean; seed: () => void }): React.ReactElement {
  useEffect(() => {
    setDebugMode(debug);
    useErrorStore.getState().clear();
    seed();
    return () => {
      useErrorStore.getState().clear();
      setDebugMode(false);
    };
  }, [debug, seed]);
  return <DevErrorOverlay />;
}

export const Empty: Story = {
  render: () => <Seeder debug={true} seed={() => undefined} />,
};

export const SingleError: Story = {
  render: () => (
    <Seeder
      debug={false}
      seed={() => {
        useErrorStore.getState().push({
          severity: 'error',
          source: 'ai.complete',
          code: 'venice_key_invalid',
          message: 'Your Venice API key was rejected.',
        });
      }}
    />
  ),
};

export const DebugStackWithRaw: Story = {
  render: () => (
    <Seeder
      debug={true}
      seed={() => {
        useErrorStore.getState().push({
          severity: 'error',
          source: 'ai.complete',
          code: 'stream_error',
          message: 'The model stream errored.',
          detail: { upstream: 'venice', status: 502 },
          httpStatus: 502,
        });
        useErrorStore.getState().push({
          severity: 'warn',
          source: 'chat.send',
          code: 'no_model',
          message: 'Pick a model first.',
        });
      }}
    />
  ),
};
