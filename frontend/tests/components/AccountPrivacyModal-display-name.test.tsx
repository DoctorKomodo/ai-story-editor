// [X3] AccountPrivacyModal "Display name" section — render, edit, save,
// success, validation, rate-limit. Mirrors the patterns used in the
// existing AccountPrivacyModal*.test.tsx files in this folder.
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AccountPrivacyModal } from '@/components/AccountPrivacyModal';
import { resetApiClientForTests, setUnauthorizedHandler } from '@/lib/api';
import { useSessionStore } from '@/store/session';
import { actStore } from '../utils/actStore';

const fetchMock = vi.fn();
beforeEach(() => {
  resetApiClientForTests();
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockReset();
  setUnauthorizedHandler(null);
  useSessionStore.setState({
    user: { id: 'u1', username: 'someuser', name: 'Original Name' },
    status: 'authenticated',
  });
});
afterEach(() => {
  vi.unstubAllGlobals();
  resetApiClientForTests();
  actStore(() => {
    useSessionStore.setState({ user: null, status: 'idle' });
  });
});

function renderModal() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <AccountPrivacyModal open onClose={vi.fn()} username="someuser" />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('AccountPrivacyModal — Display name section', () => {
  it('renders the current display name from the session store', () => {
    renderModal();
    const input = screen.getByRole('textbox', { name: /display name/i }) as HTMLInputElement;
    expect(input.value).toBe('Original Name');
  });

  it('disables Save until the value is dirty and valid', async () => {
    renderModal();
    const save = screen.getByRole('button', { name: /save display name/i });
    expect(save).toBeDisabled(); // not dirty

    const input = screen.getByRole('textbox', { name: /display name/i });
    await userEvent.clear(input);
    await userEvent.type(input, '   '); // whitespace-only
    expect(save).toBeDisabled();

    await userEvent.clear(input);
    await userEvent.type(input, 'New Name');
    expect(save).toBeEnabled();
  });

  it('on success: posts trimmed name, updates session store, re-disables Save', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ user: { id: 'u1', username: 'someuser', name: 'New Name' } }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    renderModal();
    const input = screen.getByRole('textbox', { name: /display name/i });
    await userEvent.clear(input);
    await userEvent.type(input, '   New Name   ');
    await userEvent.click(screen.getByRole('button', { name: /save display name/i }));

    await waitFor(() => {
      expect(useSessionStore.getState().user?.name).toBe('New Name');
    });
    const call = fetchMock.mock.calls[0];
    const body = JSON.parse(call[1].body as string);
    expect(body).toEqual({ name: 'New Name' });
    expect(screen.getByRole('button', { name: /save display name/i })).toBeDisabled();
  });

  it('on 400: shows inline validation error', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        // IMPORTANT: project convention uses `code: 'validation_error'` for Zod failures
        // (per Task 1's review). Plan text said `invalid_input`; align to project convention.
        JSON.stringify({ error: { message: 'Name too long', code: 'validation_error' } }),
        { status: 400, headers: { 'content-type': 'application/json' } },
      ),
    );
    renderModal();
    const input = screen.getByRole('textbox', { name: /display name/i });
    await userEvent.clear(input);
    await userEvent.type(input, 'X');
    await userEvent.click(screen.getByRole('button', { name: /save display name/i }));
    expect(await screen.findByRole('alert')).toBeInTheDocument();
  });

  it('on 429: shows rate-limit error', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({ error: { message: 'Too many requests', code: 'rate_limited' } }),
        { status: 429, headers: { 'content-type': 'application/json' } },
      ),
    );
    renderModal();
    const input = screen.getByRole('textbox', { name: /display name/i });
    await userEvent.clear(input);
    await userEvent.type(input, 'X');
    await userEvent.click(screen.getByRole('button', { name: /save display name/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/too many/i);
  });
});
