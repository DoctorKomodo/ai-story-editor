import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
// Dynamically imported so the test file resolves even before the component exists.
// (The import is at top-level so vitest can fail on module-not-found.)
import { SettingsDataTab } from '@/components/SettingsDataTab';
import * as apiModule from '@/lib/api';
import { resetApiClientForTests, setUnauthorizedHandler } from '@/lib/api';
import { useSessionStore } from '@/store/session';

const { navigateSpy } = vi.hoisted(() => ({ navigateSpy: vi.fn() }));
vi.mock('react-router-dom', async (orig) => ({
  ...(await orig<typeof import('react-router-dom')>()),
  useNavigate: () => navigateSpy,
}));

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
    vi.restoreAllMocks();
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

  it('enables Restore when a valid backup file is staged AND the exact phrase is typed', async () => {
    renderTab();

    // Stage a valid backup file via the file input.
    const validBackup = {
      formatVersion: 1,
      app: 'inkwell',
      exportedAt: '2026-06-24T12:00:00.000Z',
      stories: [],
    };
    const file = new File([JSON.stringify(validBackup)], 'backup.json', {
      type: 'application/json',
    });
    fireEvent.change(screen.getByTestId('data-restore-file'), { target: { files: [file] } });

    // Type the exact confirmation phrase.
    fireEvent.change(screen.getByLabelText(/type .*replace everything/i), {
      target: { value: 'replace everything' },
    });

    // onFileChange is async (f.text() + safeParse) — wait for state to settle.
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /restore/i })).toBeEnabled();
    });
  });

  const VALID_BACKUP = {
    formatVersion: 1,
    app: 'inkwell',
    exportedAt: '2026-06-24T12:00:00.000Z',
    stories: [],
  };
  const IMPORT_RESULT = {
    imported: {
      stories: 0,
      chapters: 0,
      characters: 0,
      outlineItems: 0,
      chats: 0,
      messages: 0,
    },
  };

  async function stageValidFile(): Promise<void> {
    const file = new File([JSON.stringify(VALID_BACKUP)], 'backup.json', {
      type: 'application/json',
    });
    fireEvent.change(screen.getByTestId('data-restore-file'), { target: { files: [file] } });
    await waitFor(() => expect(screen.getByTestId('data-restore-summary')).toBeInTheDocument());
  }

  it('renders the safety export checkbox checked by default', async () => {
    renderTab();
    await stageValidFile();
    const checkbox = screen.getByTestId('data-restore-safety') as HTMLInputElement;
    expect(checkbox).toBeInTheDocument();
    expect(checkbox.checked).toBe(true);
  });

  it('skips the safety export when the checkbox is unchecked', async () => {
    const exportSpy = vi.spyOn(apiModule, 'fetchExportBlob');
    vi.spyOn(apiModule, 'api').mockResolvedValue(IMPORT_RESULT);
    renderTab();
    await stageValidFile();
    fireEvent.click(screen.getByTestId('data-restore-safety')); // default on → uncheck
    fireEvent.change(screen.getByLabelText(/type .*replace everything/i), {
      target: { value: 'replace everything' },
    });
    fireEvent.click(screen.getByRole('button', { name: /restore/i }));
    await waitFor(() =>
      expect(apiModule.api).toHaveBeenCalledWith(
        '/users/me/import',
        expect.objectContaining({ method: 'POST' }),
      ),
    );
    expect(exportSpy).not.toHaveBeenCalled();
  });

  it('runs the safety export when the checkbox is left checked', async () => {
    const exportSpy = vi
      .spyOn(apiModule, 'fetchExportBlob')
      .mockResolvedValue({ blob: new Blob(['{}']), filename: 'inkwell-backup.json' });
    vi.spyOn(apiModule, 'api').mockResolvedValue(IMPORT_RESULT);
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:x');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    renderTab();
    await stageValidFile();
    fireEvent.change(screen.getByLabelText(/type .*replace everything/i), {
      target: { value: 'replace everything' },
    });
    fireEvent.click(screen.getByRole('button', { name: /restore/i }));
    await waitFor(() => expect(exportSpy).toHaveBeenCalledTimes(1));
  });
});
