import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
// Dynamically imported so the test file resolves even before the component exists.
// (The import is at top-level so vitest can fail on module-not-found.)
import { SettingsDataTab } from '@/components/SettingsDataTab';
import { resetApiClientForTests, setUnauthorizedHandler } from '@/lib/api';
import { useSessionStore } from '@/store/session';

function renderTab() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <SettingsDataTab />
    </QueryClientProvider>,
  );
}

describe('SettingsDataTab', () => {
  beforeEach(() => {
    resetApiClientForTests();
    setUnauthorizedHandler(() => {
      useSessionStore.getState().clearSession();
    });
    useSessionStore.setState({
      user: { id: 'u1', username: 'alice', name: 'Alice' },
      status: 'authenticated',
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(new Response(JSON.stringify({}), { status: 200 }))),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    setUnauthorizedHandler(null);
    resetApiClientForTests();
    useSessionStore.setState({ user: null, status: 'idle' });
  });

  it('renders an Export button', () => {
    renderTab();
    expect(screen.getByRole('button', { name: /export/i })).toBeInTheDocument();
  });

  it('disables Restore until a valid file is staged AND the confirmation phrase is typed', () => {
    renderTab();
    const restore = screen.getByRole('button', { name: /restore/i });

    // Initially disabled — no file and no phrase.
    expect(restore).toBeDisabled();

    // Phrase typed but no file staged — still disabled.
    fireEvent.change(screen.getByLabelText(/type .*replace everything/i), {
      target: { value: 'replace everything' },
    });
    expect(restore).toBeDisabled();
  });
});
