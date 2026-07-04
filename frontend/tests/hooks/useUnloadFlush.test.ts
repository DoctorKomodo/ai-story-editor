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
      storyId: 's1',
      chapterId: 'c1',
      bodyJson: { type: 'doc' },
    };
    renderHook(() => useUnloadFlush(() => pending));

    firePagehide();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('/stories/s1/chapters/c1');
    expect(init.method).toBe('PATCH');
    expect(init.keepalive).toBe(true);
    expect(init.credentials).toBe('include');
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
      storyId: 's1',
      chapterId: 'c1',
      bodyJson: { type: 'doc', content: bigText },
    };
    renderHook(() => useUnloadFlush(() => pending));

    firePagehide();

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('dedupes visibilitychange-hidden followed by pagehide (single fetch)', () => {
    const pending: UnloadFlushArgs = {
      storyId: 's1',
      chapterId: 'c1',
      bodyJson: { type: 'doc' },
    };
    renderHook(() => useUnloadFlush(() => pending));

    setHidden();
    firePagehide();

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('removes listeners on unmount', () => {
    const pending: UnloadFlushArgs = {
      storyId: 's1',
      chapterId: 'c1',
      bodyJson: { type: 'doc' },
    };
    const { unmount } = renderHook(() => useUnloadFlush(() => pending));
    unmount();

    firePagehide();
    setHidden();

    expect(fetchMock).not.toHaveBeenCalled();
  });
});
