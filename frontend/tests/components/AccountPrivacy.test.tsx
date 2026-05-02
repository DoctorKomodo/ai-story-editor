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
      await screen.findByRole('heading', { name: /save your new recovery code/i }),
    ).toBeInTheDocument();
    expect(screen.getByText(/new-recovery-code-12345/)).toBeInTheDocument();

    await user.click(screen.getByRole('checkbox', { name: /stored my recovery code/i }));
    await user.click(screen.getByRole('button', { name: /^done$/i }));

    // After takeover dismissal the modal reverts to the sectioned shell,
    // the password input is empty (RotateRecoverySection remounted via
    // formKey), and the recovery code is no longer in the DOM.
    const refreshedRotateSection = await screen.findByRole('region', {
      name: /rotate recovery code/i,
    });
    await waitFor(() => {
      expect(within(refreshedRotateSection).getByLabelText(/^password$/i)).toHaveValue('');
    });
    expect(screen.queryByText(/new-recovery-code-12345/)).not.toBeInTheDocument();
  });

  it('rotate-recovery: while the new code is on screen, Escape / backdrop / Close / Done are all disabled', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { recoveryCode: 'new-recovery-code-12345' }));
    const user = userEvent.setup();
    const { onClose } = renderModal();

    const rotateSection = screen.getByRole('region', { name: /rotate recovery code/i });
    await user.type(within(rotateSection).getByLabelText(/^password$/i), 'hunter2hunter2');
    await user.click(within(rotateSection).getByRole('button', { name: /generate new code/i }));

    // New code is on screen.
    expect(
      await screen.findByRole('heading', { name: /save your new recovery code/i }),
    ).toBeInTheDocument();

    // Escape — must NOT dismiss.
    await user.keyboard('{Escape}');
    expect(onClose).not.toHaveBeenCalled();
    expect(
      screen.getByRole('heading', { name: /save your new recovery code/i }),
    ).toBeInTheDocument();

    // Close (X) button — disabled.
    expect(screen.getByTestId('account-privacy-close')).toBeDisabled();

    // Footer "Done" button — not rendered at all during takeover (a stricter
    // form of "not interactable" than the previous `disabled` assertion).
    expect(screen.queryByTestId('account-privacy-done')).not.toBeInTheDocument();

    // Backdrop click — must NOT dismiss.
    const backdrop = screen.getByTestId('ap-backdrop');
    await user.pointer({ keys: '[MouseLeft>]', target: backdrop });
    await user.pointer({ keys: '[/MouseLeft]' });
    expect(onClose).not.toHaveBeenCalled();

    // Acknowledging the code releases the gate — the modal returns to its
    // sectioned shell and the X button is enabled again.
    await user.click(screen.getByRole('checkbox', { name: /stored my recovery code/i }));
    await user.click(screen.getByRole('button', { name: /^done$/i }));
    await waitFor(() => {
      expect(screen.getByTestId('account-privacy-close')).not.toBeDisabled();
    });
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

  // Takeover-mode tests for [X3] delete-account redesign — the placeholder
  // disabled-button + "Coming with [X3]" copy is replaced by an enabled
  // trigger that swaps the modal into a takeover with a confirm form.
  describe('[X3] delete-account takeover', () => {
    it('section renders an enabled trigger button (placeholder no longer disabled)', () => {
      renderModal();
      const section = screen.getByRole('region', { name: /delete account/i });
      const trigger = within(section).getByRole('button', { name: /delete account/i });
      expect(trigger).toBeEnabled();
    });

    it('clicking the trigger swaps the modal to delete-account takeover and hides the section list', async () => {
      const user = userEvent.setup();
      renderModal();
      const section = screen.getByRole('region', { name: /delete account/i });
      await user.click(within(section).getByRole('button', { name: /delete account/i }));
      expect(
        await screen.findByRole('heading', { name: /delete your account/i }),
      ).toBeInTheDocument();
      expect(screen.getByText(/this permanently deletes your account/i)).toBeInTheDocument();
      expect(screen.queryByRole('heading', { name: /change password/i })).not.toBeInTheDocument();
    });

    it('destructive button is disabled until password is non-empty AND confirm text === DELETE', async () => {
      const user = userEvent.setup();
      renderModal();
      const section = screen.getByRole('region', { name: /delete account/i });
      await user.click(within(section).getByRole('button', { name: /delete account/i }));

      const submit = screen.getByTestId('delete-account-confirm');
      expect(submit).toBeDisabled();

      await user.type(screen.getByTestId('delete-account-password'), 'pw');
      expect(submit).toBeDisabled();

      await user.type(screen.getByTestId('delete-account-confirm-text'), 'delete');
      expect(submit).toBeDisabled(); // case-sensitive

      await user.clear(screen.getByTestId('delete-account-confirm-text'));
      await user.type(screen.getByTestId('delete-account-confirm-text'), 'DELETE');
      expect(submit).toBeEnabled();
    });

    it('Escape, backdrop, and X are all no-ops while the takeover is on', async () => {
      const user = userEvent.setup();
      const { onClose } = renderModal();
      const section = screen.getByRole('region', { name: /delete account/i });
      await user.click(within(section).getByRole('button', { name: /delete account/i }));

      await user.keyboard('{Escape}');
      await user.pointer({ keys: '[MouseLeft>]', target: screen.getByTestId('ap-backdrop') });
      await user.pointer({ keys: '[/MouseLeft]' });
      await user.click(screen.getByTestId('account-privacy-close'));
      expect(onClose).not.toHaveBeenCalled();
    });

    it('Cancel returns to normal shell with sections visible again', async () => {
      const user = userEvent.setup();
      renderModal();
      const section = screen.getByRole('region', { name: /delete account/i });
      await user.click(within(section).getByRole('button', { name: /delete account/i }));
      await screen.findByRole('heading', { name: /delete your account/i });
      await user.click(screen.getByTestId('delete-account-cancel'));
      expect(await screen.findByRole('heading', { name: /change password/i })).toBeInTheDocument();
    });

    it('successful submit calls the delete endpoint with the password', async () => {
      fetchMock.mockResolvedValueOnce(emptyResponse(204));
      const user = userEvent.setup();
      renderModal();
      const section = screen.getByRole('region', { name: /delete account/i });
      await user.click(within(section).getByRole('button', { name: /delete account/i }));
      await user.type(screen.getByTestId('delete-account-password'), 'pw');
      await user.type(screen.getByTestId('delete-account-confirm-text'), 'DELETE');
      await user.click(screen.getByTestId('delete-account-confirm'));

      await waitFor(() => {
        expect(fetchMock).toHaveBeenCalledWith(
          '/api/auth/delete-account',
          expect.objectContaining({
            method: 'DELETE',
            body: expect.stringContaining('"password":"pw"'),
          }),
        );
      });
    });

    it('401 wrong-password surfaces inline error and stays in takeover with values preserved', async () => {
      fetchMock.mockResolvedValueOnce(
        jsonResponse(401, {
          error: { message: 'Invalid credentials', code: 'invalid_credentials' },
        }),
      );
      // The api client does refresh-on-401 once; mock the refresh to fail so
      // the original 401 surfaces back to the caller.
      fetchMock.mockResolvedValueOnce(jsonResponse(401, { error: { message: 'no' } }));
      const user = userEvent.setup();
      renderModal();
      const section = screen.getByRole('region', { name: /delete account/i });
      await user.click(within(section).getByRole('button', { name: /delete account/i }));
      await user.type(screen.getByTestId('delete-account-password'), 'wrong');
      await user.type(screen.getByTestId('delete-account-confirm-text'), 'DELETE');
      await user.click(screen.getByTestId('delete-account-confirm'));

      expect(await screen.findByRole('alert')).toHaveTextContent(/password is incorrect/i);
      expect(screen.getByRole('heading', { name: /delete your account/i })).toBeInTheDocument();
      expect((screen.getByTestId('delete-account-password') as HTMLInputElement).value).toBe(
        'wrong',
      );
    });
  });

  // Takeover-mode tests for [F61] recovery-code redesign — the issued code
  // now takes over the entire modal shell (title + subtitle + body) instead
  // of being embedded inside the section card.
  describe('[F61] recovery-code takeover', () => {
    // Resolve the rotate-section's password input via section scope. The
    // plan-spec's `getAllByLabelText(/password/i).slice(-1)[0]` doesn't match
    // here because change-password's labels read "Current password" / "New
    // password" / "Confirm new password" — the regex is anchored on the
    // span text, and only the rotate section has a label that's *exactly*
    // "Password". Section-scoped lookup is the unambiguous way.
    const rotatePassword = (): HTMLInputElement =>
      within(screen.getByRole('region', { name: /rotate recovery code/i })).getByLabelText(
        /^password$/i,
      ) as HTMLInputElement;

    it('issuing a code swaps the modal title, subtitle, and hides the section list', async () => {
      fetchMock.mockResolvedValueOnce(
        jsonResponse(200, {
          recoveryCode: 'TEST-CODE-1234',
          warning: 'Save this recovery code now — it will not be shown again.',
        }),
      );
      const user = userEvent.setup();
      renderModal();

      await user.type(rotatePassword(), 'pw');
      await user.click(screen.getByRole('button', { name: /generate new code/i }));

      expect(
        await screen.findByRole('heading', { name: /save your new recovery code/i }),
      ).toBeInTheDocument();
      expect(screen.queryByRole('heading', { name: /change password/i })).not.toBeInTheDocument();
      expect(screen.getByTestId('recovery-code-box')).toHaveTextContent('TEST-CODE-1234');
      expect(screen.getByText(/show once/i)).toBeInTheDocument();
    });

    it('Escape, backdrop click, and X are all no-ops while a code is on screen', async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse(200, { recoveryCode: 'X', warning: '' }));
      const user = userEvent.setup();
      const { onClose } = renderModal();

      await user.type(rotatePassword(), 'pw');
      await user.click(screen.getByRole('button', { name: /generate new code/i }));
      await screen.findByTestId('recovery-code-box');

      await user.keyboard('{Escape}');
      await user.pointer({ keys: '[MouseLeft>]', target: screen.getByTestId('ap-backdrop') });
      await user.click(screen.getByTestId('account-privacy-close'));
      expect(onClose).not.toHaveBeenCalled();
    });

    it('Done after confirm dismisses the takeover and clears the rotate password field', async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse(200, { recoveryCode: 'X', warning: '' }));
      const user = userEvent.setup();
      renderModal();

      await user.type(rotatePassword(), 'pw');
      await user.click(screen.getByRole('button', { name: /generate new code/i }));
      await screen.findByTestId('recovery-code-box');
      await user.click(screen.getByRole('checkbox', { name: /stored my recovery code/i }));
      await user.click(screen.getByRole('button', { name: /^done$/i }));

      // Sections are back, password input is empty.
      expect(await screen.findByRole('heading', { name: /change password/i })).toBeInTheDocument();
      expect(rotatePassword().value).toBe('');
    });

    it('issuing a code, dismissing, then issuing again works (formKey remount)', async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse(200, { recoveryCode: 'A', warning: '' }));
      fetchMock.mockResolvedValueOnce(jsonResponse(200, { recoveryCode: 'B', warning: '' }));
      const user = userEvent.setup();
      renderModal();

      await user.type(rotatePassword(), 'pw');
      await user.click(screen.getByRole('button', { name: /generate new code/i }));
      await screen.findByTestId('recovery-code-box');
      await user.click(screen.getByRole('checkbox', { name: /stored my recovery code/i }));
      await user.click(screen.getByRole('button', { name: /^done$/i }));

      // Second rotation with a fresh password input
      await screen.findByRole('region', { name: /rotate recovery code/i });
      await user.type(rotatePassword(), 'pw');
      await user.click(screen.getByRole('button', { name: /generate new code/i }));
      expect(await screen.findByTestId('recovery-code-box')).toBeInTheDocument();
    });
  });
});
