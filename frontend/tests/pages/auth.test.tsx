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
    // Re-install the unauthorized handler — resetApiClientForTests cleared
    // the one session.ts wired at module load, and the import from earlier
    // in the process does not re-run.
    setUnauthorizedHandler(() => {
      useSessionStore.getState().clearSession();
    });
    useSessionStore.setState({ user: null, status: 'idle' });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    setUnauthorizedHandler(null);
    resetApiClientForTests();
    // Wrap in act(): vitest runs afterEach hooks in reverse registration order,
    // so this fires before setup.ts's cleanup() unmounts; otherwise the state
    // change notifies still-mounted subscribers outside act.
    act(() => {
      useSessionStore.setState({ user: null, status: 'idle' });
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
      jsonResponse(200, { user: { id: 'u1', username: 'alice' }, accessToken: 'tok-1' }),
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
    const loginCall = fetchMock.mock.calls.find(([url]: [string]) => url === '/api/auth/login');
    expect(loginCall).toBeDefined();
    const [, init] = loginCall as [string, RequestInit];
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

  it('register page validates + submits POST /api/auth/register and redirects to /', async () => {
    primeUnauthenticatedInit(fetchMock);
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, { user: { id: 'u2', username: 'bob' }, accessToken: 'tok-2' }),
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
    expect(submit).not.toBeDisabled();

    await user.click(submit);

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /your stories/i })).toBeInTheDocument();
    });

    const registerCall = fetchMock.mock.calls.find(
      ([url]: [string]) => url === '/api/auth/register',
    );
    expect(registerCall).toBeDefined();
    const [, init] = registerCall as [string, RequestInit];
    expect(init.method).toBe('POST');
    expect(init.body).toBe(JSON.stringify({ username: 'bob', password: 'hunter2hunter2' }));
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
});
