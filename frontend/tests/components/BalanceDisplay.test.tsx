import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import {
  BalanceDisplay,
  formatUsd,
  formatDiem,
} from '@/components/BalanceDisplay';

describe('F17 · BalanceDisplay component', () => {
  it('renders role="status" with "Loading balance…" when isLoading', () => {
    render(<BalanceDisplay balance={null} isLoading />);
    const status = screen.getByRole('status');
    expect(status.textContent ?? '').toMatch(/loading balance/i);
  });

  it('renders venice_key_required copy when errorCode is venice_key_required', () => {
    render(
      <BalanceDisplay
        balance={null}
        isError
        errorCode="venice_key_required"
      />,
    );
    const alert = screen.getByRole('alert');
    expect(alert.textContent ?? '').toMatch(/add a venice api key in settings/i);
  });

  it('renders generic error copy on other errors', () => {
    render(<BalanceDisplay balance={null} isError errorCode="some_other_error" />);
    const alert = screen.getByRole('alert');
    expect(alert.textContent ?? '').toMatch(/balance unavailable/i);
  });

  it('renders formatted USD and Diem when balance is fully populated', () => {
    render(<BalanceDisplay balance={{ credits: 2415.3, diem: 482193 }} />);
    expect(screen.getByText('USD: $2,415.30')).toBeInTheDocument();
    expect(screen.getByText('Diem: 482,193')).toBeInTheDocument();
  });

  it('renders "USD: —" when credits is null but diem is present', () => {
    render(<BalanceDisplay balance={{ credits: null, diem: 482193 }} />);
    expect(screen.getByText('USD: —')).toBeInTheDocument();
    expect(screen.getByText('Diem: 482,193')).toBeInTheDocument();
  });

  it('renders zero values distinctly from null', () => {
    render(<BalanceDisplay balance={{ credits: 0, diem: 0 }} />);
    expect(screen.getByText('USD: $0.00')).toBeInTheDocument();
    expect(screen.getByText('Diem: 0')).toBeInTheDocument();
  });

  it('renders "Balance unavailable" when balance is null and not loading/error', () => {
    render(<BalanceDisplay balance={null} />);
    expect(screen.getByText(/balance unavailable/i)).toBeInTheDocument();
  });

  it('treats undefined fields like null (never throws on partial responses)', () => {
    // A backend response missing a field entirely (e.g. `{ credits: 2.5 }`
    // with no `diem` key) arrives as undefined, not null. The guard must
    // coerce both to the em-dash placeholder.
    const partial = { credits: 2.5 } as unknown as { credits: number | null; diem: number | null };
    render(<BalanceDisplay balance={partial} />);
    expect(screen.getByText('USD: $2.50')).toBeInTheDocument();
    expect(screen.getByText('Diem: —')).toBeInTheDocument();
  });
});

describe('F17 · formatters', () => {
  it('formatUsd formats as USD currency with 2 decimals', () => {
    expect(formatUsd(2415.3)).toBe('$2,415.30');
  });

  it('formatUsd formats zero as "$0.00"', () => {
    expect(formatUsd(0)).toBe('$0.00');
  });

  it('formatDiem formats integer with commas', () => {
    expect(formatDiem(482193)).toBe('482,193');
  });
});
