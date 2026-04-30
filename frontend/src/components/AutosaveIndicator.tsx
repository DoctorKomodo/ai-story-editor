import { type JSX, useEffect, useState } from 'react';
import type { AutosaveStatus } from '@/hooks/useAutosave';

/**
 * [F48] Autosave status indicator (mockup-fidelity, supersedes [F9]).
 *
 * Three states in the top bar:
 *   saving → "Saving…"
 *   saved  → "Saved · {relative}" (e.g. "Saved · 12s ago", "Saved · Just now")
 *   error  → "Save failed — retrying in Ns" (countdown to retryAt) or
 *            "Save failed — retrying" if no retryAt is set.
 *   idle   → renders nothing.
 *
 * Uses a 1s ticker so both the relative-time string and the retry countdown
 * stay fresh. The cost is trivial at this scale (one setInterval per indicator
 * mounted in the top bar).
 */

export interface AutosaveIndicatorProps {
  status: AutosaveStatus;
  savedAt: number | null;
  retryAt: number | null;
}

const TICK_MS = 1000;

function formatRelative(deltaMs: number): string {
  if (deltaMs < 5000) return 'Just now';
  const seconds = Math.floor(deltaMs / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ago`;
}

export function AutosaveIndicator({
  status,
  savedAt,
  retryAt,
}: AutosaveIndicatorProps): JSX.Element | null {
  const [now, setNow] = useState<number>(() => Date.now());

  useEffect(() => {
    if (status === 'idle') return;
    const id = setInterval(() => {
      setNow(Date.now());
    }, TICK_MS);
    return (): void => {
      clearInterval(id);
    };
  }, [status]);

  // Whenever the status (or savedAt / retryAt) changes, snap `now` so the
  // first render after a transition reflects current wall-clock time without
  // waiting up to TICK_MS.
  useEffect(() => {
    setNow(Date.now());
  }, [status, savedAt, retryAt]);

  if (status === 'idle') return null;

  let text: string;
  switch (status) {
    case 'saving':
      text = 'Saving…';
      break;
    case 'saved': {
      if (savedAt === null) {
        text = 'Saved · Just now';
      } else {
        text = `Saved · ${formatRelative(Math.max(0, now - savedAt))}`;
      }
      break;
    }
    case 'error': {
      if (retryAt !== null && retryAt > now) {
        const secondsLeft = Math.ceil((retryAt - now) / 1000);
        text = `Save failed — retrying in ${secondsLeft}s`;
      } else {
        text = 'Save failed — retrying';
      }
      break;
    }
  }

  return (
    <span
      role="status"
      data-testid="autosave-indicator"
      className="font-sans text-[12.5px] text-ink-3"
    >
      {text}
    </span>
  );
}
