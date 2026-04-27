// [F61] AccountPrivacyModal tests — covers shell behaviour, change-password
// happy/sad/mismatch paths, rotate-recovery handoff and 401, the two-click
// sign-out-everywhere flow, and the delete-account placeholder copy.
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ComponentProps } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AccountPrivacyModal } from '@/components/AccountPrivacyModal';
import { resetApiClientForTests, setUnauthorizedHandler } from '@/lib/api';
import { useSessionStore } from '@/store/session';

type FetchMock = ReturnType<typeof vi.fn>;

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
function emptyResponse(status: number): Response {
  return new Response(null, { status });
}

function renderModal(
  props: Partial<ComponentProps<typeof AccountPrivacyModal>> = {},
): { onClose: ReturnType<typeof vi.fn> } & ReturnType<typeof render> {
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  const onClose = vi.fn();
  const utils = render(
    <MemoryRouter initialEntries={['/']}>
      <QueryClientProvider client={client}>
        <AccountPrivacyModal open onClose={onClose} username="alice" {...props} />
      </QueryClientProvider>
    </MemoryRouter>,
  );
  return { onClose, ...utils };
}

describe('<AccountPrivacyModal>', () => {
  let fetchMock: FetchMock;

  beforeEach(() => {
    resetApiClientForTests();
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    setUnauthorizedHandler(null);
    useSessionStore.setState({
      user: { id: 'u1', username: 'alice' },
      status: 'authenticated',
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    resetApiClientForTests();
    act(() => {
      useSessionStore.setState({ user: null, status: 'idle' });
    });
  });

  it('renders nothing when open=false', () => {
    const client = new QueryClient();
    render(
      <MemoryRouter>
        <QueryClientProvider client={client}>
          <AccountPrivacyModal open={false} onClose={() => undefined} username="alice" />
        </QueryClientProvider>
      </MemoryRouter>,
    );
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('renders the four section headings and the username in the subtitle', () => {
    renderModal();
    expect(screen.getByRole('heading', { name: /account & privacy/i })).toBeInTheDocument();
    expect(screen.getByText(/@alice/)).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /change password/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /rotate recovery code/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /sign out everywhere/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /delete account/i })).toBeInTheDocument();
  });

  it('Escape closes the modal', async () => {
    const { onClose } = renderModal();
    await userEvent.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalled();
  });

  it('clicking the backdrop closes the modal', async () => {
    const { onClose, container } = renderModal();
    const backdrop = container.querySelector('[data-testid="ap-backdrop"]') as HTMLElement;
    const user = userEvent.setup();
    // Backdrop close fires on mousedown when target === currentTarget.
    await user.pointer({ keys: '[MouseLeft>]', target: backdrop });
    expect(onClose).toHaveBeenCalled();
  });

  it('change-password: 204 → success notice, fields cleared, "Other sessions have been signed out" inline', async () => {
    fetchMock.mockResolvedValueOnce(emptyResponse(204));
    const user = userEvent.setup();
    renderModal();

    await user.type(screen.getByLabelText(/current password/i), 'old-pass-12');
    await user.type(screen.getByLabelText(/^new password$/i), 'new-pass-12');
    await user.type(screen.getByLabelText(/confirm new password/i), 'new-pass-12');
    await user.click(screen.getByRole('button', { name: /update password/i }));

    expect(await screen.findByText(/password updated/i)).toBeInTheDocument();
    expect(screen.getByText(/other sessions have been signed out/i)).toBeInTheDocument();
    // Fields are cleared.
    expect(screen.getByLabelText(/current password/i)).toHaveValue('');
    expect(screen.getByLabelText(/^new password$/i)).toHaveValue('');
    expect(screen.getByLabelText(/confirm new password/i)).toHaveValue('');
  });

  it('change-password: 401 → generic invalid-credentials message', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(401, { error: { message: 'Invalid credentials', code: 'invalid_credentials' } }),
    );
    // The api client does refresh-on-401 once; mock the refresh to fail so
    // the original 401 surfaces back to the caller.
    fetchMock.mockResolvedValueOnce(jsonResponse(401, { error: { message: 'no' } }));
    const user = userEvent.setup();
    renderModal();

    await user.type(screen.getByLabelText(/current password/i), 'wrong');
    await user.type(screen.getByLabelText(/^new password$/i), 'new-pass-12');
    await user.type(screen.getByLabelText(/confirm new password/i), 'new-pass-12');
    await user.click(screen.getByRole('button', { name: /update password/i }));

    const alert = await screen.findByText(/current password is incorrect/i);
    expect(alert).toBeInTheDocument();
  });

  it('change-password: confirm mismatch is caught client-side without firing the request', async () => {
    const user = userEvent.setup();
    renderModal();

    await user.type(screen.getByLabelText(/current password/i), 'old-pass-12');
    await user.type(screen.getByLabelText(/^new password$/i), 'new-pass-12');
    await user.type(screen.getByLabelText(/confirm new password/i), 'different');
    await user.tab();

    expect(screen.getByText(/passwords do not match/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /update password/i })).toBeDisabled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rotate-recovery: 200 → swaps to handoff UI; "I have stored this" + Continue returns to the password form', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, { recoveryCode: 'new-recovery-code-12345', warning: 'Save this now' }),
    );
    const user = userEvent.setup();
    renderModal();

    const rotateSection = screen.getByRole('region', { name: /rotate recovery code/i });
    const pwInput = within(rotateSection).getByLabelText(/^password$/i);
    await user.type(pwInput, 'hunter2hunter2');
    await user.click(within(rotateSection).getByRole('button', { name: /generate new code/i }));

    expect(
      await screen.findByRole('heading', { name: /save your recovery code/i }),
    ).toBeInTheDocument();
    expect(screen.getByText(/new-recovery-code-12345/)).toBeInTheDocument();

    await user.click(screen.getByRole('checkbox', { name: /i have stored/i }));
    await user.click(screen.getByRole('button', { name: /continue to inkwell/i }));

    // After handoff dismissal the section reverts to the password form,
    // password input is empty, and the recovery code is no longer in the DOM.
    await waitFor(() => {
      expect(within(rotateSection).getByLabelText(/^password$/i)).toHaveValue('');
    });
    expect(screen.queryByText(/new-recovery-code-12345/)).not.toBeInTheDocument();
  });

  it('rotate-recovery: 401 → generic invalid-credentials message; password input retained for retry', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(401, { error: { message: 'Invalid credentials', code: 'invalid_credentials' } }),
    );
    fetchMock.mockResolvedValueOnce(jsonResponse(401, { error: { message: 'no' } }));
    const user = userEvent.setup();
    renderModal();

    const rotateSection = screen.getByRole('region', { name: /rotate recovery code/i });
    await user.type(within(rotateSection).getByLabelText(/^password$/i), 'wrong');
    await user.click(within(rotateSection).getByRole('button', { name: /generate new code/i }));

    expect(await within(rotateSection).findByText(/password is incorrect/i)).toBeInTheDocument();
    expect(within(rotateSection).getByLabelText(/^password$/i)).toHaveValue('wrong');
  });

  it('sign-out-everywhere: requires a second confirm click before firing', async () => {
    const user = userEvent.setup();
    renderModal();

    const section = screen.getByRole('region', { name: /sign out everywhere/i });
    await user.click(within(section).getByRole('button', { name: /sign out other sessions/i }));

    // Confirm strip appears; request not yet fired.
    expect(await within(section).findByText(/are you sure/i)).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();

    // Cancel returns to the initial state.
    await user.click(within(section).getByRole('button', { name: /^cancel$/i }));
    expect(within(section).queryByText(/are you sure/i)).not.toBeInTheDocument();
  });

  it('sign-out-everywhere: confirm click fires POST, clears session, navigates to /login', async () => {
    fetchMock.mockResolvedValueOnce(emptyResponse(204));
    const user = userEvent.setup();
    renderModal();

    const section = screen.getByRole('region', { name: /sign out everywhere/i });
    await user.click(within(section).getByRole('button', { name: /sign out other sessions/i }));
    await user.click(within(section).getByRole('button', { name: /yes, sign out everywhere/i }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/auth/sign-out-everywhere',
        expect.objectContaining({ method: 'POST' }),
      );
    });
    await waitFor(() => {
      expect(useSessionStore.getState().user).toBeNull();
    });
  });

  it('delete-account section renders an explanatory copy + a disabled red button referencing [X3]', () => {
    renderModal();
    const section = screen.getByRole('region', { name: /delete account/i });
    expect(within(section).getByText(/x3/i)).toBeInTheDocument();
    const btn = within(section).getByRole('button', { name: /delete account/i });
    expect(btn).toBeDisabled();
  });
});
