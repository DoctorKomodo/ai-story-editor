import type { JSX } from 'react';
/**
 * [F17] Venice account balance display.
 *
 * Pure presentation — consumes the output of `useVeniceAccountQuery` (see
 * `useVeniceAccount.ts`) and renders one of four states: loading, error
 * (with a dedicated copy for `venice_key_required`), loaded-but-empty,
 * or the two-line USD / Diem readout.
 *
 * F26 will restyle the surrounding user menu; this component's copy and
 * data shape are intentionally stable so F26 is layout-only.
 */

import type { VeniceAccount } from '@/hooks/useVeniceAccount';

export interface BalanceDisplayProps {
  balance: VeniceAccount | null;
  isLoading?: boolean;
  isError?: boolean;
  errorCode?: string | null;
}

export function formatUsd(n: number): string {
  return n.toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export function formatDiem(n: number): string {
  return n.toLocaleString('en-US', { maximumFractionDigits: 0 });
}

export function BalanceDisplay({
  balance,
  isLoading = false,
  isError = false,
  errorCode = null,
}: BalanceDisplayProps): JSX.Element {
  if (isLoading) {
    return (
      <p role="status" data-testid="balance-loading" className="font-mono text-[11px] text-ink-3">
        Loading balance…
      </p>
    );
  }

  if (isError) {
    if (errorCode === 'venice_key_required') {
      return (
        <p role="alert" data-testid="balance-error" className="font-mono text-[11px] text-ink-3">
          Add a Venice API key in Settings.
        </p>
      );
    }
    return (
      <p role="alert" data-testid="balance-error" className="font-mono text-[11px] text-ink-3">
        Balance unavailable
      </p>
    );
  }

  if (balance === null) {
    return (
      <p data-testid="balance-empty" className="font-mono text-[11px] text-ink-3">
        Balance unavailable
      </p>
    );
  }

  const usd = balance.balanceUsd == null ? 'USD: —' : `USD: ${formatUsd(balance.balanceUsd)}`;
  const diem = balance.diem == null ? 'Diem: —' : `Diem: ${formatDiem(balance.diem)}`;

  return (
    <div data-testid="balance-display" className="font-mono text-[11px] text-ink-2 space-y-0.5">
      <p>{usd}</p>
      <p>{diem}</p>
    </div>
  );
}
