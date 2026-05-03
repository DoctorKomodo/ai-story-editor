import { type JSX, useState } from 'react';
import { isDebugMode } from '@/lib/debug';
import { type AppError, useErrorStore } from '@/store/errors';

/**
 * Root-mounted error stack.
 *
 * Debug mode (`isDebugMode() === true`):
 *   - Bottom-right collapsible stack of all current errors.
 *   - Each row shows source · code · message + a Dismiss control.
 *   - "Show raw" reveals the JSON detail / httpStatus.
 *   - "Clear all" empties the store.
 *
 * Prod mode:
 *   - Renders only the latest severity:'error' as a small dismissable strip.
 *   - No raw detail.
 */

function severityBadge(severity: AppError['severity']): { label: string; cls: string } {
  switch (severity) {
    case 'error':
      return { label: 'ERR', cls: 'text-[var(--danger)] border-[var(--danger)]' };
    case 'warn':
      return { label: 'WRN', cls: 'text-amber-500 border-amber-500' }; // lint:design-allow — severity indicator, no token equivalent
    default:
      return { label: 'INF', cls: 'text-ink-3 border-line' };
  }
}

interface RowProps {
  entry: AppError;
  debug: boolean;
  onDismiss: (id: string) => void;
}

function Row({ entry, debug, onDismiss }: RowProps): JSX.Element {
  const [showRaw, setShowRaw] = useState(false);
  const badge = severityBadge(entry.severity);
  const headline =
    entry.code !== null && entry.code.length > 0
      ? `${entry.code} · ${entry.message}`
      : entry.message;
  return (
    <div
      data-testid="dev-error-row"
      className="border border-line bg-bg rounded-[var(--radius)] p-2.5 text-[12px] font-sans flex flex-col gap-1.5 shadow"
    >
      <div className="flex items-start gap-2">
        <span className={`px-1 py-0 rounded text-[10px] font-mono uppercase border ${badge.cls}`}>
          {badge.label}
        </span>
        <span className="text-ink-4 text-[11px] font-mono">{entry.source}</span>
        {entry.httpStatus !== undefined ? (
          <span className="text-ink-4 text-[11px] font-mono">{entry.httpStatus}</span>
        ) : null}
        <span className="flex-1 leading-snug text-ink">{headline}</span>
        <button
          type="button"
          aria-label="Dismiss"
          data-testid={`dismiss-${entry.id}`}
          onClick={() => {
            onDismiss(entry.id);
          }}
          className="px-1.5 py-0 rounded-[var(--radius)] hover:bg-[var(--surface-hover)] text-ink-3"
        >
          ×
        </button>
      </div>
      {debug && entry.detail !== undefined ? (
        <div>
          <button
            type="button"
            className="text-[11px] underline text-ink-3 hover:text-ink-2"
            onClick={() => {
              setShowRaw((v) => !v);
            }}
          >
            {showRaw ? 'Hide raw' : 'Show raw'}
          </button>
          {showRaw ? (
            <pre className="mt-1 p-2 bg-[var(--bg-sunken)] border border-line rounded-[var(--radius)] font-mono text-[11px] text-ink-2 whitespace-pre-wrap overflow-auto max-h-[240px]">
              {JSON.stringify(entry.detail, null, 2)}
            </pre>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export function DevErrorOverlay(): JSX.Element | null {
  const errors = useErrorStore((s) => s.errors);
  const dismiss = useErrorStore((s) => s.dismiss);
  const clear = useErrorStore((s) => s.clear);
  const [collapsed, setCollapsed] = useState(false);
  const debug = isDebugMode();

  if (errors.length === 0) return null;

  const visible: AppError[] = debug
    ? errors
    : (() => {
        const latestError = errors.find((e) => e.severity === 'error');
        return latestError ? [latestError] : [];
      })();

  if (visible.length === 0) return null;

  return (
    <aside
      aria-label="Error overlay"
      className="fixed bottom-3 right-3 z-50 w-[380px] max-w-[calc(100vw-1.5rem)] flex flex-col gap-2"
    >
      {debug ? (
        <div className="flex items-center justify-between gap-2 text-[11px] font-mono text-ink-3">
          <span>{`${String(visible.length)} error${visible.length === 1 ? '' : 's'}`}</span>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => {
                setCollapsed((v) => !v);
              }}
              className="px-1.5 py-0.5 rounded-[var(--radius)] hover:bg-[var(--surface-hover)]"
            >
              {collapsed ? 'Expand' : 'Collapse'}
            </button>
            <button
              type="button"
              onClick={clear}
              className="px-1.5 py-0.5 rounded-[var(--radius)] hover:bg-[var(--surface-hover)]"
            >
              Clear all
            </button>
          </div>
        </div>
      ) : null}
      {!collapsed
        ? visible.map((e) => <Row key={e.id} entry={e} debug={debug} onDismiss={dismiss} />)
        : null}
    </aside>
  );
}
