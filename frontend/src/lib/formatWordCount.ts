/**
 * Compact word-count format used in the chapter row's right-side slot.
 *
 *   0          → '—'
 *   negative   → '—'  (defensive — should never happen)
 *   1..999     → raw integer as a string
 *   >=1000     → one-decimal `k` (e.g. 2100 → '2.1k', 2150 → '2.2k')
 */
export function formatWordCountCompact(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '—';
  if (n < 1000) return String(Math.trunc(n));
  // Round to one decimal place, rounding 0.5 up
  const k = n / 1000;
  const rounded = Math.round(k * 10) / 10;
  return `${rounded.toFixed(1)}k`;
}
