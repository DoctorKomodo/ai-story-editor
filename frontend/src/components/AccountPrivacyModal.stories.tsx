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
  /**
   * When `true`, the story drives the modal into the recovery-code takeover
   * variant — fills the rotate-section password input with a placeholder
   * value and clicks "Generate new code". The mutation is mocked to return
   * a fixed code so the takeover header / <RecoveryCodeCard> render with
   * stable content for visual review.
   */
  rotateTakeover?: boolean;
  /**
   * When `true`, the story drives the modal into the delete-account
   * takeover variant by clicking the "Delete account…" trigger button.
   * No mutation fires until the user submits, so no fetch mock is needed.
   * Inputs render empty and the destructive button stays disabled.
   */
  deleteAccountTakeover?: boolean;
}

function Demo({
  withRecoveryCode = false,
  rotateTakeover = false,
  deleteAccountTakeover = false,
}: DemoProps) {
  const [open, setOpen] = useState(true);

  const mockRotate = withRecoveryCode || rotateTakeover;

  useEffect(() => {
    if (!mockRotate) return;
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
  }, [mockRotate]);

  useEffect(() => {
    if (!rotateTakeover) return;
    // Drive into the recovery-code takeover: scope to the "Rotate recovery
    // code" <section aria-label="…"> (which is also the change-password
    // pattern, hence the scoping) and submit it with a placeholder password.
    // The fetch mock above turns that into a fixed code, which flips the
    // modal into its takeover shell with <RecoveryCodeCard>.
    const id = window.setTimeout(() => {
      const region = document.querySelector(
        'section[aria-label="Rotate recovery code"]',
      ) as HTMLElement | null;
      if (!region) return;
      const passwordInput = region.querySelector(
        'input[type="password"]',
      ) as HTMLInputElement | null;
      const generateButton = Array.from(region.querySelectorAll('button')).find(
        (b) => b.textContent?.trim().toLowerCase() === 'generate new code',
      );
      if (!passwordInput || !generateButton) return;
      // React's controlled-input pattern requires us to invoke the native
      // value setter so the synthetic onChange picks up the new value.
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        'value',
      )?.set;
      setter?.call(passwordInput, 'pw');
      passwordInput.dispatchEvent(new Event('input', { bubbles: true }));
      generateButton.click();
    }, 0);
    return () => {
      window.clearTimeout(id);
    };
  }, [rotateTakeover]);

  useEffect(() => {
    if (!deleteAccountTakeover) return;
    // Drive into the delete-account takeover: scope to the "Delete account"
    // <section aria-label="…"> and click its only button — the "Delete
    // account…" trigger. The section heading is rendered as <h3>, not a
    // button, so this is unambiguous.
    const id = window.setTimeout(() => {
      const region = document.querySelector(
        'section[aria-label="Delete account"]',
      ) as HTMLElement | null;
      if (!region) return;
      const trigger = Array.from(region.querySelectorAll('button')).find((b) =>
        b.textContent?.trim().startsWith('Delete account'),
      );
      trigger?.click();
    }, 0);
    return () => {
      window.clearTimeout(id);
    };
  }, [deleteAccountTakeover]);

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

/**
 * Modal in its recovery-code takeover variant — the rotate flow has issued
 * a (fixed, mocked) code, the modal shell has swapped to the "Save your
 * new recovery code" header, and <RecoveryCodeCard> is shown. Close-X /
 * Escape / backdrop are all gated until the user confirms.
 */
export const RotateTakeover: Story = {
  args: { rotateTakeover: true },
};

/**
 * Modal in its delete-account takeover variant — triggered by the
 * "Delete account…" button. Inputs render empty; the destructive
 * "Permanently delete account" button is disabled until the user
 * supplies a password and types DELETE. No mutation fires, so this story
 * needs no fetch mocking.
 */
export const DeleteAccountTakeover: Story = {
  args: { deleteAccountTakeover: true },
};
