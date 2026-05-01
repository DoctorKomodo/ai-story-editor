import type { Meta, StoryObj } from '@storybook/react-vite';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { Button } from '@/design/primitives';
import { AccountPrivacyModal } from './AccountPrivacyModal';

function makeClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        staleTime: Number.POSITIVE_INFINITY,
        gcTime: Number.POSITIVE_INFINITY,
      },
      mutations: { retry: false },
    },
  });
}

interface DemoProps {
  /**
   * When `true`, the story auto-clicks "Generate new code" on mount so
   * <RecoveryCodeHandoff> renders inside the second section. The mutation
   * is mocked via a one-shot fetch stub; it never hits the network.
   */
  withRecoveryCode?: boolean;
}

function Demo({ withRecoveryCode = false }: DemoProps) {
  const [open, setOpen] = useState(true);

  useEffect(() => {
    if (!withRecoveryCode) return;
    // Fake the rotate-recovery-code endpoint so the section flips into its
    // post-success "Save your recovery code" view.
    const realFetch = window.fetch;
    window.fetch = async (input, init): Promise<Response> => {
      const url = typeof input === 'string' ? input : input instanceof Request ? input.url : '';
      if (url.includes('/auth/rotate-recovery-code')) {
        return new Response(JSON.stringify({ recoveryCode: 'demo-recovery-code-9999-aaaa' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return realFetch(input, init);
    };
    return () => {
      window.fetch = realFetch;
    };
  }, [withRecoveryCode]);

  return (
    // Sign-out-everywhere uses `useNavigate` to bounce to /login on success;
    // wrap in MemoryRouter so the hook resolves a Router context inside the
    // isolated story preview.
    <MemoryRouter>
      <QueryClientProvider client={makeClient()}>
        <Button variant="ghost" onClick={() => setOpen(true)}>
          Reopen modal
        </Button>
        <AccountPrivacyModal open={open} onClose={() => setOpen(false)} username="alice" />
      </QueryClientProvider>
    </MemoryRouter>
  );
}

const meta = {
  title: 'Components/AccountPrivacyModal',
  component: Demo,
} satisfies Meta<typeof Demo>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Open with all four sections collapsed to their default state. */
export const Open: Story = {};

/**
 * Submit "Generate new code" with any password to land on the
 * <RecoveryCodeHandoff> view, which gates dismissal of the parent modal
 * (close-X / Done / Escape / backdrop are all disabled until Continue).
 */
export const WithConfirm: Story = {
  args: { withRecoveryCode: true },
};
