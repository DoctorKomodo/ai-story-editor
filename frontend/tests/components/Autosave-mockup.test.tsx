import { act, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AutosaveIndicator } from '@/components/AutosaveIndicator';
import { useAutosave } from '@/hooks/useAutosave';

/**
 * [F48] Mockup-fidelity autosave indicator tests.
 *
 * Three states in the top bar indicator:
 *   "Saving…"
 *   "Saved · Ns ago" (relative time, refreshes as time passes)
 *   "Save failed — retrying in Ns" (countdown to next retry)
 */

const DEBOUNCE_MS = 4000;

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('AutosaveIndicator (F48)', () => {
  it('renders nothing when idle', () => {
    const { container } = render(<AutosaveIndicator status="idle" savedAt={null} retryAt={null} />);
    expect(container.firstChild).toBeNull();
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('renders "Saving…" while saving', () => {
    render(<AutosaveIndicator status="saving" savedAt={null} retryAt={null} />);
    expect(screen.getByRole('status')).toHaveTextContent('Saving…');
  });

  it('renders with the design-system token classes (no raw Tailwind colors)', () => {
    render(<AutosaveIndicator status="saving" savedAt={null} retryAt={null} />);
    const node = screen.getByTestId('autosave-indicator');
    expect(node).toHaveClass('text-ink-3');
    expect(node).toHaveClass('font-sans');
    expect(node.className).not.toMatch(/\b(neutral|red|blue|gray|slate)-\d/);
  });

  it('renders "Saved · Just now" within the first 5s', () => {
    const now = Date.now();
    vi.setSystemTime(now);
    render(<AutosaveIndicator status="saved" savedAt={now - 2000} retryAt={null} />);
    expect(screen.getByRole('status')).toHaveTextContent('Saved · Just now');
  });

  it('renders "Saved · 12s ago" for a 12s-old save', () => {
    const now = Date.now();
    vi.setSystemTime(now);
    render(<AutosaveIndicator status="saved" savedAt={now - 12_000} retryAt={null} />);
    expect(screen.getByRole('status')).toHaveTextContent('Saved · 12s ago');
  });

  it('renders "Saved · 2m ago" once the save is over a minute old', () => {
    const now = Date.now();
    vi.setSystemTime(now);
    render(<AutosaveIndicator status="saved" savedAt={now - 125_000} retryAt={null} />);
    expect(screen.getByRole('status')).toHaveTextContent('Saved · 2m ago');
  });

  it('refreshes the relative-time string as wall-clock time advances', async () => {
    const start = Date.now();
    vi.setSystemTime(start);
    render(<AutosaveIndicator status="saved" savedAt={start} retryAt={null} />);

    expect(screen.getByRole('status')).toHaveTextContent('Saved · Just now');

    await act(async () => {
      await vi.advanceTimersByTimeAsync(7000);
    });

    expect(screen.getByRole('status')).toHaveTextContent('Saved · 7s ago');
  });

  it('renders the retry countdown when error has a future retryAt', () => {
    const now = Date.now();
    vi.setSystemTime(now);
    render(<AutosaveIndicator status="error" savedAt={null} retryAt={now + 8000} />);
    expect(screen.getByRole('status')).toHaveTextContent('Save failed — retrying in 8s');
  });

  it('renders "Save failed — retrying" when no retryAt is set', () => {
    render(<AutosaveIndicator status="error" savedAt={null} retryAt={null} />);
    expect(screen.getByRole('status')).toHaveTextContent('Save failed — retrying');
    expect(screen.getByRole('status')).not.toHaveTextContent('retrying in');
  });

  it('counts the retry timer down as time passes', async () => {
    const start = Date.now();
    vi.setSystemTime(start);
    render(<AutosaveIndicator status="error" savedAt={null} retryAt={start + 8000} />);

    expect(screen.getByRole('status')).toHaveTextContent('Save failed — retrying in 8s');

    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });

    expect(screen.getByRole('status')).toHaveTextContent('Save failed — retrying in 5s');
  });

  it('falls back to "Save failed — retrying" once retryAt is in the past', async () => {
    const start = Date.now();
    vi.setSystemTime(start);
    render(<AutosaveIndicator status="error" savedAt={null} retryAt={start + 2000} />);

    expect(screen.getByRole('status')).toHaveTextContent('Save failed — retrying in 2s');

    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });

    expect(screen.getByRole('status')).toHaveTextContent('Save failed — retrying');
    expect(screen.getByRole('status')).not.toHaveTextContent('retrying in');
  });
});

interface HookHarnessProps {
  save: (payload: string) => Promise<void>;
}

interface ReportedState {
  status: ReturnType<typeof useAutosave<string>>['status'];
  savedAt: number | null;
  retryAt: number | null;
}

function HookHarness({
  save,
  onState,
}: HookHarnessProps & { onState: (s: ReportedState) => void }): JSX.Element {
  const [payload, setPayload] = useState<string | null>('baseline');
  const { status, savedAt, retryAt } = useAutosave({
    payload,
    save,
    debounceMs: DEBOUNCE_MS,
  });
  onState({ status, savedAt, retryAt });
  return (
    <button type="button" onClick={() => setPayload('edited')}>
      Edit
    </button>
  );
}

describe('useAutosave timestamp fields (F48 hook extension)', () => {
  it('sets savedAt close to Date.now() after a successful save', async () => {
    const states: ReportedState[] = [];
    const save = vi.fn<(p: string) => Promise<void>>().mockResolvedValue(undefined);
    const start = Date.now();
    vi.setSystemTime(start);

    render(
      <HookHarness
        save={save}
        onState={(s) => {
          states.push(s);
        }}
      />,
    );

    // Initial state: no save yet.
    expect(states.at(-1)?.savedAt).toBeNull();

    act(() => {
      screen.getByRole('button', { name: 'Edit' }).click();
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);
    });
    // Drain any pending microtasks/state updates from the resolved promise.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(save).toHaveBeenCalledTimes(1);
    const last = states.at(-1);
    expect(last?.status).toBe('saved');
    expect(last?.savedAt).not.toBeNull();
    // Save fired at start + DEBOUNCE_MS.
    expect(last?.savedAt).toBe(start + DEBOUNCE_MS);
    expect(last?.retryAt).toBeNull();
  });

  it('sets retryAt to ~debounceMs * 2 in the future after a failed save', async () => {
    const states: ReportedState[] = [];
    const save = vi
      .fn<(p: string) => Promise<void>>()
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValue(undefined);
    const start = Date.now();
    vi.setSystemTime(start);

    render(
      <HookHarness
        save={save}
        onState={(s) => {
          states.push(s);
        }}
      />,
    );

    act(() => {
      screen.getByRole('button', { name: 'Edit' }).click();
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    const errored = states.at(-1);
    expect(errored?.status).toBe('error');
    // The save attempt happened at start + DEBOUNCE_MS; retry is scheduled for
    // 2 * DEBOUNCE_MS after that.
    expect(errored?.retryAt).toBe(start + DEBOUNCE_MS + DEBOUNCE_MS * 2);
  });
});
