import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetApiClientForTests, setUnauthorizedHandler } from '@/lib/api';
import { createQueryClient } from '@/lib/queryClient';
import { AppRouter } from '@/router';
import { handleUnauthorizedAccess, useSessionStore } from '@/store/session';

type FetchMock = ReturnType<typeof vi.fn>;

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function renderAt(path: string): ReturnType<typeof render> {
  // Fresh QueryClient per render so tests never share cache via the module
  // singleton in `@/lib/queryClient`.
  const client = createQueryClient();
  return render(
    <MemoryRouter initialEntries={[path]}>
      <AppRouter queryClient={client} />
    </MemoryRouter>,
  );
}

/**
 * Every test mounts <AppRouter />, which calls useInitAuth() on mount.
 * That fires a POST /api/auth/refresh. For the unauthenticated flows we need,
 * that must fail — otherwise the dashboard would mount and assertions would
 * race. Enqueue a 401 refresh as the first fetch response.
 */
function primeUnauthenticatedInit(fetchMock: FetchMock): void {
  fetchMock.mockResolvedValueOnce(new Response(null, { status: 401 }));
}

describe('auth pages (F4)', () => {
  let fetchMock: FetchMock;

  beforeEach(() => {
    resetApiClientForTests();
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    // Re-install the production unauthorized handler — resetApiClientForTests
    // cleared the one session.ts wired at module load, and the import from
    // earlier in the process does not re-run. Using `handleUnauthorizedAccess`
    // (rather than a hand-rolled stub) ensures every test exercises the same
    // wiring as production; if the handler body changes, every F65 test
    // catches the drift, not just the explicit production-wiring case.
    setUnauthorizedHandler(handleUnauthorizedAccess);
    useSessionStore.setState({ user: null, status: 'idle', sessionExpired: false });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    setUnauthorizedHandler(null);
    resetApiClientForTests();
    // Wrap in act(): vitest runs afterEach hooks in reverse registration order,
    // so this fires before setup.ts's cleanup() unmounts; otherwise the state
    // change notifies still-mounted subscribers outside act.
    act(() => {
      useSessionStore.setState({ user: null, status: 'idle', sessionExpired: false });
    });
  });

  it('login page renders username and password fields', async () => {
    primeUnauthenticatedInit(fetchMock);
    renderAt('/login');

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /sign in/i })).toBeInTheDocument();
    });
    expect(screen.getByLabelText(/username/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/password/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /sign in/i })).toBeInTheDocument();
  });

  it('shows inline error when username violates the /^[a-z0-9_-]+$/ pattern', async () => {
    primeUnauthenticatedInit(fetchMock);
    const user = userEvent.setup();
    renderAt('/login');

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /sign in/i })).toBeInTheDocument();
    });

    const usernameInput = screen.getByLabelText(/username/i);
    // Space is not in [a-z0-9_-] and also isn't removed by lowercase/trim-mid.
    await user.type(usernameInput, 'bad user');
    await user.tab(); // blur triggers validation display

    const errorId = usernameInput.getAttribute('aria-describedby');
    expect(errorId).toBeTruthy();
    const errorNode = document.getElementById(errorId ?? '');
    expect(errorNode).not.toBeNull();
    expect(errorNode?.textContent ?? '').toMatch(/username must be/i);
    expect(usernameInput).toHaveAttribute('aria-invalid', 'true');
  });

  it('shows inline error when password is shorter than 8 characters', async () => {
    primeUnauthenticatedInit(fetchMock);
    const user = userEvent.setup();
    renderAt('/login');

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /sign in/i })).toBeInTheDocument();
    });

    const passwordInput = screen.getByLabelText(/password/i);
    await user.type(passwordInput, 'short');
    await user.tab();

    const errorId = passwordInput.getAttribute('aria-describedby');
    const errorNode = document.getElementById(errorId ?? '');
    expect(errorNode?.textContent ?? '').toMatch(/at least 8/i);
    expect(passwordInput).toHaveAttribute('aria-invalid', 'true');
  });

  it('submit button is disabled while the form is invalid', async () => {
    primeUnauthenticatedInit(fetchMock);
    const user = userEvent.setup();
    renderAt('/login');

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /sign in/i })).toBeInTheDocument();
    });

    const submit = screen.getByRole('button', { name: /sign in/i });
    // Empty form — invalid.
    expect(submit).toBeDisabled();

    // Type a bad username; still invalid.
    await user.type(screen.getByLabelText(/username/i), 'ab');
    expect(submit).toBeDisabled();

    // Type a short password; still invalid.
    await user.type(screen.getByLabelText(/password/i), 'short');
    expect(submit).toBeDisabled();

    // Fix both — button enables.
    await user.clear(screen.getByLabelText(/username/i));
    await user.type(screen.getByLabelText(/username/i), 'alice');
    await user.clear(screen.getByLabelText(/password/i));
    await user.type(screen.getByLabelText(/password/i), 'hunter2hunter2');
    expect(submit).not.toBeDisabled();
  });

  it('valid login submits POST /api/auth/login with correct body and redirects to /', async () => {
    primeUnauthenticatedInit(fetchMock);
    // Then the login call.
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, {
        user: { id: 'u1', username: 'alice', name: 'Alice' },
        accessToken: 'tok-1',
      }),
    );

    const user = userEvent.setup();
    renderAt('/login');

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /sign in/i })).toBeInTheDocument();
    });

    await user.type(screen.getByLabelText(/username/i), 'alice');
    await user.type(screen.getByLabelText(/password/i), 'hunter2hunter2');
    await user.click(screen.getByRole('button', { name: /sign in/i }));

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /your stories/i })).toBeInTheDocument();
    });

    // The second fetch call is the login.
    const loginCall = fetchMock.mock.calls.find(
      (c): c is [string, RequestInit] => c[0] === '/api/auth/login',
    );
    expect(loginCall).toBeDefined();
    if (!loginCall) return;
    const [, init] = loginCall;
    expect(init.method).toBe('POST');
    expect(init.body).toBe(JSON.stringify({ username: 'alice', password: 'hunter2hunter2' }));
  });

  it('login: 401 shows the friendly "Invalid username or password" message (not server message)', async () => {
    primeUnauthenticatedInit(fetchMock);
    fetchMock.mockResolvedValueOnce(
      jsonResponse(401, { error: { message: 'bcrypt.compare returned false', code: 'BAD_CREDS' } }),
    );

    const user = userEvent.setup();
    renderAt('/login');

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /sign in/i })).toBeInTheDocument();
    });

    await user.type(screen.getByLabelText(/username/i), 'alice');
    await user.type(screen.getByLabelText(/password/i), 'hunter2hunter2');
    await user.click(screen.getByRole('button', { name: /sign in/i }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/invalid username or password/i);
    // Raw server message must not leak through.
    expect(alert.textContent).not.toMatch(/bcrypt/i);
    // Still on /login.
    expect(screen.getByRole('heading', { name: /sign in/i })).toBeInTheDocument();
  });

  it('register page validates + submits POST /api/auth/register and lands on the recovery-code interstitial', async () => {
    primeUnauthenticatedInit(fetchMock);
    // Backend returns 201 with { user, recoveryCode } only — no accessToken,
    // no refresh cookie. The page is responsible for the post-ack login.
    fetchMock.mockResolvedValueOnce(
      jsonResponse(201, {
        user: { id: 'u2', username: 'bob', name: 'bob' },
        recoveryCode: 'horse-battery-staple-correct-glow-mint-velvet-pearl-orbit-quiet-amber-crisp',
      }),
    );

    const user = userEvent.setup();
    renderAt('/register');

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /create account/i })).toBeInTheDocument();
    });

    const submit = screen.getByRole('button', { name: /create account/i });
    expect(submit).toBeDisabled();

    // Same pattern validation as login.
    await user.type(screen.getByLabelText(/username/i), 'Bad User');
    await user.tab();
    const usernameInput = screen.getByLabelText(/username/i);
    expect(usernameInput).toHaveAttribute('aria-invalid', 'true');

    await user.clear(usernameInput);
    await user.type(usernameInput, 'bob');
    await user.type(screen.getByLabelText(/password/i), 'hunter2hunter2');
    await user.type(screen.getByLabelText(/display name/i), 'Bob Builder');
    expect(submit).not.toBeDisabled();

    await user.click(submit);

    // The user lands on the recovery-code interstitial, NOT the dashboard.
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /save your recovery code/i })).toBeInTheDocument();
    });
    expect(screen.getByText(/horse-battery-staple/)).toBeInTheDocument();

    const registerCall = fetchMock.mock.calls.find(
      (c): c is [string, RequestInit] => c[0] === '/api/auth/register',
    );
    expect(registerCall).toBeDefined();
    if (!registerCall) return;
    const [, init] = registerCall;
    expect(init.method).toBe('POST');
    // The register form now collects a user-supplied display name; the body
    // sends the trimmed name alongside username + password.
    expect(init.body).toBe(
      JSON.stringify({ name: 'Bob Builder', username: 'bob', password: 'hunter2hunter2' }),
    );
  });

  it('register: 409 shows the friendly "Username is already taken" message (not server message)', async () => {
    primeUnauthenticatedInit(fetchMock);
    fetchMock.mockResolvedValueOnce(
      jsonResponse(409, {
        error: { message: 'db unique constraint: users_username_key', code: 'DUP' },
      }),
    );

    const user = userEvent.setup();
    renderAt('/register');

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /create account/i })).toBeInTheDocument();
    });

    await user.type(screen.getByLabelText(/username/i), 'bob');
    await user.type(screen.getByLabelText(/password/i), 'hunter2hunter2');
    await user.type(screen.getByLabelText(/display name/i), 'Bob Builder');
    await user.click(screen.getByRole('button', { name: /create account/i }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/username is already taken/i);
    expect(alert.textContent).not.toMatch(/unique constraint/i);
    expect(screen.getByRole('heading', { name: /create account/i })).toBeInTheDocument();
  });

  it('login page links to /register', async () => {
    primeUnauthenticatedInit(fetchMock);
    renderAt('/login');

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /sign in/i })).toBeInTheDocument();
    });
    const link = screen.getByRole('link', { name: /create one/i });
    expect(link).toHaveAttribute('href', '/register');
  });

  it('register page links to /login', async () => {
    primeUnauthenticatedInit(fetchMock);
    renderAt('/register');

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /create account/i })).toBeInTheDocument();
    });
    const link = screen.getByRole('link', { name: /sign in/i });
    expect(link).toHaveAttribute('href', '/login');
  });

  // F65 — Terminal-401 redirect to login + "session expired" banner.
  describe('terminal-401 session-expired banner (F65)', () => {
    it('shows the "session expired" banner when sessionExpired is true on /login', async () => {
      primeUnauthenticatedInit(fetchMock);
      renderAt('/login');

      // initAuth's failed refresh runs clearSession, which (per the
      // invariant in store/session.ts) resets sessionExpired to false. Set
      // the flag AFTER initAuth has resolved so the LoginPage subscriber
      // sees the post-init value, mirroring the real terminal-401 sequence
      // (initAuth completes → user is in-app → terminal 401 → handler sets
      // flag → /login renders banner).
      await waitFor(() => {
        expect(screen.getByRole('heading', { name: /sign in/i })).toBeInTheDocument();
      });
      act(() => {
        useSessionStore.setState({ sessionExpired: true });
      });

      const banner = await screen.findByRole('status', { name: /session expired/i });
      expect(banner).toHaveTextContent(/session has expired/i);
    });

    it('does not show the session-expired banner when the flag is false', async () => {
      primeUnauthenticatedInit(fetchMock);
      renderAt('/login');

      await waitFor(() => {
        expect(screen.getByRole('heading', { name: /sign in/i })).toBeInTheDocument();
      });

      expect(screen.queryByRole('status', { name: /session expired/i })).not.toBeInTheDocument();
    });

    it('terminal-401 mid-session: production handler flips the store and redirects /login → banner', async () => {
      // beforeEach already installed `handleUnauthorizedAccess` as the
      // handler, so this test exercises the production wiring end-to-end via
      // a real fetch-401 chain (rather than asserting against a hand-rolled
      // stub).

      // Pre-seed an authenticated session so RequireAuth admits the dashboard.
      act(() => {
        useSessionStore
          .getState()
          .setSession({ id: 'u1', username: 'alice', name: 'Alice' }, 'tok-1');
      });

      // Stage machine: /auth/refresh succeeds the first time (initAuth keeps
      // us authenticated) and 401s thereafter (terminal). Any /api/* call
      // returns 401, which drives the api client into the refresh-and-retry
      // path → terminal handler → store flip.
      let refreshCalls = 0;
      fetchMock.mockImplementation((input: RequestInfo | URL) => {
        const url = typeof input === 'string' ? input : input.toString();
        if (url.endsWith('/auth/refresh')) {
          refreshCalls += 1;
          if (refreshCalls === 1) {
            return Promise.resolve(jsonResponse(200, { accessToken: 'tok-1' }));
          }
          return Promise.resolve(jsonResponse(401, { error: { message: 'no session' } }));
        }
        if (url.endsWith('/auth/me')) {
          return Promise.resolve(
            jsonResponse(200, { user: { id: 'u1', username: 'alice', name: 'Alice' } }),
          );
        }
        return Promise.resolve(jsonResponse(401, { error: { message: 'expired' } }));
      });

      renderAt('/');

      // RequireAuth flips on the production handler's setState, redirects to
      // /login, and the LoginPage renders the banner from the store flag.
      await waitFor(() => {
        expect(screen.getByRole('heading', { name: /sign in/i })).toBeInTheDocument();
      });
      const banner = screen.getByRole('status', { name: /session expired/i });
      expect(banner).toHaveTextContent(/session has expired/i);

      const finalState = useSessionStore.getState();
      expect(finalState.user).toBeNull();
      expect(finalState.status).toBe('unauthenticated');
      expect(finalState.sessionExpired).toBe(true);
    });

    it('successful login clears the sessionExpired flag', async () => {
      primeUnauthenticatedInit(fetchMock);
      fetchMock.mockResolvedValueOnce(
        jsonResponse(200, {
          user: { id: 'u1', username: 'alice', name: 'Alice' },
          accessToken: 'tok-1',
        }),
      );

      const user = userEvent.setup();
      renderAt('/login');

      // Set sessionExpired AFTER initAuth completes — clearSession (called
      // when init's refresh 401s) resets the flag, so any pre-render set
      // would be wiped.
      await waitFor(() => {
        expect(screen.getByRole('heading', { name: /sign in/i })).toBeInTheDocument();
      });
      act(() => {
        useSessionStore.setState({ sessionExpired: true });
      });
      // Banner is visible at first.
      expect(await screen.findByRole('status', { name: /session expired/i })).toBeInTheDocument();

      await user.type(screen.getByLabelText(/username/i), 'alice');
      await user.type(screen.getByLabelText(/password/i), 'hunter2hunter2');
      await user.click(screen.getByRole('button', { name: /sign in/i }));

      await waitFor(() => {
        expect(screen.getByRole('heading', { name: /your stories/i })).toBeInTheDocument();
      });
      expect(useSessionStore.getState().sessionExpired).toBe(false);
    });
  });
});
