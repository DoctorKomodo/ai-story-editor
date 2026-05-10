import { QueryClient } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  _unsafeResetSessionResetRegistryForTests,
  PER_USER_STORES,
  PER_USER_STORES as REGISTERED_STORES,
  registerSessionResetQueryClient,
  resetClientState,
  resetClientStateUsingRegistered,
  swapSession,
} from '@/lib/sessionReset';
import { useAttachedSelectionStore } from '@/store/attachedSelection';
import { useChatDraftStore } from '@/store/chatDraft';
import { useSessionStore } from '@/store/session';

afterEach(() => {
  _unsafeResetSessionResetRegistryForTests();
  useSessionStore.getState().clearSession();
});

describe('resetClientState', () => {
  it('calls queryClient.cancelQueries() before clear (in-flight fetch race)', async () => {
    const qc = new QueryClient();
    const cancelSpy = vi.spyOn(qc, 'cancelQueries');
    const clearSpy = vi.spyOn(qc, 'clear');

    await resetClientState(qc);

    expect(cancelSpy).toHaveBeenCalled();
    expect(clearSpy).toHaveBeenCalled();
    expect(cancelSpy.mock.invocationCallOrder[0]).toBeLessThan(
      clearSpy.mock.invocationCallOrder[0],
    );
  });

  it('empties the cache', async () => {
    const qc = new QueryClient();
    qc.setQueryData(['stories', 'list'], [{ id: 's1' }]);

    await resetClientState(qc);

    expect(qc.getQueryData(['stories', 'list'])).toBeUndefined();
  });

  it('calls reset() on every per-user store in PER_USER_STORES', async () => {
    const spies = PER_USER_STORES.map((store) => vi.spyOn(store.getState(), 'reset'));
    try {
      await resetClientState(new QueryClient());
      for (const spy of spies) {
        expect(spy).toHaveBeenCalledTimes(1);
      }
    } finally {
      spies.forEach((s) => s.mockRestore());
    }
  });

  it('end-to-end smoke: dirty state → clean state', async () => {
    const qc = new QueryClient();
    qc.setQueryData(['stories', 'list'], [{ id: 's1' }]);
    useAttachedSelectionStore.setState({
      attachedSelection: { text: 'leak', chapter: { id: 'c', number: 1, title: '' } },
    });
    useChatDraftStore.setState({
      drafts: {
        chat1: {
          chatId: 'chat1',
          userContent: 'leak',
          attachment: null,
          assistantText: 'leak-stream',
          status: 'streaming',
          error: null,
        },
      },
    });

    await resetClientState(qc);

    expect(qc.getQueryData(['stories', 'list'])).toBeUndefined();
    expect(useAttachedSelectionStore.getState().attachedSelection).toBeNull();
    expect(useChatDraftStore.getState().drafts).toEqual({});
  });
});

describe('swapSession', () => {
  it('resets state BEFORE setSession (ordering invariant)', async () => {
    const qc = new QueryClient();
    qc.setQueryData(['stories', 'list'], [{ id: 'A1' }]);
    useSessionStore.setState({
      user: { id: 'A', username: 'a', name: 'A' },
      status: 'authenticated',
      sessionExpired: false,
    });

    const userAtChange: Array<string | null> = [];
    const dataAtChange: Array<unknown> = [];
    const unsub = useSessionStore.subscribe((s) => {
      userAtChange.push(s.user?.username ?? null);
      dataAtChange.push(qc.getQueryData(['stories', 'list']));
    });

    await swapSession(qc, { id: 'B', username: 'b', name: 'B' }, 'B-token');
    unsub();

    const bIdx = userAtChange.indexOf('b');
    expect(bIdx).toBeGreaterThanOrEqual(0);
    expect(dataAtChange[bIdx]).toBeUndefined();
  });

  it('sets the new user/token via the session store', async () => {
    const qc = new QueryClient();
    await swapSession(qc, { id: 'B', username: 'b', name: 'User B' }, 'B-token');
    expect(useSessionStore.getState().user?.username).toBe('b');
    expect(useSessionStore.getState().status).toBe('authenticated');
  });
});

describe('registered-QC variant', () => {
  it('resetClientStateUsingRegistered is a no-op when nothing is registered', async () => {
    _unsafeResetSessionResetRegistryForTests();
    await expect(resetClientStateUsingRegistered()).resolves.toBeUndefined();
  });

  it('resetClientStateUsingRegistered clears the registered QueryClient', async () => {
    const qc = new QueryClient();
    qc.setQueryData(['stories', 'list'], [{ id: 'A1' }]);
    registerSessionResetQueryClient(qc);

    await resetClientStateUsingRegistered();

    expect(qc.getQueryData(['stories', 'list'])).toBeUndefined();
  });
});

// ─── Enumeration guard: every store file must be classified ──────────────────

describe('store enumeration guard', () => {
  // KEEP IN SYNC with frontend/src/lib/sessionReset.ts.
  const PER_USER_STORES = [
    'activeChapter',
    'attachedSelection',
    'charRefSuggestion',
    'chatDraft',
    'composerDraft',
    'errors',
    'inlineAIResult',
    'selectedCharacter',
    'selection',
  ];
  // UI-only stores intentionally excluded from per-user reset.
  const UI_ONLY_STORES = ['session', 'sidebarTab', 'ui'];

  it('PER_USER_STORES export length matches the per-user-stores allowlist', () => {
    expect(REGISTERED_STORES.length).toBe(PER_USER_STORES.length);
  });

  it('every store file is explicitly classified as per-user-reset or UI-only', () => {
    const all = Object.keys(import.meta.glob('@/store/*.ts'))
      .map((p) => {
        const m = p.match(/store\/(.+)\.ts$/);
        return m === null ? '' : m[1];
      })
      .filter((s) => s.length > 0)
      .sort();

    const classified = new Set([...PER_USER_STORES, ...UI_ONLY_STORES]);
    const unclassified = all.filter((s) => !classified.has(s));

    expect(unclassified).toEqual([]);
  });
});
