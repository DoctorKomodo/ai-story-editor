import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetApiClientForTests, setUnauthorizedHandler } from '@/lib/api';
import { createQueryClient } from '@/lib/queryClient';
import { AppRouter } from '@/router';
import { useSessionStore } from '@/store/session';

type FetchMock = ReturnType<typeof vi.fn>;

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

describe('auth screen mockup redesign (F24)', () => {
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

  it('login page renders an aside hero alongside the auth form', async () => {
    primeUnauthenticatedInit(fetchMock);
    const { container } = renderAt('/login');

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /sign in/i })).toBeInTheDocument();
    });

    const aside = container.querySelector('aside');
    expect(aside).not.toBeNull();
    const form = container.querySelector('form');
    expect(form).not.toBeNull();
    // Form is not a descendant of aside — they are siblings within the screen.
    expect(aside?.contains(form ?? null)).toBe(false);
  });

  it('hero contains the brand "Inkwell", the pull quote and metadata footer', async () => {
    primeUnauthenticatedInit(fetchMock);
    const { container } = renderAt('/login');

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /sign in/i })).toBeInTheDocument();
    });

    const aside = container.querySelector('aside');
    expect(aside).not.toBeNull();
    const heroText = aside?.textContent ?? '';
    expect(heroText).toMatch(/Inkwell/);
    expect(heroText).toMatch(/stray marginalia/i);
    expect(heroText).toMatch(/Self-hosted/);
    expect(heroText).toMatch(/inkwell-01/);
  });

  it('hero is hidden below the 720px breakpoint via responsive utilities', async () => {
    primeUnauthenticatedInit(fetchMock);
    const { container } = renderAt('/login');

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /sign in/i })).toBeInTheDocument();
    });

    const aside = container.querySelector('aside');
    expect(aside).not.toBeNull();
    // jsdom doesn't compute media queries; assert the responsive classes are
    // wired up. `hidden` collapses by default; `md:flex` reveals at >= 768px.
    const cls = aside?.className ?? '';
    expect(cls).toMatch(/\bhidden\b/);
    expect(cls).toMatch(/md:flex/);
  });

  it('login mode shows the "Sign in" heading and subtitle', async () => {
    primeUnauthenticatedInit(fetchMock);
    renderAt('/login');

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /sign in/i })).toBeInTheDocument();
    });
    expect(screen.getByText(/continue your stories/i)).toBeInTheDocument();
  });

  it('register mode shows the "Create account" heading and subtitle', async () => {
    primeUnauthenticatedInit(fetchMock);
    renderAt('/register');

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /create account/i })).toBeInTheDocument();
    });
    expect(screen.getByText(/single account holds all your drafts/i)).toBeInTheDocument();
  });

  it('register mode shows the username hint; login mode does not', async () => {
    primeUnauthenticatedInit(fetchMock);
    const { unmount } = renderAt('/register');
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /create account/i })).toBeInTheDocument();
    });
    expect(screen.getByText(/lowercase, no spaces/i)).toBeInTheDocument();
    unmount();

    primeUnauthenticatedInit(fetchMock);
    renderAt('/login');
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /sign in/i })).toBeInTheDocument();
    });
    expect(screen.queryByText(/lowercase, no spaces/i)).toBeNull();
  });

  it('password field has an eye-toggle button that flips input type', async () => {
    primeUnauthenticatedInit(fetchMock);
    const user = userEvent.setup();
    renderAt('/login');

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /sign in/i })).toBeInTheDocument();
    });

    const passwordInput = screen.getByLabelText(/password/i) as HTMLInputElement;
    expect(passwordInput.type).toBe('password');

    const toggle = screen.getByRole('button', { name: /^show$/i });
    await user.click(toggle);
    expect(passwordInput.type).toBe('text');

    const hideToggle = screen.getByRole('button', { name: /^hide$/i });
    await user.click(hideToggle);
    expect(passwordInput.type).toBe('password');
  });

  it('shield-icon footer is rendered with the self-hosted statement', async () => {
    primeUnauthenticatedInit(fetchMock);
    renderAt('/login');

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /sign in/i })).toBeInTheDocument();
    });
    expect(screen.getByText(/authenticated against your self-hosted/i)).toBeInTheDocument();
  });

  it('login mode mode-switch link points to /register', async () => {
    primeUnauthenticatedInit(fetchMock);
    renderAt('/login');

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /sign in/i })).toBeInTheDocument();
    });
    const link = screen.getByRole('link', { name: /create one/i });
    expect(link).toHaveAttribute('href', '/register');
  });
});
