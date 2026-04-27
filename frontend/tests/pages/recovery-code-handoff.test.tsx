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

describe('recovery-code handoff (F59)', () => {
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

  it('after a successful register, shows the recovery-code interstitial (not the dashboard) and gates Continue on the checkbox', async () => {
    primeUnauthenticatedInit(fetchMock);
    fetchMock.mockResolvedValueOnce(
      jsonResponse(201, {
        user: { id: 'u2', username: 'bob' },
        recoveryCode: 'horse-battery-staple-correct',
      }),
    );

    const user = userEvent.setup();
    renderAt('/register');

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /create account/i })).toBeInTheDocument();
    });

    await user.type(screen.getByLabelText(/username/i), 'bob');
    await user.type(screen.getByLabelText(/password/i), 'hunter2hunter2');
    await user.click(screen.getByRole('button', { name: /create account/i }));

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /save your recovery code/i })).toBeInTheDocument();
    });

    expect(screen.getByText(/horse-battery-staple-correct/)).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: /your stories/i })).not.toBeInTheDocument();

    const continueBtn = screen.getByRole('button', { name: /continue to inkwell/i });
    expect(continueBtn).toBeDisabled();

    // Tick the checkbox to release the gate.
    await user.click(screen.getByRole('checkbox', { name: /i have stored/i }));
    expect(continueBtn).not.toBeDisabled();
  });

  it('after acknowledgement, calls /auth/login with the original credentials and redirects to /', async () => {
    primeUnauthenticatedInit(fetchMock);
    fetchMock.mockResolvedValueOnce(
      jsonResponse(201, {
        user: { id: 'u2', username: 'bob' },
        recoveryCode: 'horse-battery-staple-correct',
      }),
    );
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, {
        user: { id: 'u2', username: 'bob' },
        accessToken: 'tok-2',
        accessTokenExpiresAt: new Date(Date.now() + 60_000).toISOString(),
      }),
    );

    const user = userEvent.setup();
    renderAt('/register');

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /create account/i })).toBeInTheDocument();
    });

    await user.type(screen.getByLabelText(/username/i), 'bob');
    await user.type(screen.getByLabelText(/password/i), 'hunter2hunter2');
    await user.click(screen.getByRole('button', { name: /create account/i }));

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /save your recovery code/i })).toBeInTheDocument();
    });
    await user.click(screen.getByRole('checkbox', { name: /i have stored/i }));
    await user.click(screen.getByRole('button', { name: /continue to inkwell/i }));

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /your stories/i })).toBeInTheDocument();
    });

    const loginCall = fetchMock.mock.calls.find(([url]: [string]) => url === '/api/auth/login');
    expect(loginCall).toBeDefined();
    const [, init] = loginCall as [string, RequestInit];
    expect(init.method).toBe('POST');
    expect(init.body).toBe(JSON.stringify({ username: 'bob', password: 'hunter2hunter2' }));
  });

  it('does NOT persist the recovery code to localStorage, sessionStorage, or the session store', async () => {
    primeUnauthenticatedInit(fetchMock);
    fetchMock.mockResolvedValueOnce(
      jsonResponse(201, {
        user: { id: 'u2', username: 'bob' },
        recoveryCode: 'horse-battery-staple-correct',
      }),
    );

    const user = userEvent.setup();
    renderAt('/register');
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /create account/i })).toBeInTheDocument();
    });
    await user.type(screen.getByLabelText(/username/i), 'bob');
    await user.type(screen.getByLabelText(/password/i), 'hunter2hunter2');
    await user.click(screen.getByRole('button', { name: /create account/i }));

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /save your recovery code/i })).toBeInTheDocument();
    });

    // Scan localStorage and sessionStorage for the code or any near-substring.
    const allLocal = JSON.stringify({ ...localStorage });
    const allSession = JSON.stringify({ ...sessionStorage });
    expect(allLocal).not.toContain('horse-battery');
    expect(allSession).not.toContain('horse-battery');

    // The session store must not hold the code anywhere on its state.
    const storeJson = JSON.stringify(useSessionStore.getState());
    expect(storeJson).not.toContain('horse-battery');
  });

  it('remounting /register after the handoff is shown returns the user to the form (no leaked code)', async () => {
    primeUnauthenticatedInit(fetchMock);
    fetchMock.mockResolvedValueOnce(
      jsonResponse(201, {
        user: { id: 'u2', username: 'bob' },
        recoveryCode: 'horse-battery-staple-correct',
      }),
    );

    const user = userEvent.setup();
    const { unmount } = renderAt('/register');
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /create account/i })).toBeInTheDocument();
    });
    await user.type(screen.getByLabelText(/username/i), 'bob');
    await user.type(screen.getByLabelText(/password/i), 'hunter2hunter2');
    await user.click(screen.getByRole('button', { name: /create account/i }));
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /save your recovery code/i })).toBeInTheDocument();
    });

    // Simulate a tab reload by unmounting and re-priming a fresh init.
    unmount();
    primeUnauthenticatedInit(fetchMock);
    renderAt('/register');

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /create account/i })).toBeInTheDocument();
    });
    expect(screen.queryByText(/horse-battery-staple/)).not.toBeInTheDocument();
  });

  it('post-ack login failure shows an inline error and a "Sign in" link as fallback', async () => {
    primeUnauthenticatedInit(fetchMock);
    fetchMock.mockResolvedValueOnce(
      jsonResponse(201, {
        user: { id: 'u2', username: 'bob' },
        recoveryCode: 'horse-battery-staple-correct',
      }),
    );
    fetchMock.mockResolvedValueOnce(
      jsonResponse(401, {
        error: { message: 'Invalid credentials', code: 'invalid_credentials' },
      }),
    );

    const user = userEvent.setup();
    renderAt('/register');
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /create account/i })).toBeInTheDocument();
    });
    await user.type(screen.getByLabelText(/username/i), 'bob');
    await user.type(screen.getByLabelText(/password/i), 'hunter2hunter2');
    await user.click(screen.getByRole('button', { name: /create account/i }));

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /save your recovery code/i })).toBeInTheDocument();
    });
    await user.click(screen.getByRole('checkbox', { name: /i have stored/i }));
    await user.click(screen.getByRole('button', { name: /continue to inkwell/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/sign in failed/i);
    expect(screen.getByRole('link', { name: /sign in/i })).toHaveAttribute('href', '/login');
  });
});
