import { act, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AutosaveIndicator } from '@/components/AutosaveIndicator';
import { useAutosave } from '@/hooks/useAutosave';

/**
 * [F9] Autosave primitive tests.
 *
 * Debounce is 4s (F48 supersedes F9's 2s — the F48 text itself says
 * "when implementing F9, use 4s"). Retry is 2 * debounceMs = 8s.
 */

const DEBOUNCE_MS = 4000;

interface HarnessProps {
  save: (payload: string) => Promise<void>;
  initial?: string | null;
}

function Harness({ save, initial = 'baseline' }: HarnessProps): JSX.Element {
  const [payload, setPayload] = useState<string | null>(initial);
  const { status, savedAt, retryAt } = useAutosave({ payload, save, debounceMs: DEBOUNCE_MS });
  return (
    <>
      <AutosaveIndicator status={status} savedAt={savedAt} retryAt={retryAt} />
      <button type="button" onClick={() => setPayload(`edit-${Math.random()}`)}>
        Edit
      </button>
      <button type="button" onClick={() => setPayload('fixed-A')}>
        EditA
      </button>
      <button type="button" onClick={() => setPayload('fixed-B')}>
        EditB
      </button>
      <button type="button" onClick={() => setPayload('fixed-C')}>
        EditC
      </button>
    </>
  );
}

async function advance(ms: number): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

function clickButton(name: string): void {
  act(() => {
    screen.getByRole('button', { name }).click();
  });
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('useAutosave + AutosaveIndicator (F9)', () => {
  it('does not fire save for the initial baseline payload', async () => {
    const save = vi.fn<(p: string) => Promise<void>>().mockResolvedValue(undefined);
    render(<Harness save={save} />);

    // Status starts idle (indicator renders nothing).
    expect(screen.queryByRole('status')).toBeNull();

    await advance(DEBOUNCE_MS + 100);

    expect(save).not.toHaveBeenCalled();
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('debounces payload changes and fires save once after debounceMs', async () => {
    const save = vi.fn<(p: string) => Promise<void>>().mockResolvedValue(undefined);
    render(<Harness save={save} />);

    clickButton('EditA');

    // Before the window elapses, nothing has happened.
    await advance(DEBOUNCE_MS - 100);
    expect(save).not.toHaveBeenCalled();

    // After the window: saving → saved, and save got fixed-A.
    await advance(200);
    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith('fixed-A');

    // Drain pending microtasks/state updates from the resolved promise.
    await advance(0);
    expect(screen.getByRole('status')).toHaveTextContent(/^Saved · /);
  });

  it('resets the debounce timer on rapid successive changes', async () => {
    const save = vi.fn<(p: string) => Promise<void>>().mockResolvedValue(undefined);
    render(<Harness save={save} />);

    clickButton('EditA');
    await advance(DEBOUNCE_MS / 2);
    clickButton('EditB');
    await advance(DEBOUNCE_MS / 2);
    // Timer was reset by the second click; total quiet time is only
    // DEBOUNCE_MS / 2 since the last edit — save should not have fired.
    expect(save).not.toHaveBeenCalled();

    await advance(DEBOUNCE_MS / 2 + 100);
    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith('fixed-B');
  });

  it('shows "Saving…" then "Saved ✓" on the happy path', async () => {
    // Use a deferred promise so we can observe the "saving" state.
    let resolveSave: (() => void) | null = null;
    const save = vi.fn<(p: string) => Promise<void>>().mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveSave = () => resolve();
        }),
    );
    render(<Harness save={save} />);

    clickButton('EditA');
    await advance(DEBOUNCE_MS);

    expect(save).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('status')).toHaveTextContent('Saving…');

    await act(async () => {
      resolveSave!();
    });

    expect(screen.getByRole('status')).toHaveTextContent(/^Saved · /);
  });

  it('enters error state on a failed save and retries after 2x debounceMs', async () => {
    const save = vi
      .fn<(p: string) => Promise<void>>()
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce(undefined);
    render(<Harness save={save} />);

    clickButton('EditA');
    await advance(DEBOUNCE_MS);

    // Let the rejection settle.
    await advance(0);
    expect(save).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('status')).toHaveTextContent(/^Save failed — retrying/);

    // Retry fires after 2 * DEBOUNCE_MS.
    await advance(DEBOUNCE_MS * 2);
    expect(save).toHaveBeenCalledTimes(2);

    await advance(0);
    expect(screen.getByRole('status')).toHaveTextContent(/^Saved · /);
  });

  it('does not call save or touch state after unmount', async () => {
    const save = vi.fn<(p: string) => Promise<void>>().mockResolvedValue(undefined);
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { unmount } = render(<Harness save={save} />);

    clickButton('EditA');
    // Midway through the debounce window, unmount.
    await advance(DEBOUNCE_MS / 2);
    unmount();

    // Let plenty of time elapse after unmount.
    await advance(DEBOUNCE_MS * 3);

    expect(save).not.toHaveBeenCalled();
    // No "can't perform state update on unmounted component" warnings.
    expect(errSpy).not.toHaveBeenCalled();
    errSpy.mockRestore();
  });

  it('queues a follow-up save when payload changes during an in-flight save', async () => {
    // First save is slow (we control resolution); second save is fast.
    let resolveFirst: (() => void) | null = null;
    const save = vi
      .fn<(p: string) => Promise<void>>()
      .mockImplementationOnce(
        () =>
          new Promise<void>((resolve) => {
            resolveFirst = () => resolve();
          }),
      )
      .mockResolvedValue(undefined);

    render(<Harness save={save} />);

    clickButton('EditA');
    await advance(DEBOUNCE_MS);
    // First save is now in flight with 'fixed-A'.
    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenNthCalledWith(1, 'fixed-A');
    expect(screen.getByRole('status')).toHaveTextContent('Saving…');

    // Edit while the first save is still pending.
    clickButton('EditB');

    // Resolve the in-flight save.
    await act(async () => {
      resolveFirst!();
    });

    // After the in-flight save resolves, the follow-up debounces again.
    // Before the new debounce elapses, save count is still 1.
    expect(save).toHaveBeenCalledTimes(1);
    await advance(DEBOUNCE_MS - 100);
    expect(save).toHaveBeenCalledTimes(1);

    await advance(200);
    expect(save).toHaveBeenCalledTimes(2);
    expect(save).toHaveBeenNthCalledWith(2, 'fixed-B');
  });

  it('flushes a pending debounce against the previous save fn when resetKey changes', async () => {
    // Regression: switching chapters inside the 4s debounce window used to
    // drop the typed-but-unsaved edit. The hook now flushes the pending
    // debounce against the *snapshotted* save fn (closed over the previous
    // chapter id) before resetting baseline state. The flush happens
    // synchronously from the resetKey effect — no fake-timer advance needed.
    const saveA = vi.fn<(p: string) => Promise<void>>().mockResolvedValue(undefined);
    const saveB = vi.fn<(p: string) => Promise<void>>().mockResolvedValue(undefined);

    function FlushHarness(): JSX.Element {
      const [key, setKey] = useState<string>('A');
      const [payload, setPayload] = useState<string | null>('baseline-A');
      const save = key === 'A' ? saveA : saveB;
      useAutosave({ payload, save, debounceMs: DEBOUNCE_MS, resetKey: key });
      return (
        <>
          <button type="button" onClick={() => setPayload('typed-in-A')}>
            TypeInA
          </button>
          <button
            type="button"
            onClick={() => {
              setKey('B');
              setPayload('baseline-B');
            }}
          >
            SwitchToB
          </button>
        </>
      );
    }

    render(<FlushHarness />);

    // Type into chapter A — schedules a debounce.
    clickButton('TypeInA');
    await advance(100);
    expect(saveA).not.toHaveBeenCalled();

    // Switch chapters before the 4s debounce fires. The flush should land
    // the typed-but-unsaved payload against the OLD save fn.
    clickButton('SwitchToB');
    // Allow the fire-and-forget promise to settle.
    await advance(0);

    expect(saveA).toHaveBeenCalledTimes(1);
    expect(saveA).toHaveBeenCalledWith('typed-in-A');
    expect(saveB).not.toHaveBeenCalled();

    // Advancing past the original debounce window must NOT fire saveA again
    // (the timer was cleared) and must NOT misroute the flushed payload to
    // saveB as a baseline-mismatch.
    await advance(DEBOUNCE_MS + 200);
    expect(saveA).toHaveBeenCalledTimes(1);
    expect(saveB).not.toHaveBeenCalled();
  });

  it('does not misroute a follow-up to the new save fn when chapter switches mid-flight', async () => {
    // Pins the cross-chapter safety contract: if a save is in flight for
    // chapter A and the user types again (pendingFollowupRef=true) and then
    // switches chapters before the in-flight save resolves, the follow-up
    // must NOT call the new chapter's save fn under any circumstances.
    //
    // Current behaviour: the resetKey effect resets pendingFollowupRef to
    // false, so the follow-up is dropped — the second batch of typing is
    // lost (acceptable: a chapter switch is an explicit "I'm done here"
    // signal). Defense-in-depth: even if the reset were removed, the
    // follow-up branch passes the snapshotted saveFn to scheduleDebouncedSave
    // so the PATCH would still land on chapter A, never chapter B.
    let resolveFirstSave!: () => void;
    const saveA = vi.fn<(p: string) => Promise<void>>().mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveFirstSave = resolve;
        }),
    );
    const saveB = vi.fn<(p: string) => Promise<void>>().mockResolvedValue(undefined);

    function FollowUpHarness(): JSX.Element {
      const [key, setKey] = useState<string>('A');
      const [payload, setPayload] = useState<string | null>('baseline-A');
      const save = key === 'A' ? saveA : saveB;
      useAutosave({ payload, save, debounceMs: DEBOUNCE_MS, resetKey: key });
      return (
        <>
          <button type="button" onClick={() => setPayload('typed-A1')}>
            TypeA1
          </button>
          <button type="button" onClick={() => setPayload('typed-A2')}>
            TypeA2
          </button>
          <button
            type="button"
            onClick={() => {
              setKey('B');
              setPayload('baseline-B');
            }}
          >
            SwitchToB
          </button>
        </>
      );
    }

    render(<FollowUpHarness />);

    clickButton('TypeA1');
    await advance(DEBOUNCE_MS + 100);
    expect(saveA).toHaveBeenCalledTimes(1);
    expect(saveA).toHaveBeenLastCalledWith('typed-A1');

    // Edit again while saveA is in flight → pendingFollowupRef = true.
    clickButton('TypeA2');
    await advance(50);

    // Switch chapters before the in-flight saveA resolves.
    clickButton('SwitchToB');
    await advance(0);

    // Resolve saveA. Whatever the follow-up branch decides, saveB must
    // remain untouched — the typed payload belongs to chapter A.
    resolveFirstSave();
    await advance(DEBOUNCE_MS + 200);

    expect(saveB).not.toHaveBeenCalled();
    // saveA may or may not be called a second time depending on the
    // follow-up policy — both are acceptable. The hard invariant is "no
    // cross-chapter PATCH". If saveA *is* called twice, it must carry
    // chapter A's typed payload, never chapter B's baseline.
    if (saveA.mock.calls.length > 1) {
      expect(saveA.mock.calls[1]?.[0]).toBe('typed-A2');
    }
  });
});
