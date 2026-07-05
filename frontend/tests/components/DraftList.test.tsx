import 'fake-indexeddb/auto';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { JSX, ReactNode } from 'react';
import type { DraftMeta } from 'story-editor-shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DraftList } from '@/components/DraftList';
import { draftsQueryKey } from '@/hooks/useDrafts';
import { resetApiClientForTests } from '@/lib/api';
import { useSelectedDraftStore } from '@/store/selectedDraft';
import { useSessionStore } from '@/store/session';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function meta(overrides: Partial<DraftMeta> & Pick<DraftMeta, 'id' | 'orderIndex'>): DraftMeta {
  return {
    chapterId: 'ch-1',
    label: null,
    wordCount: 1200,
    isActive: false,
    hasSummary: false,
    summaryIsStale: false,
    createdAt: '2026-06-01T00:00:00.000Z',
    updatedAt: '2026-06-01T01:00:00.000Z',
    ...overrides,
  };
}

const DRAFTS: DraftMeta[] = [
  meta({ id: 'd-a', orderIndex: 0, isActive: true, wordCount: 2100 }),
  meta({ id: 'd-b', orderIndex: 1, label: 'Grimdark ending' }),
  meta({ id: 'd-c', orderIndex: 2 }),
];

interface Handlers {
  onSelectDraft: ReturnType<typeof vi.fn<(chapterId: string, draftId: string) => void>>;
  onRequestNewDraft: ReturnType<typeof vi.fn<(chapterId: string) => void>>;
  onStatus: ReturnType<typeof vi.fn<(message: string) => void>>;
}

function renderList(
  overrides: { viewedDraftId?: string | null; drafts?: DraftMeta[] } = {},
): Handlers & { qc: QueryClient } {
  // staleTime: Infinity — the component's useDraftsQuery must serve the
  // seeded data WITHOUT a mount refetch (a refetch would consume each test's
  // single mockResolvedValueOnce and break the mutation assertions).
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity }, mutations: { retry: false } },
  });
  qc.setQueryData(draftsQueryKey('ch-1'), overrides.drafts ?? DRAFTS);
  const handlers: Handlers = {
    onSelectDraft: vi.fn<(chapterId: string, draftId: string) => void>(),
    onRequestNewDraft: vi.fn<(chapterId: string) => void>(),
    onStatus: vi.fn<(message: string) => void>(),
  };
  const wrapper = ({ children }: { children: ReactNode }): JSX.Element => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
  render(
    <DraftList
      chapterId="ch-1"
      storyId="story-1"
      viewedDraftId={overrides.viewedDraftId ?? null}
      onSelectDraft={handlers.onSelectDraft}
      onRequestNewDraft={handlers.onRequestNewDraft}
      onStatus={handlers.onStatus}
    />,
    { wrapper },
  );
  return { ...handlers, qc };
}

describe('DraftList', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    resetApiClientForTests();
    useSelectedDraftStore.getState().reset();
    useSessionStore.setState({
      user: { id: 'u1', username: 'alice', name: 'Alice' },
      status: 'authenticated',
    });
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    resetApiClientForTests();
    useSelectedDraftStore.getState().reset();
    useSessionStore.setState({ user: null, status: 'idle' });
  });

  it('renders one row per draft: positional/custom label, compact word count, active dot on the active row', () => {
    renderList();
    expect(screen.getByText('Draft A')).toBeInTheDocument();
    expect(screen.getByText('Grimdark ending')).toBeInTheDocument();
    expect(screen.getByText('Draft C')).toBeInTheDocument();
    expect(screen.getByLabelText('Active draft')).toBeInTheDocument();
    expect(screen.getByTestId('draft-row-d-a')).toContainElement(
      screen.getByLabelText('Active draft'),
    );
    expect(screen.getByText('2.1k')).toBeInTheDocument();
  });

  it('marks the viewed row with aria-current', () => {
    renderList({ viewedDraftId: 'd-b' });
    expect(screen.getByTestId('draft-row-d-b')).toHaveAttribute('aria-current', 'true');
    expect(screen.getByTestId('draft-row-d-a')).not.toHaveAttribute('aria-current');
  });

  it('clicking a row body selects the draft', async () => {
    const { onSelectDraft } = renderList();
    await userEvent.click(screen.getByText('Grimdark ending'));
    expect(onSelectDraft).toHaveBeenCalledWith('ch-1', 'd-b');
  });

  it('★ is hidden on the active row, shown on others; activating pins the view first (D9)', async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));
    // The viewed draft belongs to this list AND selection is following-active
    // → the pin must write the pair before the mutation resolves.
    renderList({ viewedDraftId: 'd-a' });

    expect(
      screen.queryByRole('button', { name: 'Set Draft A as active draft' }),
    ).not.toBeInTheDocument();
    await userEvent.click(
      screen.getByRole('button', { name: 'Set Grimdark ending as active draft' }),
    );

    expect(useSelectedDraftStore.getState().selected).toEqual({
      chapterId: 'ch-1',
      draftId: 'd-a',
    });
    await waitFor(() => {
      const put = fetchMock.mock.calls.find(
        ([, init]) => (init as RequestInit | undefined)?.method === 'PUT',
      );
      expect(put).toBeDefined();
    });
    const [url, init] = fetchMock.mock.calls.find(
      ([, i]) => (i as RequestInit | undefined)?.method === 'PUT',
    ) as [string, RequestInit];
    expect(url).toContain('/chapters/ch-1/active-draft');
    expect(JSON.parse(init.body as string)).toEqual({ draftId: 'd-b' });
  });

  it('does NOT pin when the viewed draft is not in this chapter list', async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));
    renderList({ viewedDraftId: 'other-chapter-draft' });
    await userEvent.click(
      screen.getByRole('button', { name: 'Set Grimdark ending as active draft' }),
    );
    expect(useSelectedDraftStore.getState().selected).toBeNull();
  });

  it('✎ swaps the row to InlineEdit; committing a new name PATCHes {label}', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, {
        draft: {
          ...meta({ id: 'd-c', orderIndex: 2 }),
          label: 'Third way',
          bodyJson: null,
          summary: null,
          summaryUpdatedAt: null,
        },
      }),
    );
    renderList();
    await userEvent.click(screen.getByRole('button', { name: 'Rename Draft C' }));
    const input = screen.getByRole('textbox', { name: 'Rename draft' });
    await userEvent.clear(input);
    await userEvent.type(input, 'Third way{Enter}');

    await waitFor(() => {
      const patch = fetchMock.mock.calls.find(
        ([, init]) => (init as RequestInit | undefined)?.method === 'PATCH',
      );
      expect(patch).toBeDefined();
    });
    const [url, init] = fetchMock.mock.calls.find(
      ([, i]) => (i as RequestInit | undefined)?.method === 'PATCH',
    ) as [string, RequestInit];
    expect(url).toContain('/drafts/d-c');
    expect(JSON.parse(init.body as string)).toEqual({ label: 'Third way' });
  });

  it('committing an empty rename clears back to positional (PATCH {label: null})', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, {
        draft: {
          ...meta({ id: 'd-b', orderIndex: 1 }),
          label: null,
          bodyJson: null,
          summary: null,
          summaryUpdatedAt: null,
        },
      }),
    );
    renderList();
    await userEvent.click(screen.getByRole('button', { name: 'Rename Grimdark ending' }));
    const input = screen.getByRole('textbox', { name: 'Rename draft' });
    await userEvent.clear(input);
    await userEvent.keyboard('{Enter}');

    await waitFor(() => {
      const patch = fetchMock.mock.calls.find(
        ([, init]) => (init as RequestInit | undefined)?.method === 'PATCH',
      );
      expect(patch).toBeDefined();
    });
    const [, init] = fetchMock.mock.calls.find(
      ([, i]) => (i as RequestInit | undefined)?.method === 'PATCH',
    ) as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toEqual({ label: null });
  });

  it('committing an unchanged label fires no PATCH', async () => {
    renderList();
    await userEvent.click(screen.getByRole('button', { name: 'Rename Grimdark ending' }));
    await userEvent.keyboard('{Enter}');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('🗑 is hidden on the active row; confirming deletes and clears a matching selection', async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));
    useSelectedDraftStore.getState().setSelectedDraft('ch-1', 'd-c');
    renderList({ viewedDraftId: 'd-c' });

    expect(screen.queryByRole('button', { name: 'Delete Draft A' })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Delete Draft C' }));
    await userEvent.click(screen.getByTestId('draft-row-d-c-confirm-delete'));

    await waitFor(() => {
      const del = fetchMock.mock.calls.find(
        ([, init]) => (init as RequestInit | undefined)?.method === 'DELETE',
      );
      expect(del).toBeDefined();
    });
    await waitFor(() => {
      expect(useSelectedDraftStore.getState().selected).toBeNull();
    });
  });

  it('delete failure reports via onStatus and keeps the confirm open', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(409, {
        error: { message: 'Cannot delete the active draft', code: 'cannot_delete_active_draft' },
      }),
    );
    const { onStatus } = renderList();
    await userEvent.click(screen.getByRole('button', { name: 'Delete Draft C' }));
    await userEvent.click(screen.getByTestId('draft-row-d-c-confirm-delete'));

    await waitFor(() => {
      expect(onStatus).toHaveBeenCalledWith('Draft is now active elsewhere — refreshed');
    });
    expect(screen.getByTestId('draft-row-d-c-confirm')).toBeInTheDocument();
  });

  it('renders the "+ New draft…" row and fires onRequestNewDraft', async () => {
    const { onRequestNewDraft } = renderList();
    await userEvent.click(screen.getByRole('button', { name: 'New draft…' }));
    expect(onRequestNewDraft).toHaveBeenCalledWith('ch-1');
  });
});
