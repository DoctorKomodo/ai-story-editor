import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetApiClientForTests, setUnauthorizedHandler } from '@/lib/api';
import { createQueryClient } from '@/lib/queryClient';
import { AppRouter } from '@/router';
import { useSessionStore } from '@/store/session';

type FetchMock = ReturnType<typeof vi.fn>;

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function renderAt(path: string): ReturnType<typeof render> {
  const client = createQueryClient();
  return render(
    <MemoryRouter initialEntries={[path]}>
      <AppRouter queryClient={client} />
    </MemoryRouter>,
  );
}

function primeUnauthenticatedInit(fetchMock: FetchMock): void {
  fetchMock.mockResolvedValueOnce(new Response(null, { status: 401 }));
}

async function fillAndSubmit(user: ReturnType<typeof userEvent.setup>): Promise<void> {
  await user.type(screen.getByLabelText(/^username$/i), 'alice');
  await user.type(screen.getByLabelText(/recovery code/i), 'horse-battery-staple');
  await user.type(screen.getByLabelText(/^new password$/i), 'hunter2hunter2');
  await user.type(screen.getByLabelText(/confirm new password/i), 'hunter2hunter2');
  await user.click(screen.getByRole('button', { name: /reset password/i }));
}

describe('reset-password page (F60)', () => {
  let fetchMock: FetchMock;

  beforeEach(() => {
    resetApiClientForTests();
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    setUnauthorizedHandler(() => {
      useSessionStore.getState().clearSession();
    });
    useSessionStore.setState({ user: null, status: 'idle' });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    setUnauthorizedHandler(null);
    resetApiClientForTests();
    act(() => {
      useSessionStore.setState({ user: null, status: 'idle' });
    });
  });

  it('renders the reset-password form on /reset-password', async () => {
    primeUnauthenticatedInit(fetchMock);
    renderAt('/reset-password');

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /reset your password/i })).toBeInTheDocument();
    });
    expect(screen.getByLabelText(/^username$/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/recovery code/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/^new password$/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/confirm new password/i)).toBeInTheDocument();
  });

  it('on success, POSTs username + recoveryCode + newPassword and redirects to /login with a banner', async () => {
    primeUnauthenticatedInit(fetchMock);
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));

    const user = userEvent.setup();
    renderAt('/reset-password');
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /reset your password/i })).toBeInTheDocument();
    });

    await fillAndSubmit(user);

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /sign in/i })).toBeInTheDocument();
    });

    const resetCall = fetchMock.mock.calls.find(
      ([url]: [string]) => url === '/api/auth/reset-password',
    );
    expect(resetCall).toBeDefined();
    const [, init] = resetCall as [string, RequestInit];
    expect(init.method).toBe('POST');
    expect(init.body).toBe(
      JSON.stringify({
        username: 'alice',
        recoveryCode: 'horse-battery-staple',
        newPassword: 'hunter2hunter2',
      }),
    );

    expect(screen.getByRole('status', { name: /password reset/i })).toHaveTextContent(
      /sign in with your new password/i,
    );
  });

  it('on 401, surfaces a generic "Invalid username, recovery code, or both" message (does NOT leak whether the username exists)', async () => {
    primeUnauthenticatedInit(fetchMock);
    fetchMock.mockResolvedValueOnce(
      jsonResponse(401, {
        error: { message: 'Invalid recovery code', code: 'invalid_recovery_code' },
      }),
    );

    const user = userEvent.setup();
    renderAt('/reset-password');
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /reset your password/i })).toBeInTheDocument();
    });

    await fillAndSubmit(user);

    expect(await screen.findByRole('alert')).toHaveTextContent(
      /invalid username, recovery code, or both/i,
    );
    // The page must NOT mention the username / its existence.
    const alertText = screen.getByRole('alert').textContent ?? '';
    expect(alertText.toLowerCase()).not.toContain('alice');
  });

  it('on 429, surfaces a rate-limited message', async () => {
    primeUnauthenticatedInit(fetchMock);
    fetchMock.mockResolvedValueOnce(
      jsonResponse(429, {
        error: { message: 'Too many attempts', code: 'rate_limited' },
      }),
    );

    const user = userEvent.setup();
    renderAt('/reset-password');
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /reset your password/i })).toBeInTheDocument();
    });

    await fillAndSubmit(user);

    expect(await screen.findByRole('alert')).toHaveTextContent(/too many attempts/i);
  });

  it('login screen has a "Forgot password?" link that routes to /reset-password', async () => {
    primeUnauthenticatedInit(fetchMock);
    const user = userEvent.setup();
    renderAt('/login');

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /sign in/i })).toBeInTheDocument();
    });

    const forgotLink = screen.getByRole('link', { name: /forgot password/i });
    expect(forgotLink).toHaveAttribute('href', '/reset-password');
    await user.click(forgotLink);

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /reset your password/i })).toBeInTheDocument();
    });
  });
});
