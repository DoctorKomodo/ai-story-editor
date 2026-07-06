// [F56] Integration test: TopBar surfaces the F48 AutosaveIndicator and
// reads its props from the F9 useAutosave hook output piped through
// EditorPage. Validates the prop wiring without driving a full save flow.
//
// [9wk.6] The describe block below ("draft-native corruption-class
// regressions") is Task 3 of the step-6 plan — it drives a full chapter +
// draft mount and exercises the real useAutosave / useUnloadFlush wiring
// end-to-end, pinning the four failure classes the draft-native cutover
// could otherwise reintroduce (cross-draft flush, cross-draft recovery
// offers, an unpreconditioned unload flush, and a broken conflict
// round-trip).

import 'fake-indexeddb/auto';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetApiClientForTests, setUnauthorizedHandler } from '@/lib/api';
import { putDraft } from '@/lib/chapterDrafts';
import { createQueryClient } from '@/lib/queryClient';
import { AppRouter } from '@/router';
import { useActiveChapterStore } from '@/store/activeChapter';
import { useSelectedDraftStore } from '@/store/selectedDraft';
import { useSessionStore } from '@/store/session';
import { useSidebarTabStore } from '@/store/sidebarTab';

type FetchMock = ReturnType<typeof vi.fn>;

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

const FULL_SETTINGS = {
  theme: 'paper',
  prose: { font: 'serif', size: 18, lineHeight: 1.7 },
  writing: { spellcheck: true, typewriterMode: false, focusMode: false, dailyWordGoal: 500 },
  chat: { model: null, temperature: 0.7, topP: 1, maxTokens: 1024 },
  ai: { includeVeniceSystemPrompt: true },
};

function makeStory(): Record<string, unknown> {
  return {
    id: 'abc123',
    title: 'The Long Dark',
    genre: null,
    synopsis: null,
    worldNotes: null,
    targetWords: null,
    includePreviousChaptersInPrompt: true,
    createdAt: '2026-04-01T00:00:00.000Z',
    updatedAt: '2026-04-24T10:00:00.000Z',
  };
}

function defaultRouter(): (url: string) => Promise<Response> {
  return (url) => {
    if (url.endsWith('/auth/me')) {
      return Promise.resolve(
        jsonResponse(200, { user: { id: 'u1', username: 'alice', name: 'Alice' } }),
      );
    }
    if (url.endsWith('/stories/abc123')) {
      return Promise.resolve(jsonResponse(200, { story: makeStory() }));
    }
    if (url.endsWith('/stories/abc123/chapters')) {
      return Promise.resolve(jsonResponse(200, { chapters: [] }));
    }
    if (url.endsWith('/stories/abc123/characters')) {
      return Promise.resolve(jsonResponse(200, { characters: [] }));
    }
    if (url.endsWith('/stories/abc123/outline')) {
      return Promise.resolve(jsonResponse(200, { items: [] }));
    }
    if (url.endsWith('/users/me/venice-account')) {
      return Promise.resolve(
        jsonResponse(200, {
          verified: true,
          balanceUsd: 1,
          diem: 100,
          endpoint: null,
          lastSix: null,
        }),
      );
    }
    if (url.endsWith('/ai/models')) {
      return Promise.resolve(jsonResponse(200, { models: [] }));
    }
    if (url.endsWith('/users/me/settings')) {
      return Promise.resolve(jsonResponse(200, { settings: FULL_SETTINGS }));
    }
    return Promise.reject(new Error(`Unexpected fetch: ${url}`));
  };
}

function renderEditor(): ReturnType<typeof render> {
  const client = createQueryClient();
  return render(
    <MemoryRouter initialEntries={['/stories/abc123']}>
      <AppRouter queryClient={client} />
    </MemoryRouter>,
  );
}

describe('EditorPage autosave indicator (F56)', () => {
  let fetchMock: FetchMock;

  beforeEach(() => {
    resetApiClientForTests();
    setUnauthorizedHandler(() => {
      useSessionStore.getState().clearSession();
    });
    useSessionStore.setState({
      user: { id: 'u1', username: 'alice', name: 'Alice' },
      status: 'authenticated',
    });
    useActiveChapterStore.setState({ activeChapterId: null });
    useSidebarTabStore.setState({ sidebarTab: 'chapters' });
    fetchMock = vi.fn();
    fetchMock.mockImplementation(defaultRouter());
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    setUnauthorizedHandler(null);
    resetApiClientForTests();
    act(() => {
      useSessionStore.setState({ user: null, status: 'idle' });
      useActiveChapterStore.setState({ activeChapterId: null });
      useSidebarTabStore.setState({ sidebarTab: 'chapters' });
    });
  });

  it('mounts the topbar without rendering an autosave message in idle state', async () => {
    renderEditor();

    await waitFor(() => {
      expect(screen.getByTestId('topbar')).toBeInTheDocument();
    });

    // Idle = no indicator text. Saving / saved / error states only render
    // text when the autosave hook flips off idle, which requires a real
    // chapter edit (out of scope here).
    expect(screen.queryByText(/saving/i)).toBeNull();
    expect(screen.queryByText(/save failed/i)).toBeNull();
  });

  it('TopBar accepts the F56 autosave triple shape (no SaveState fallback)', async () => {
    renderEditor();
    // The compile-time check is the test — F56's TopBar prop signature only
    // accepts `{ status, savedAt, retryAt }`. If a stale `saveState` /
    // `savedAtRelative` ever leaks back in, this test won't catch it directly,
    // but typecheck (verify pipeline) will.
    await waitFor(() => {
      expect(screen.getByTestId('topbar')).toBeInTheDocument();
    });
    expect(screen.getByTestId('app-shell')).toBeInTheDocument();
  });
});

// ─── [9wk.6] Draft-native corruption-class regressions (Task 3) ─────────────

interface DraftRecord {
  id: string;
  chapterId: string;
  label: string | null;
  wordCount: number;
  orderIndex: number;
  isActive: boolean;
  hasSummary: boolean;
  summaryIsStale: boolean;
  createdAt: string;
  updatedAt: string;
  bodyJson: unknown;
  summary: null;
  summaryUpdatedAt: null;
}

function draftRecord(
  overrides: Pick<DraftRecord, 'id' | 'orderIndex' | 'isActive' | 'updatedAt'> &
    Partial<DraftRecord>,
): DraftRecord {
  return {
    chapterId: 'ch1',
    label: null,
    wordCount: 0,
    hasSummary: false,
    summaryIsStale: false,
    createdAt: '2026-04-01T00:00:00.000Z',
    bodyJson: null,
    summary: null,
    summaryUpdatedAt: null,
    ...overrides,
  };
}

function draftMetaOf(r: DraftRecord): Record<string, unknown> {
  const {
    bodyJson: _bodyJson,
    summary: _summary,
    summaryUpdatedAt: _summaryUpdatedAt,
    ...meta
  } = r;
  return meta;
}

function makeChapterRecord(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'ch1',
    storyId: 'abc123',
    title: 'Opening',
    orderIndex: 0,
    wordCount: 0,
    hasSummary: false,
    summaryIsStale: false,
    createdAt: '2026-04-01T00:00:00.000Z',
    updatedAt: '2026-04-24T10:00:00.000Z',
    draftCount: 2,
    activeDraftId: 'draft-a',
    ...overrides,
  };
}

interface PatchOutcome {
  status: number;
  body: unknown;
}

/**
 * Minimal in-memory drafts backend for a single chapter ('ch1'). Serves the
 * same routes `defaultRouter()` above serves, plus `/chapters/ch1/drafts`
 * (GET) and `/drafts/:id` (GET/PATCH) backed by `records`. `onPatch` lets a
 * test override the default precondition-check behaviour (e.g. to force a
 * 409 once) without reimplementing the whole router.
 */
function draftsBackendRouter(
  records: Map<string, DraftRecord>,
  onPatch?: (id: string, body: Record<string, unknown>, rec: DraftRecord) => PatchOutcome | null,
  chapters: Record<string, unknown>[] = [makeChapterRecord()],
): (url: string, init?: RequestInit) => Promise<Response> {
  return (url, init) => {
    const method = (init?.method ?? 'GET').toUpperCase();

    if (url.endsWith('/auth/me')) {
      return Promise.resolve(
        jsonResponse(200, { user: { id: 'u1', username: 'alice', name: 'Alice' } }),
      );
    }
    if (url.endsWith('/stories/abc123')) {
      return Promise.resolve(jsonResponse(200, { story: makeStory() }));
    }
    if (url.endsWith('/stories/abc123/chapters')) {
      return Promise.resolve(jsonResponse(200, { chapters }));
    }
    if (url.endsWith('/stories/abc123/characters')) {
      return Promise.resolve(jsonResponse(200, { characters: [] }));
    }
    if (url.endsWith('/stories/abc123/outline')) {
      return Promise.resolve(jsonResponse(200, { items: [] }));
    }
    if (url.endsWith('/users/me/venice-account')) {
      return Promise.resolve(
        jsonResponse(200, {
          verified: true,
          balanceUsd: 1,
          diem: 100,
          endpoint: null,
          lastSix: null,
        }),
      );
    }
    if (url.endsWith('/ai/models')) {
      return Promise.resolve(jsonResponse(200, { models: [] }));
    }
    if (url.endsWith('/users/me/settings')) {
      return Promise.resolve(jsonResponse(200, { settings: FULL_SETTINGS }));
    }
    const listMatch = url.match(/\/chapters\/([^/?]+)\/drafts$/);
    if (listMatch) {
      const chapterId = listMatch[1] as string;
      const list = [...records.values()]
        .filter((r) => r.chapterId === chapterId)
        .sort((a, b) => a.orderIndex - b.orderIndex);
      return Promise.resolve(jsonResponse(200, { drafts: list.map(draftMetaOf) }));
    }

    const match = url.match(/\/drafts\/([^/?]+)$/);
    if (match) {
      const id = match[1] as string;
      const rec = records.get(id);

      if (method === 'GET') {
        if (!rec) {
          return Promise.resolve(
            jsonResponse(404, { error: { message: 'Draft not found', code: 'not_found' } }),
          );
        }
        return Promise.resolve(jsonResponse(200, { draft: rec }));
      }

      if (method === 'PATCH') {
        const body =
          typeof init?.body === 'string' ? (JSON.parse(init.body) as Record<string, unknown>) : {};
        if (!rec) {
          return Promise.resolve(
            jsonResponse(404, { error: { message: 'Draft not found', code: 'not_found' } }),
          );
        }

        const overridden = onPatch?.(id, body, rec);
        if (overridden !== null && overridden !== undefined) {
          return Promise.resolve(jsonResponse(overridden.status, overridden.body));
        }

        if (
          typeof body.expectedUpdatedAt === 'string' &&
          body.expectedUpdatedAt !== rec.updatedAt
        ) {
          return Promise.resolve(
            jsonResponse(409, { error: { message: 'Draft changed elsewhere.', code: 'conflict' } }),
          );
        }

        const next: DraftRecord = {
          ...rec,
          ...(body.bodyJson !== undefined ? { bodyJson: body.bodyJson } : {}),
          ...(typeof body.label === 'string' || body.label === null
            ? { label: body.label as string | null }
            : {}),
          updatedAt: new Date(new Date(rec.updatedAt).getTime() + 1000).toISOString(),
        };
        records.set(id, next);
        return Promise.resolve(jsonResponse(200, { draft: next }));
      }
    }

    return Promise.reject(new Error(`Unexpected fetch: ${method} ${url}`));
  };
}

describe('EditorPage draft-native corruption-class regressions (9wk.6 Task 3)', () => {
  let fetchMock: FetchMock;

  beforeEach(() => {
    resetApiClientForTests();
    setUnauthorizedHandler(() => {
      useSessionStore.getState().clearSession();
    });
    useSessionStore.setState({
      user: { id: 'u1', username: 'alice', name: 'Alice' },
      status: 'authenticated',
    });
    useActiveChapterStore.setState({ activeChapterId: null });
    useSelectedDraftStore.getState().reset();
    useSidebarTabStore.setState({ sidebarTab: 'chapters' });
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    setUnauthorizedHandler(null);
    resetApiClientForTests();
    act(() => {
      useSessionStore.setState({ user: null, status: 'idle' });
      useActiveChapterStore.setState({ activeChapterId: null });
      useSelectedDraftStore.getState().reset();
      useSidebarTabStore.setState({ sidebarTab: 'chapters' });
    });
  });

  function patchCallsTo(draftId: string): [string, RequestInit][] {
    return fetchMock.mock.calls.filter(
      ([url, init]) =>
        typeof url === 'string' &&
        url.endsWith(`/drafts/${draftId}`) &&
        (init as RequestInit | undefined)?.method === 'PATCH',
    ) as [string, RequestInit][];
  }

  /** Every body-PATCH in the run must carry the expectedUpdatedAt precondition
   * (spec D2 missing-entry invariant). `except` allows the explicit-Overwrite
   * body through. */
  function expectAllBodyPatchesPreconditioned(except: string[] = []): void {
    const bodyPatches = fetchMock.mock.calls.filter(([url, init]) => {
      if (typeof url !== 'string' || !/\/drafts\/[^/?]+$/.test(url)) return false;
      const i = init as RequestInit | undefined;
      if (i?.method !== 'PATCH') return false;
      const parsed = JSON.parse((i.body as string) ?? '{}') as Record<string, unknown>;
      return parsed.bodyJson !== undefined;
    }) as [string, RequestInit][];
    for (const [, init] of bodyPatches) {
      const parsed = JSON.parse(init.body as string) as Record<string, unknown>;
      if (except.some((marker) => (init.body as string).includes(marker))) continue;
      expect(parsed.expectedUpdatedAt).toBeTypeOf('string');
    }
  }

  it('draft-switch never cross-flushes a buffered edit onto the newly-viewed draft', async () => {
    const records = new Map<string, DraftRecord>([
      [
        'draft-a',
        draftRecord({
          id: 'draft-a',
          orderIndex: 0,
          isActive: true,
          updatedAt: '2026-04-24T10:00:00.000Z',
          bodyJson: null,
        }),
      ],
      [
        'draft-b',
        draftRecord({
          id: 'draft-b',
          orderIndex: 1,
          isActive: false,
          updatedAt: '2026-04-24T09:00:00.000Z',
          bodyJson: {
            type: 'doc',
            content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Draft B body' }] }],
          },
        }),
      ],
    ]);
    fetchMock.mockImplementation(draftsBackendRouter(records));

    useActiveChapterStore.setState({ activeChapterId: 'ch1' });
    renderEditor();

    const box = await screen.findByRole('textbox', { name: /chapter body/i });
    await waitFor(() => {
      expect(box.textContent ?? '').toBe('');
    });

    box.focus();
    await userEvent.type(box, 'typed into A', { skipClick: true });
    await waitFor(() => {
      expect(box.textContent ?? '').toContain('typed into A');
    });

    act(() => {
      useSelectedDraftStore.getState().setSelectedDraft('ch1', 'draft-b');
    });

    // Re-seeds from B's server body.
    await waitFor(() => {
      expect(screen.getByRole('textbox', { name: /chapter body/i }).textContent ?? '').toContain(
        'Draft B body',
      );
    });

    // The pre-switch buffer may be flushed (useAutosave's resetKey mechanism,
    // DO-NOT-TOUCH) — but only against draft-a, its OWN document. It must
    // never reach draft-b.
    await waitFor(() => {
      expect(patchCallsTo('draft-a').length).toBeGreaterThan(0);
    });
    const flushToA = patchCallsTo('draft-a').find(([, init]) =>
      (init.body as string).includes('typed into A'),
    );
    expect(flushToA).toBeDefined();
    // [9wk.7] The uncached-target variant used to flush WITHOUT a
    // precondition (ref nulled before the flush). Now it must carry A's own
    // timestamp.
    const flushToABody = JSON.parse(flushToA![1].body as string) as Record<string, unknown>;
    expect(flushToABody.expectedUpdatedAt).toBe('2026-04-24T10:00:00.000Z');
    const crossPatch = patchCallsTo('draft-b').find(([, init]) =>
      (init.body as string).includes('typed into A'),
    );
    expect(crossPatch).toBeUndefined();

    // Typing into B afterwards correctly targets draft-b, not draft-a, and
    // never carries A's leftover text.
    const boxB = screen.getByRole('textbox', { name: /chapter body/i });
    boxB.focus();
    await userEvent.type(boxB, ' plus B edit', { skipClick: true });
    await waitFor(
      () => {
        expect(patchCallsTo('draft-b').length).toBeGreaterThan(0);
      },
      { timeout: 8000 },
    );
    const patchToB = patchCallsTo('draft-b').at(-1);
    expect(patchToB![1].body as string).toContain('plus B edit');
    expect(patchToB![1].body as string).not.toContain('typed into A');
  }, 12000);

  it('recovery offer is isolated per draft — viewing B offers no restore for A, viewing A still offers', async () => {
    const T_A = '2026-04-24T10:00:00.000Z';
    const records = new Map<string, DraftRecord>([
      ['draft-a', draftRecord({ id: 'draft-a', orderIndex: 0, isActive: true, updatedAt: T_A })],
      [
        'draft-b',
        draftRecord({
          id: 'draft-b',
          orderIndex: 1,
          isActive: false,
          updatedAt: '2026-04-24T09:00:00.000Z',
        }),
      ],
    ]);
    fetchMock.mockImplementation(draftsBackendRouter(records));

    await putDraft({
      userId: 'u1',
      storyId: 'abc123',
      chapterId: 'ch1',
      draftId: 'draft-a',
      bodyJson: {
        type: 'doc',
        content: [{ type: 'paragraph', content: [{ type: 'text', text: 'recovered' }] }],
      },
      baseUpdatedAt: T_A,
      savedAt: Date.now(),
    });

    useActiveChapterStore.setState({ activeChapterId: 'ch1' });
    renderEditor();

    // Viewing A (the active draft, followed by default): banner offers.
    await waitFor(() => {
      expect(screen.getByTestId('draft-restore-banner')).toBeInTheDocument();
    });

    act(() => {
      useSelectedDraftStore.getState().setSelectedDraft('ch1', 'draft-b');
    });

    // Viewing B: no local record exists for it — no banner.
    await waitFor(() => {
      expect(screen.queryByTestId('draft-restore-banner')).toBeNull();
    });

    act(() => {
      useSelectedDraftStore.getState().setSelectedDraft('ch1', 'draft-a');
    });

    // Back on A: the record still matches — banner offers again.
    await waitFor(() => {
      expect(screen.getByTestId('draft-restore-banner')).toBeInTheDocument();
    });
  });

  it('unload flush PATCHes the viewed draft with { bodyJson, expectedUpdatedAt }', async () => {
    const T_A = '2026-04-24T10:00:00.000Z';
    const records = new Map<string, DraftRecord>([
      [
        'draft-a',
        draftRecord({
          id: 'draft-a',
          orderIndex: 0,
          isActive: true,
          updatedAt: T_A,
          bodyJson: null,
        }),
      ],
    ]);
    fetchMock.mockImplementation(draftsBackendRouter(records));

    useActiveChapterStore.setState({ activeChapterId: 'ch1' });
    renderEditor();

    const box = await screen.findByRole('textbox', { name: /chapter body/i });
    await waitFor(() => {
      expect(box.textContent ?? '').toBe('');
    });

    box.focus();
    await userEvent.type(box, 'unload me', { skipClick: true });
    await waitFor(() => {
      expect(box.textContent ?? '').toContain('unload me');
    });

    act(() => {
      window.dispatchEvent(new Event('pagehide'));
    });

    await waitFor(() => {
      const flush = fetchMock.mock.calls.find(
        ([url, init]) =>
          typeof url === 'string' &&
          url.endsWith('/drafts/draft-a') &&
          (init as RequestInit | undefined)?.keepalive === true,
      );
      expect(flush).toBeDefined();
    });

    const [, init] = fetchMock.mock.calls.find(
      ([url, i]) =>
        typeof url === 'string' &&
        url.endsWith('/drafts/draft-a') &&
        (i as RequestInit | undefined)?.keepalive === true,
    ) as [string, RequestInit];
    const body = JSON.parse(init.body as string) as {
      bodyJson: unknown;
      expectedUpdatedAt: string;
    };
    expect(body.expectedUpdatedAt).toBe(T_A);
    expect(JSON.stringify(body.bodyJson)).toContain('unload me');
  });

  it('conflict round-trip: 409 shows the banner; Reload re-seeds; Overwrite re-PATCHes without expectedUpdatedAt', async () => {
    const T_A = '2026-04-24T10:00:00.000Z';
    const records = new Map<string, DraftRecord>([
      [
        'draft-a',
        draftRecord({
          id: 'draft-a',
          orderIndex: 0,
          isActive: true,
          updatedAt: T_A,
          bodyJson: null,
        }),
      ],
    ]);
    let forceConflictOnce = true;
    fetchMock.mockImplementation(
      draftsBackendRouter(records, (id, body) => {
        if (id === 'draft-a' && forceConflictOnce && body.bodyJson !== undefined) {
          forceConflictOnce = false;
          return {
            status: 409,
            body: { error: { message: 'Draft changed elsewhere.', code: 'conflict' } },
          };
        }
        return null;
      }),
    );

    useActiveChapterStore.setState({ activeChapterId: 'ch1' });
    renderEditor();

    const box = await screen.findByRole('textbox', { name: /chapter body/i });
    await waitFor(() => {
      expect(box.textContent ?? '').toBe('');
    });

    box.focus();
    await userEvent.type(box, 'conflicting edit', { skipClick: true });
    await waitFor(() => {
      expect(box.textContent ?? '').toContain('conflicting edit');
    });

    // Force the debounced save to fire (real timers — see the file-level
    // debounce probe; fake timers deadlock TipTap's own input handling).
    await waitFor(
      () => {
        expect(screen.getByTestId('chapter-conflict-banner')).toBeInTheDocument();
      },
      { timeout: 6000 },
    );

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Reload' }));

    await waitFor(() => {
      expect(screen.queryByTestId('chapter-conflict-banner')).toBeNull();
    });
    // Reload re-seeds from the server's (unchanged, null) body.
    await waitFor(() => {
      expect(screen.getByRole('textbox', { name: /chapter body/i }).textContent ?? '').toBe('');
    });

    // Re-conflict, then Overwrite this time.
    forceConflictOnce = true;
    const box2 = screen.getByRole('textbox', { name: /chapter body/i });
    box2.focus();
    await userEvent.type(box2, 'overwrite this', { skipClick: true });
    await waitFor(
      () => {
        expect(screen.getByTestId('chapter-conflict-banner')).toBeInTheDocument();
      },
      { timeout: 6000 },
    );

    const patchCountBeforeOverwrite = patchCallsTo('draft-a').length;
    await user.click(screen.getByRole('button', { name: 'Overwrite' }));

    await waitFor(() => {
      expect(screen.queryByTestId('chapter-conflict-banner')).toBeNull();
    });
    await waitFor(() => {
      expect(patchCallsTo('draft-a').length).toBeGreaterThan(patchCountBeforeOverwrite);
    });
    const overwriteCall = patchCallsTo('draft-a').at(-1);
    const overwriteBody = JSON.parse(overwriteCall![1].body as string) as Record<string, unknown>;
    expect('expectedUpdatedAt' in overwriteBody).toBe(false);
  }, 15000);

  it('[9wk.7] flush on a draft switch carries the DEPARTED draft own updatedAt — no spurious 409/banner', async () => {
    const T_A = '2026-04-24T10:00:00.000Z';
    const T_B = '2026-04-24T09:00:00.000Z';
    const records = new Map<string, DraftRecord>([
      [
        'draft-a',
        draftRecord({
          id: 'draft-a',
          orderIndex: 0,
          isActive: true,
          updatedAt: T_A,
          bodyJson: null,
        }),
      ],
      [
        'draft-b',
        draftRecord({
          id: 'draft-b',
          orderIndex: 1,
          isActive: false,
          updatedAt: T_B,
          bodyJson: {
            type: 'doc',
            content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Draft B body' }] }],
          },
        }),
      ],
    ]);
    fetchMock.mockImplementation(draftsBackendRouter(records));

    useActiveChapterStore.setState({ activeChapterId: 'ch1' });
    renderEditor();

    // Warm draft-b's DETAIL cache: view B once, then come back to A. This is
    // the precondition of the bug — a cached target makes draftQuery.data
    // flip to B synchronously on the switch, before the resetKey flush runs.
    await screen.findByRole('textbox', { name: /chapter body/i });
    act(() => {
      useSelectedDraftStore.getState().setSelectedDraft('ch1', 'draft-b');
    });
    await waitFor(() => {
      expect(screen.getByRole('textbox', { name: /chapter body/i }).textContent ?? '').toContain(
        'Draft B body',
      );
    });
    act(() => {
      useSelectedDraftStore.getState().setSelectedDraft('ch1', 'draft-a');
    });
    const boxA = screen.getByRole('textbox', { name: /chapter body/i });
    await waitFor(() => {
      expect(boxA.textContent ?? '').toBe('');
    });

    boxA.focus();
    await userEvent.type(boxA, 'typed into A', { skipClick: true });
    await waitFor(() => {
      expect(boxA.textContent ?? '').toContain('typed into A');
    });

    // Switch to the CACHED draft B → resetKey flush fires for draft-a.
    act(() => {
      useSelectedDraftStore.getState().setSelectedDraft('ch1', 'draft-b');
    });

    await waitFor(() => {
      const flush = patchCallsTo('draft-a').find(([, init]) =>
        (init.body as string).includes('typed into A'),
      );
      expect(flush).toBeDefined();
    });
    const [, flushInit] = patchCallsTo('draft-a').find(([, init]) =>
      (init.body as string).includes('typed into A'),
    ) as [string, RequestInit];
    const flushBody = JSON.parse(flushInit.body as string) as Record<string, unknown>;
    // The fix: A's OWN timestamp, not B's — the backend accepts (200), so the
    // final keystrokes reached the server instead of dying on a bogus 409.
    expect(flushBody.expectedUpdatedAt).toBe(T_A);

    // And no conflict banner ever appears on the draft we switched to.
    await waitFor(() => {
      expect(screen.getByRole('textbox', { name: /chapter body/i }).textContent ?? '').toContain(
        'Draft B body',
      );
    });
    expect(screen.queryByTestId('chapter-conflict-banner')).toBeNull();

    // D10: the Paper sub-row shows the VIEWED draft's display label — B has
    // no custom label, so its positional label renders.
    expect(screen.getByTestId('paper-sub')).toHaveTextContent('Draft B');

    expectAllBodyPatchesPreconditioned();
  }, 15000);

  it('[9wk.7] flush on a CHAPTER switch still carries the departed draft updatedAt (never unconditional)', async () => {
    const T_A = '2026-04-24T10:00:00.000Z';
    const records = new Map<string, DraftRecord>([
      [
        'draft-a',
        draftRecord({
          id: 'draft-a',
          orderIndex: 0,
          isActive: true,
          updatedAt: T_A,
          bodyJson: null,
        }),
      ],
      [
        'draft-c',
        draftRecord({
          id: 'draft-c',
          chapterId: 'ch2',
          orderIndex: 0,
          isActive: true,
          updatedAt: '2026-04-24T08:00:00.000Z',
          bodyJson: null,
        }),
      ],
    ]);
    fetchMock.mockImplementation(
      draftsBackendRouter(records, undefined, [
        makeChapterRecord({ draftCount: 1 }),
        makeChapterRecord({
          id: 'ch2',
          title: 'Second',
          orderIndex: 1,
          activeDraftId: 'draft-c',
          draftCount: 1,
        }),
      ]),
    );

    useActiveChapterStore.setState({ activeChapterId: 'ch1' });
    renderEditor();

    const box = await screen.findByRole('textbox', { name: /chapter body/i });
    await waitFor(() => {
      expect(box.textContent ?? '').toBe('');
    });
    box.focus();
    await userEvent.type(box, 'leaving the chapter', { skipClick: true });
    await waitFor(() => {
      expect(box.textContent ?? '').toContain('leaving the chapter');
    });

    act(() => {
      useActiveChapterStore.setState({ activeChapterId: 'ch2' });
    });

    await waitFor(() => {
      const flush = patchCallsTo('draft-a').find(([, init]) =>
        (init.body as string).includes('leaving the chapter'),
      );
      expect(flush).toBeDefined();
    });
    const [, flushInit] = patchCallsTo('draft-a').find(([, init]) =>
      (init.body as string).includes('leaving the chapter'),
    ) as [string, RequestInit];
    const flushBody = JSON.parse(flushInit.body as string) as Record<string, unknown>;
    expect(flushBody.expectedUpdatedAt).toBe(T_A);

    expectAllBodyPatchesPreconditioned();
  }, 15000);

  it('[9wk.7] a real 409 for a draft the user already left shows NO banner; the IDB draft persists', async () => {
    const T_A = '2026-04-24T10:00:00.000Z';
    const records = new Map<string, DraftRecord>([
      [
        'draft-a',
        draftRecord({
          id: 'draft-a',
          orderIndex: 0,
          isActive: true,
          updatedAt: T_A,
          bodyJson: null,
        }),
      ],
      [
        'draft-b',
        draftRecord({
          id: 'draft-b',
          orderIndex: 1,
          isActive: false,
          updatedAt: '2026-04-24T09:00:00.000Z',
          bodyJson: null,
        }),
      ],
    ]);
    // Force EVERY body-PATCH to draft-a to 409 (simulates another device
    // having moved draft-a since we loaded it).
    fetchMock.mockImplementation(
      draftsBackendRouter(records, (id, body) => {
        if (id === 'draft-a' && body.bodyJson !== undefined) {
          return {
            status: 409,
            body: { error: { message: 'Draft changed elsewhere.', code: 'conflict' } },
          };
        }
        return null;
      }),
    );

    useActiveChapterStore.setState({ activeChapterId: 'ch1' });
    renderEditor();

    const box = await screen.findByRole('textbox', { name: /chapter body/i });
    await waitFor(() => {
      expect(box.textContent ?? '').toBe('');
    });
    box.focus();
    await userEvent.type(box, 'doomed edit', { skipClick: true });
    await waitFor(() => {
      expect(box.textContent ?? '').toContain('doomed edit');
    });

    // Switch away IMMEDIATELY — the flush's 409 lands while draft-b is viewed.
    act(() => {
      useSelectedDraftStore.getState().setSelectedDraft('ch1', 'draft-b');
    });

    await waitFor(() => {
      expect(patchCallsTo('draft-a').length).toBeGreaterThan(0);
    });
    // Give the rejected promise a beat to (not) set state, then assert.
    await new Promise((r) => setTimeout(r, 250));
    expect(screen.queryByTestId('chapter-conflict-banner')).toBeNull();

    // The rejected body survives locally for recovery on next view of A.
    const { getDraft } = await import('@/lib/chapterDrafts');
    const local = await getDraft('u1', 'ch1', 'draft-a');
    expect(local).not.toBeNull();
    expect(JSON.stringify(local!.bodyJson)).toContain('doomed edit');
  }, 15000);

  it("[9wk.7] a stale cross-chapter selection pair is cleared on mount; the editor follows the open chapter's active draft", async () => {
    const T_A = '2026-04-24T10:00:00.000Z';
    const T_C = '2026-04-24T08:00:00.000Z';
    const records = new Map<string, DraftRecord>([
      [
        'draft-a',
        draftRecord({
          id: 'draft-a',
          orderIndex: 0,
          isActive: true,
          updatedAt: T_A,
          bodyJson: {
            type: 'doc',
            content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Draft A body' }] }],
          },
        }),
      ],
      [
        'draft-c',
        draftRecord({
          id: 'draft-c',
          chapterId: 'ch2',
          orderIndex: 0,
          isActive: true,
          updatedAt: T_C,
          bodyJson: {
            type: 'doc',
            content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Draft C body' }] }],
          },
        }),
      ],
    ]);
    fetchMock.mockImplementation(
      draftsBackendRouter(records, undefined, [
        makeChapterRecord({ draftCount: 1 }),
        makeChapterRecord({
          id: 'ch2',
          title: 'Second',
          orderIndex: 1,
          activeDraftId: 'draft-c',
          draftCount: 1,
        }),
      ]),
    );

    // Seed a selection pair for ch2 — a DIFFERENT chapter than the one the
    // page opens (ch1). This mirrors a pair left over from a prior chapter
    // switch that never got cleared.
    act(() => {
      useSelectedDraftStore.getState().setSelectedDraft('ch2', 'draft-c');
    });
    useActiveChapterStore.setState({ activeChapterId: 'ch1' });
    renderEditor();

    await waitFor(() => {
      expect(screen.getByRole('textbox', { name: /chapter body/i }).textContent ?? '').toContain(
        'Draft A body',
      );
    });

    expect(useSelectedDraftStore.getState().selected).toBeNull();
  });
});
