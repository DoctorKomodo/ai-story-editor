import type { JSX } from 'react';
import type { AutosaveStatus } from '@/hooks/useAutosave';

/**
 * [F9] Autosave status indicator.
 *
 * Strings are spec-verbatim:
 *   saving → "Saving…"
 *   saved  → "Saved ✓"
 *   error  → "Save failed — retrying"
 *   idle   → nothing
 *
 * The "retrying" string is used even though F9 only retries once before
 * giving up; the UX copy is fixed and F48 may revise the indicator later.
 */
export function AutosaveIndicator({ status }: { status: AutosaveStatus }): JSX.Element | null {
  if (status === 'idle') return null;

  let text: string;
  switch (status) {
    case 'saving':
      text = 'Saving…';
      break;
    case 'saved':
      text = 'Saved ✓';
      break;
    case 'error':
      text = 'Save failed — retrying';
      break;
  }

  return (
    <span role="status" className="text-sm text-neutral-500">
      {text}
    </span>
  );
}
