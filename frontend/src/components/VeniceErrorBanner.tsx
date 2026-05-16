import { type JSX, useEffect, useState } from 'react';
import { InlineErrorBanner } from '@/components/InlineErrorBanner';
import { useSettingsModalStore } from '@/store/settingsModal';

const VENICE_MESSAGE_MAX_LEN = 280;
const TOP_UP_URL = 'https://venice.ai/settings/api';

export interface VeniceErrorBannerError {
  code: string | null;
  message: string;
  retryAfterSeconds?: number | null;
  veniceMessage?: string;
  httpStatus?: number;
  detail?: unknown;
}

export interface VeniceErrorBannerProps {
  error: VeniceErrorBannerError | null;
  onRetry?: () => void;
  onDismiss?: () => void;
  disabled?: boolean;
}

function truncateVeniceMessage(raw: string): string {
  if (raw.length <= VENICE_MESSAGE_MAX_LEN) return raw;
  return `${raw.slice(0, VENICE_MESSAGE_MAX_LEN)}…`;
}

function useCountdown(seedSeconds: number | null | undefined): number | null {
  const [secondsLeft, setSecondsLeft] = useState<number | null>(
    typeof seedSeconds === 'number' ? seedSeconds : null,
  );

  useEffect(() => {
    if (typeof seedSeconds !== 'number') {
      setSecondsLeft(null);
      return;
    }
    setSecondsLeft(seedSeconds);
    if (seedSeconds <= 0) return;
    const id = setInterval(() => {
      setSecondsLeft((s) => (s !== null && s > 0 ? s - 1 : s));
    }, 1000);
    return () => clearInterval(id);
  }, [seedSeconds]);

  return secondsLeft;
}

export function VeniceErrorBanner({
  error,
  onRetry,
  onDismiss,
  disabled,
}: VeniceErrorBannerProps): JSX.Element | null {
  // Hooks must run before the null early-return; the null branch produces a no-op seed.
  const isRateLimited = error?.code === 'venice_rate_limited';
  const seed = isRateLimited ? (error?.retryAfterSeconds ?? null) : null;
  const countdown = useCountdown(seed);

  if (error === null) return null;

  const showSettingsButton =
    error.code === 'venice_key_invalid' || error.code === 'venice_key_required';
  const showTopUpLink = error.code === 'venice_insufficient_balance';
  const showCountdown = isRateLimited && countdown !== null && countdown > 0;
  const veniceMessage =
    typeof error.veniceMessage === 'string' && error.veniceMessage.length > 0
      ? error.veniceMessage
      : null;

  return (
    <div className="flex flex-col gap-1.5" data-testid="venice-error-banner">
      <InlineErrorBanner
        error={{
          code: error.code,
          message: error.message,
          httpStatus: error.httpStatus,
          detail: error.detail,
        }}
        onRetry={onRetry}
        onDismiss={onDismiss}
        disabled={disabled}
      />
      {veniceMessage ? (
        <p className="text-[11.5px] italic text-ink-3 px-1">
          Venice said: {truncateVeniceMessage(veniceMessage)}
        </p>
      ) : null}
      {showCountdown ? (
        <p className="text-[12px] text-ink-3 px-1">Try again in {countdown}s.</p>
      ) : null}
      {showSettingsButton ? (
        <div className="px-1">
          <button
            type="button"
            onClick={() => {
              useSettingsModalStore.getState().openWith('venice');
            }}
            className="text-[12px] underline text-[var(--danger)] hover:no-underline"
          >
            Open Settings
          </button>
        </div>
      ) : null}
      {showTopUpLink ? (
        <div className="px-1">
          <a
            href={TOP_UP_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="text-[12px] underline text-[var(--danger)] hover:no-underline"
          >
            Top up at venice.ai →
          </a>
        </div>
      ) : null}
    </div>
  );
}
