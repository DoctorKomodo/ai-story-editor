import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { importSchema } from 'story-editor-shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SettingsDataTab } from '@/components/SettingsDataTab';
import type { ApiRequestInit } from '@/lib/api';
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

const LEGACY_BACKUP = {
  formatVersion: 2,
  app: 'inkwell',
  exportedAt: '2026-06-24T12:00:00.000Z',
  stories: [],
};

const IMPORT_RESULT_EMPTY = {
  imported: { stories: 0, chapters: 0, characters: 0, outlineItems: 0, chats: 0, messages: 0 },
  outcomes: [],
};

function makeFile(content: unknown, name = 'backup.json'): File {
  return new File([JSON.stringify(content)], name, { type: 'application/json' });
}

async function stageFile(content: unknown): Promise<void> {
  fireEvent.change(screen.getByTestId('data-restore-file'), {
    target: { files: [makeFile(content)] },
  });
  await waitFor(() => expect(screen.getByTestId('data-restore-summary')).toBeInTheDocument());
}

describe('SettingsDataTab', () => {
  beforeEach(() => {
    navigateSpy.mockClear();
    // The real safety-export path clicks an anchor to trigger a download;
    // stub it so jsdom doesn't log "Not implemented: navigation to another Document".
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
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

  it('disables Restore until a valid file is staged', () => {
    renderTab();
    expect(screen.getByRole('button', { name: /restore/i })).toBeDisabled();
  });

  it('clears the filename display when an invalid file is selected', async () => {
    renderTab();
    const bad = new File(['not json'], 'bad.json', { type: 'application/json' });
    fireEvent.change(screen.getByTestId('data-restore-file'), { target: { files: [bad] } });
    await waitFor(() => expect(screen.getByTestId('data-restore-error')).toBeInTheDocument());
    expect(screen.getByText('No file selected')).toBeInTheDocument();
  });

  it('names the format version when an old (v1) backup is staged, instead of the generic message', async () => {
    renderTab();
    fireEvent.change(screen.getByTestId('data-restore-file'), {
      target: { files: [makeFile({ ...LEGACY_BACKUP, formatVersion: 1 }, 'old-backup.json')] },
    });
    await waitFor(() => expect(screen.getByTestId('data-restore-error')).toBeInTheDocument());
    expect(screen.getByTestId('data-restore-error')).toHaveTextContent(/format version 1/);
    expect(screen.getByTestId('data-restore-error')).not.toHaveTextContent(
      'not a valid Inkwell backup',
    );
  });

  it('enables Restore as soon as a legacy (no-id) file is staged — no phrase needed', async () => {
    const apiSpy = vi.spyOn(apiModule, 'api');
    renderTab();
    await stageFile(LEGACY_BACKUP);

    expect(screen.getByRole('button', { name: /restore/i })).toBeEnabled();
    // Legacy file has no story carrying both id + snapshotUpdatedAt — the plan
    // endpoint must not be called at all.
    expect(apiSpy).not.toHaveBeenCalledWith('/users/me/import/plan', expect.anything());
  });

  it('skips the plan call entirely for a legacy file with stories (no ids)', async () => {
    const apiSpy = vi.spyOn(apiModule, 'api');
    renderTab();
    await stageFile({
      ...LEGACY_BACKUP,
      stories: [{ title: 'Old Draft' }, { title: 'Another Draft' }],
    });

    expect(screen.getByTestId('data-restore-row-0')).toBeInTheDocument();
    expect(screen.getByTestId('data-restore-bucket-0')).toHaveTextContent('New');
    expect(apiSpy).not.toHaveBeenCalled();
  });

  it('ignores a stale plan response from a previously picked file', async () => {
    const fileA = {
      ...LEGACY_BACKUP,
      stories: [{ title: 'Story A', id: 'a1', snapshotUpdatedAt: '2026-06-24T12:00:00.000Z' }],
    };
    const fileB = {
      ...LEGACY_BACKUP,
      stories: [{ title: 'Story B', id: 'b1', snapshotUpdatedAt: '2026-06-24T12:00:00.000Z' }],
    };

    let resolveAPlan: (value: unknown) => void = () => {};
    const aPlanPromise = new Promise((resolve) => {
      resolveAPlan = resolve;
    });

    vi.spyOn(apiModule, 'api').mockImplementation(async (path: string, init?: ApiRequestInit) => {
      if (path === '/users/me/import/plan') {
        const body = init?.body as { stories: Array<{ id: string }> };
        if (body.stories[0]?.id === 'a1') return aPlanPromise;
        return { stories: [{ id: 'b1', status: 'new' }] };
      }
      if (path === '/users/me/import') return IMPORT_RESULT_EMPTY;
      throw new Error(`unexpected call: ${path}`);
    });

    renderTab();

    // Pick file A — its plan call is deliberately left unresolved.
    fireEvent.change(screen.getByTestId('data-restore-file'), {
      target: { files: [makeFile(fileA, 'a.json')] },
    });
    await waitFor(() =>
      expect(screen.getByTestId('data-restore-plan-pending')).toBeInTheDocument(),
    );

    // Pick file B before A's plan round-trip settles.
    fireEvent.change(screen.getByTestId('data-restore-file'), {
      target: { files: [makeFile(fileB, 'b.json')] },
    });
    await waitFor(() => expect(screen.getByTestId('data-restore-row-0')).toBeInTheDocument());
    expect(screen.getByText('Story B')).toBeInTheDocument();
    expect(screen.queryByText('Story A')).not.toBeInTheDocument();

    // Now let A's stale plan resolve — it must not clobber B's staged rows.
    await act(async () => {
      resolveAPlan({ stories: [{ id: 'a1', status: 'new' }] });
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(screen.getByText('Story B')).toBeInTheDocument();
    expect(screen.queryByText('Story A')).not.toBeInTheDocument();
    expect(screen.getByTestId('data-restore-summary')).toHaveTextContent('1 story');

    const apiSpy = vi.mocked(apiModule.api);
    apiSpy.mockClear();
    apiSpy.mockImplementation(async (path: string, init?: ApiRequestInit) => {
      if (path === '/users/me/import') {
        expect(init?.body).toEqual({
          file: importSchema.parse(fileB),
          resolutions: { b1: 'create' },
        });
        return IMPORT_RESULT_EMPTY;
      }
      throw new Error(`unexpected call: ${path}`);
    });

    fireEvent.click(screen.getByRole('button', { name: /restore/i }));
    await waitFor(() => expect(screen.getByTestId('data-restore-result')).toBeInTheDocument());
  });

  it('disables restore controls during the safety-export phase, and a second click does not double-submit', async () => {
    let resolveExport: (value: { blob: Blob; filename: string }) => void = () => {};
    const exportPromise = new Promise<{ blob: Blob; filename: string }>((resolve) => {
      resolveExport = resolve;
    });
    vi.spyOn(apiModule, 'fetchExportBlob').mockReturnValue(exportPromise);
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:x');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});

    let importCallCount = 0;
    vi.spyOn(apiModule, 'api').mockImplementation(async (path: string) => {
      if (path === '/users/me/import/plan') {
        return { stories: [{ id: 'c1', status: 'conflict' }] };
      }
      if (path === '/users/me/import') {
        importCallCount += 1;
        return IMPORT_RESULT_EMPTY;
      }
      throw new Error(`unexpected call: ${path}`);
    });

    renderTab();
    await stageFile({
      ...LEGACY_BACKUP,
      stories: [
        { title: 'Conflicting Story', id: 'c1', snapshotUpdatedAt: '2026-06-24T12:00:00.000Z' },
      ],
    });
    await waitFor(() => expect(screen.getByTestId('data-restore-row-0')).toBeInTheDocument());
    fireEvent.change(screen.getByRole('combobox', { name: 'Resolution for "Conflicting Story"' }), {
      target: { value: 'replace' },
    });
    fireEvent.change(screen.getByTestId('data-restore-phrase'), {
      target: { value: 'replace these stories' },
    });

    // Safety backup stays on (default) so onRestore awaits exporter.download()
    // before the import call — this is the window that used to leave every
    // control (including Restore itself) enabled.
    fireEvent.click(screen.getByRole('button', { name: /restore/i }));

    await waitFor(() => expect(screen.getByTestId('data-restore-file')).toBeDisabled());
    expect(screen.getByTestId('data-restore-browse')).toBeDisabled();
    expect(
      screen.getByRole('combobox', { name: 'Resolution for "Conflicting Story"' }),
    ).toBeDisabled();
    expect(screen.getByTestId('data-restore-btn')).toBeDisabled();

    // A second click landing in this window (e.g. an impatient double-click)
    // must not fire a second restore — fireEvent bypasses the `disabled`
    // attribute, so this exercises the re-entrancy guard directly, not just
    // the DOM's own disabled-click suppression.
    fireEvent.click(screen.getByTestId('data-restore-btn'));

    await act(async () => {
      resolveExport({ blob: new Blob(['{}']), filename: 'inkwell-backup.json' });
      await Promise.resolve();
      await Promise.resolve();
    });

    await waitFor(() => expect(screen.getByTestId('data-restore-result')).toBeInTheDocument());
    expect(importCallCount).toBe(1);

    expect(screen.getByTestId('data-restore-file')).not.toBeDisabled();
  });

  it('ignores a stale restore continuation after a mid-flight file re-pick', async () => {
    const fileA = { ...LEGACY_BACKUP, stories: [{ title: 'Story A' }] };
    const fileB = { ...LEGACY_BACKUP, stories: [{ title: 'Story B' }] };

    let resolveImportA: (value: unknown) => void = () => {};
    const importAPromise = new Promise((resolve) => {
      resolveImportA = resolve;
    });

    vi.spyOn(apiModule, 'api').mockImplementation(async (path: string) => {
      if (path === '/users/me/import') return importAPromise;
      throw new Error(`unexpected call: ${path}`);
    });

    renderTab();
    await stageFile(fileA);

    fireEvent.click(screen.getByRole('button', { name: /restore/i }));
    await waitFor(() => expect(screen.getByTestId('data-restore-file')).toBeDisabled());

    // Simulate a re-pick landing anyway (e.g. drag-drop, or a path that
    // bypasses the disabled control) while A's restore is still in flight.
    fireEvent.change(screen.getByTestId('data-restore-file'), {
      target: { files: [makeFile(fileB, 'b.json')] },
    });
    await waitFor(() => expect(screen.getByTestId('data-restore-row-0')).toBeInTheDocument());
    expect(screen.getByText('Story B')).toBeInTheDocument();
    expect(screen.queryByText('Story A')).not.toBeInTheDocument();

    // Now let A's restore resolve — its continuation must not clobber B's
    // freshly-staged picker state, though the result panel for A still shows.
    await act(async () => {
      resolveImportA({
        imported: {
          stories: 1,
          chapters: 0,
          characters: 0,
          outlineItems: 0,
          chats: 0,
          messages: 0,
        },
        outcomes: [{ index: 0, action: 'created' }],
      });
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(screen.getByTestId('data-restore-result')).toBeInTheDocument();
    expect(screen.getByText('Story B')).toBeInTheDocument();
    expect(screen.queryByText('Story A')).not.toBeInTheDocument();
    expect(screen.getByTestId('data-restore-summary')).toHaveTextContent('1 story');
    expect(screen.getByText('b.json')).toBeInTheDocument();
  });

  it('defaults each bucket to the documented resolution', async () => {
    vi.spyOn(apiModule, 'api').mockImplementation(async (path: string) => {
      if (path === '/users/me/import/plan') {
        return {
          stories: [
            { id: 'new-1', status: 'new' },
            { id: 'unchanged-1', status: 'unchanged' },
            { id: 'conflict-1', status: 'conflict' },
          ],
        };
      }
      throw new Error(`unexpected call: ${path}`);
    });

    renderTab();
    await stageFile({
      ...LEGACY_BACKUP,
      stories: [
        { title: 'New Story', id: 'new-1', snapshotUpdatedAt: '2026-06-24T12:00:00.000Z' },
        {
          title: 'Unchanged Story',
          id: 'unchanged-1',
          snapshotUpdatedAt: '2026-06-24T12:00:00.000Z',
        },
        {
          title: 'Conflicting Story',
          id: 'conflict-1',
          snapshotUpdatedAt: '2026-06-24T12:00:00.000Z',
        },
      ],
    });

    await waitFor(() => expect(screen.getByTestId('data-restore-row-2')).toBeInTheDocument());

    expect(screen.getByTestId('data-restore-bucket-0')).toHaveTextContent('New');
    expect(screen.getByRole('combobox', { name: 'Resolution for "New Story"' })).toHaveValue(
      'create',
    );

    expect(screen.getByTestId('data-restore-bucket-1')).toHaveTextContent('Unchanged');
    expect(screen.getByRole('combobox', { name: 'Resolution for "Unchanged Story"' })).toHaveValue(
      'skip',
    );

    expect(screen.getByTestId('data-restore-bucket-2')).toHaveTextContent('Conflict');
    expect(
      screen.getByRole('combobox', { name: 'Resolution for "Conflicting Story"' }),
    ).toHaveValue('create');
  });

  it('shows the typed-phrase gate only once a replace is selected', async () => {
    vi.spyOn(apiModule, 'api').mockImplementation(async (path: string) => {
      if (path === '/users/me/import/plan') {
        return { stories: [{ id: 'c1', status: 'conflict' }] };
      }
      throw new Error(`unexpected call: ${path}`);
    });

    renderTab();
    await stageFile({
      ...LEGACY_BACKUP,
      stories: [
        { title: 'Conflicting Story', id: 'c1', snapshotUpdatedAt: '2026-06-24T12:00:00.000Z' },
      ],
    });
    await waitFor(() => expect(screen.getByTestId('data-restore-row-0')).toBeInTheDocument());

    // Default resolution for a conflict is `create` ("keep both") — no replace
    // selected yet, so no destructive gate.
    expect(screen.queryByTestId('data-restore-phrase')).not.toBeInTheDocument();
    expect(screen.queryByTestId('data-restore-safety')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /restore/i })).toBeEnabled();

    fireEvent.change(screen.getByRole('combobox', { name: 'Resolution for "Conflicting Story"' }), {
      target: { value: 'replace' },
    });

    expect(screen.getByTestId('data-restore-phrase')).toBeInTheDocument();
    expect(screen.getByTestId('data-restore-safety')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /restore/i })).toBeDisabled();

    fireEvent.change(screen.getByTestId('data-restore-phrase'), {
      target: { value: 'replace these stories' },
    });
    expect(screen.getByRole('button', { name: /restore/i })).toBeEnabled();

    // Switching back off replace removes the gate again and re-enables Restore.
    fireEvent.change(screen.getByRole('combobox', { name: 'Resolution for "Conflicting Story"' }), {
      target: { value: 'skip' },
    });
    expect(screen.queryByTestId('data-restore-phrase')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /restore/i })).toBeEnabled();
  });

  it('restores a legacy file with no destructive gate and reports the outcome', async () => {
    vi.spyOn(apiModule, 'api').mockImplementation(async (path: string, init?: ApiRequestInit) => {
      if (path === '/users/me/import') {
        expect(init?.body).toEqual({ file: LEGACY_BACKUP, resolutions: {} });
        return IMPORT_RESULT_EMPTY;
      }
      throw new Error(`unexpected call: ${path}`);
    });

    renderTab();
    await stageFile(LEGACY_BACKUP);
    fireEvent.click(screen.getByRole('button', { name: /restore/i }));

    await waitFor(() => expect(screen.getByTestId('data-restore-result')).toBeInTheDocument());
    expect(screen.getByTestId('data-restore-result')).toHaveTextContent(
      '0 created, 0 replaced, 0 skipped',
    );
  });

  it('shows a failure banner and does not clear the form when the import rejects', async () => {
    vi.spyOn(apiModule, 'api').mockRejectedValue(new Error('Server exploded'));
    renderTab();
    await stageFile(LEGACY_BACKUP);
    fireEvent.click(screen.getByRole('button', { name: /restore/i }));

    await waitFor(() => expect(screen.getByTestId('data-restore-failure')).toBeInTheDocument());
    expect(screen.getByTestId('data-restore-failure')).toHaveTextContent(/Server exploded/i);
    expect(screen.queryByTestId('data-restore-result')).not.toBeInTheDocument();
  });

  it('renders per-story outcomes, including stories left unattempted after a mid-file failure', async () => {
    vi.spyOn(apiModule, 'api').mockImplementation(async (path: string) => {
      if (path === '/users/me/import') {
        return {
          imported: {
            stories: 1,
            chapters: 0,
            characters: 0,
            outlineItems: 0,
            chats: 0,
            messages: 0,
          },
          outcomes: [
            { index: 0, action: 'created' },
            { index: 1, action: 'failed' },
          ],
        };
      }
      throw new Error(`unexpected call: ${path}`);
    });

    renderTab();
    await stageFile({
      ...LEGACY_BACKUP,
      stories: [{ title: 'Story A' }, { title: 'Story B' }, { title: 'Story C' }],
    });
    fireEvent.click(screen.getByRole('button', { name: /restore/i }));

    await waitFor(() => expect(screen.getByTestId('data-restore-result')).toBeInTheDocument());
    expect(screen.getByTestId('data-restore-result')).toHaveTextContent(
      '1 created, 0 replaced, 0 skipped, 1 failed',
    );
    expect(screen.getByTestId('data-restore-result-failure')).toHaveTextContent('Story B');
    expect(screen.getByTestId('data-restore-result-not-attempted')).toHaveTextContent(
      '1 story was not attempted',
    );
  });

  it('navigates to the library when "Go to library" is clicked after a restore', async () => {
    vi.spyOn(apiModule, 'api').mockImplementation(async (path: string) => {
      if (path === '/users/me/import') return IMPORT_RESULT_EMPTY;
      throw new Error(`unexpected call: ${path}`);
    });
    renderTab();
    await stageFile(LEGACY_BACKUP);
    fireEvent.click(screen.getByRole('button', { name: /restore/i }));
    await waitFor(() => expect(screen.getByTestId('data-restore-result')).toBeInTheDocument());

    fireEvent.click(screen.getByTestId('data-restore-result-done'));
    expect(navigateSpy).toHaveBeenCalledWith('/');
  });

  describe('when a replace is selected', () => {
    async function stageConflictAndSelectReplace(): Promise<void> {
      vi.spyOn(apiModule, 'api').mockImplementation(async (path: string, init?: ApiRequestInit) => {
        if (path === '/users/me/import/plan') {
          return { stories: [{ id: 'c1', status: 'conflict' }] };
        }
        if (path === '/users/me/import') {
          expect(init?.body).toMatchObject({ resolutions: { c1: 'replace' } });
          return IMPORT_RESULT_EMPTY;
        }
        throw new Error(`unexpected call: ${path}`);
      });

      await stageFile({
        ...LEGACY_BACKUP,
        stories: [
          { title: 'Conflicting Story', id: 'c1', snapshotUpdatedAt: '2026-06-24T12:00:00.000Z' },
        ],
      });
      await waitFor(() => expect(screen.getByTestId('data-restore-row-0')).toBeInTheDocument());
      fireEvent.change(
        screen.getByRole('combobox', { name: 'Resolution for "Conflicting Story"' }),
        {
          target: { value: 'replace' },
        },
      );
      fireEvent.change(screen.getByTestId('data-restore-phrase'), {
        target: { value: 'replace these stories' },
      });
    }

    it('runs the safety export by default before restoring', async () => {
      renderTab();
      const exportSpy = vi
        .spyOn(apiModule, 'fetchExportBlob')
        .mockResolvedValue({ blob: new Blob(['{}']), filename: 'inkwell-backup.json' });
      vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:x');
      vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});

      await stageConflictAndSelectReplace();
      fireEvent.click(screen.getByRole('button', { name: /restore/i }));

      await waitFor(() => expect(exportSpy).toHaveBeenCalledTimes(1));
      await waitFor(() => expect(screen.getByTestId('data-restore-result')).toBeInTheDocument());
    });

    it('skips the safety export when the checkbox is unchecked', async () => {
      renderTab();
      const exportSpy = vi.spyOn(apiModule, 'fetchExportBlob');

      await stageConflictAndSelectReplace();
      fireEvent.click(screen.getByTestId('data-restore-safety')); // default on → uncheck
      fireEvent.click(screen.getByRole('button', { name: /restore/i }));

      await waitFor(() => expect(screen.getByTestId('data-restore-result')).toBeInTheDocument());
      expect(exportSpy).not.toHaveBeenCalled();
    });

    it('cancels with a safety-backup message (import not called) when the safety export fails', async () => {
      renderTab();
      vi.spyOn(apiModule, 'fetchExportBlob').mockRejectedValue(new Error('network down'));
      const apiSpy = vi.spyOn(apiModule, 'api');

      await stageConflictAndSelectReplace();
      fireEvent.click(screen.getByRole('button', { name: /restore/i }));

      await waitFor(() => expect(screen.getByTestId('data-restore-failure')).toBeInTheDocument());
      expect(screen.getByTestId('data-restore-failure')).toHaveTextContent(/safety backup/i);
      expect(apiSpy).not.toHaveBeenCalledWith('/users/me/import', expect.anything());
    });
  });
});
