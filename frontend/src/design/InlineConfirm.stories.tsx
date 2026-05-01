import type { Meta, StoryObj } from '@storybook/react-vite';
import { useRef } from 'react';
import { InlineConfirm, useInlineConfirm } from './primitives';

function Harness(): React.ReactElement {
  const hostRef = useRef<HTMLDivElement>(null);
  const confirm = useInlineConfirm(hostRef);

  return (
    <div ref={hostRef} style={{ width: 320 }}>
      <div className="flex items-center justify-between rounded border border-line p-2 bg-bg-elevated">
        <span className="font-sans text-[13px] text-ink">Threshold</span>
        {confirm.open ? (
          <InlineConfirm
            {...confirm.props}
            label="Delete chapter"
            onConfirm={() => {
              window.alert('confirmed');
              confirm.dismiss();
            }}
            testId="confirm"
          />
        ) : (
          <button
            type="button"
            onClick={confirm.ask}
            className="font-sans text-[12px] text-danger underline"
          >
            Delete
          </button>
        )}
      </div>
      <p className="mt-3 font-sans text-[11px] text-ink-4">
        Click outside the row to dismiss. Press Escape to dismiss. Press Enter to confirm.
      </p>
    </div>
  );
}

const meta = {
  title: 'Primitives/InlineConfirm',
  component: Harness,
} satisfies Meta<typeof Harness>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
