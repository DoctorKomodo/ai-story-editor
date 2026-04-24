/**
 * Venice usage indicator (F16).
 *
 * Reads the `x-venice-remaining-requests` / `x-venice-remaining-tokens`
 * response headers surfaced by `useAICompletion` after every AI call and
 * renders them as a small muted status line at the bottom of the AI panel.
 *
 * Companion/follow-up tasks:
 *  - F17 adds the Venice account balance display in the user menu (different
 *    endpoint, different surface — do not fold that here).
 *  - F38 / F42 redesign the chat panel and may relocate this indicator.
 */
import type { UsageInfo } from '@/hooks/useAICompletion';

export interface UsageIndicatorProps {
  usage: UsageInfo | null;
}

export function formatRequests(n: number): string {
  if (n >= 1000) {
    return `${(n / 1000).toFixed(1)}K`;
  }
  return String(n);
}

export function formatTokens(n: number): string {
  if (n >= 1_000_000) {
    return `${(n / 1_000_000).toFixed(1)}M`;
  }
  if (n >= 1000) {
    const k = Math.round(n / 1000);
    if (k >= 1000) return `${(n / 1_000_000).toFixed(1)}M`;
    return `${k}K`;
  }
  return String(n);
}

export function UsageIndicator({ usage }: UsageIndicatorProps): JSX.Element | null {
  if (usage === null) return null;
  const { remainingRequests, remainingTokens } = usage;
  if (remainingRequests === null && remainingTokens === null) return null;

  const parts: string[] = [];
  if (remainingRequests !== null) {
    parts.push(`${formatRequests(remainingRequests)} requests`);
  }
  if (remainingTokens !== null) {
    parts.push(`${formatTokens(remainingTokens)} tokens`);
  }
  const label = `${parts.join(' / ')} remaining`;

  return (
    <div role="status" aria-label="Venice usage" className="text-xs text-neutral-500">
      {label}
    </div>
  );
}
