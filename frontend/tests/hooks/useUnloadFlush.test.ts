import { renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type UnloadFlushArgs, useUnloadFlush } from '@/hooks/useUnloadFlush';
import { KEEPALIVE_MAX_BYTES } from '@/lib/api';

type FetchMock = ReturnType<typeof vi.fn>;

function setHidden(): void {
  Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
  document.dispatchEvent(new Event('visibilitychange'));
}

function firePagehide(): void {
  window.dispatchEvent(new Event('pagehide'));
}

describe('useUnloadFlush', () => {
  let fetchMock: FetchMock;

  beforeEach(() => {
    fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('fires a keepalive PATCH with credentials on pagehide when a payload is pending', () => {
    const pending: UnloadFlushArgs = {
      draftId: 'draft-a',
      bodyJson: { type: 'doc' },
      expectedUpdatedAt: '2026-07-02T00:00:00.000Z',
    };
    renderHook(() => useUnloadFlush(() => pending));

    firePagehide();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('/drafts/draft-a');
    expect(init.method).toBe('PATCH');
    expect(init.keepalive).toBe(true);
    expect(init.credentials).toBe('include');
  });

  it('carries bodyJson + expectedUpdatedAt in the PATCH body', () => {
    const pending: UnloadFlushArgs = {
      draftId: 'draft-a',
      bodyJson: { type: 'doc', content: [{ type: 'text', text: 'hi' }] },
      expectedUpdatedAt: '2026-07-02T00:00:00.000Z',
    };
    renderHook(() => useUnloadFlush(() => pending));

    firePagehide();

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toEqual({
      bodyJson: { type: 'doc', content: [{ type: 'text', text: 'hi' }] },
      expectedUpdatedAt: '2026-07-02T00:00:00.000Z',
    });
  });

  it('does nothing when getPending returns null', () => {
    renderHook(() => useUnloadFlush(() => null));

    firePagehide();
    setHidden();

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('skips the network flush when the body exceeds KEEPALIVE_MAX_BYTES', () => {
    const bigText = 'x'.repeat(KEEPALIVE_MAX_BYTES + 1000);
    const pending: UnloadFlushArgs = {
      draftId: 'draft-a',
      bodyJson: { type: 'doc', content: bigText },
      expectedUpdatedAt: '2026-04-24T10:00:00.000Z',
    };
    renderHook(() => useUnloadFlush(() => pending));

    firePagehide();

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('dedupes visibilitychange-hidden followed by pagehide (single fetch)', () => {
    const pending: UnloadFlushArgs = {
      draftId: 'draft-a',
      bodyJson: { type: 'doc' },
      expectedUpdatedAt: '2026-04-24T10:00:00.000Z',
    };
    renderHook(() => useUnloadFlush(() => pending));

    setHidden();
    firePagehide();

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('removes listeners on unmount', () => {
    const pending: UnloadFlushArgs = {
      draftId: 'draft-a',
      bodyJson: { type: 'doc' },
      expectedUpdatedAt: '2026-04-24T10:00:00.000Z',
    };
    const { unmount } = renderHook(() => useUnloadFlush(() => pending));
    unmount();

    firePagehide();
    setHidden();

    expect(fetchMock).not.toHaveBeenCalled();
  });
});
