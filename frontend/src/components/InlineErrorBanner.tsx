import { type JSX, useEffect, useState } from 'react';
import { isDebugMode } from '@/lib/debug';

export interface InlineErrorBannerError {
  code: string | null;
  message: string;
  detail?: unknown;
  httpStatus?: number;
}

export interface InlineErrorBannerProps {
  error: InlineErrorBannerError | null;
  onRetry?: () => void;
  onDismiss?: () => void;
}

export function InlineErrorBanner({
  error,
  onRetry,
  onDismiss,
}: InlineErrorBannerProps): JSX.Element | null {
  const [showRaw, setShowRaw] = useState(false);

  useEffect(() => {
    setShowRaw(false);
  }, [error]);

  if (error === null) return null;

  const debug = isDebugMode();
  const headline =
    error.code !== null && error.code.length > 0
      ? `${error.code} · ${error.message}`
      : error.message;

  return (
    <div
      role="alert"
      data-testid="inline-error-banner"
      className="border border-[var(--danger)] bg-[var(--bg-sunken)] text-[var(--danger)] rounded-[var(--radius)] p-3 text-[12.5px] font-sans flex flex-col gap-2"
    >
      <div className="flex items-start gap-2">
        <span className="flex-1 leading-snug">{headline}</span>
        {onRetry ? (
          <button
            type="button"
            onClick={onRetry}
            className="px-2 py-0.5 rounded-[var(--radius)] border border-[var(--danger)] hover:bg-[var(--danger)] hover:text-bg text-[12px]"
          >
            Retry
          </button>
        ) : null}
        {onDismiss ? (
          <button
            type="button"
            onClick={onDismiss}
            aria-label="Dismiss"
            className="px-2 py-0.5 rounded-[var(--radius)] hover:bg-[var(--surface-hover)] text-[12px]"
          >
            ×
          </button>
        ) : null}
      </div>
      {debug ? (
        <div>
          <button
            type="button"
            onClick={() => {
              setShowRaw((v) => !v);
            }}
            className="text-[11px] underline text-ink-3 hover:text-ink-2"
          >
            {showRaw ? 'Hide raw' : 'Show raw'}
          </button>
          {showRaw ? (
            <pre
              data-testid="inline-error-raw"
              className="mt-1 p-2 bg-bg border border-line rounded-[var(--radius)] font-mono text-[11px] text-ink-2 whitespace-pre-wrap overflow-auto max-h-[240px]"
            >
              {JSON.stringify(
                {
                  code: error.code,
                  httpStatus: error.httpStatus,
                  detail: error.detail,
                },
                null,
                2,
              )}
            </pre>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
