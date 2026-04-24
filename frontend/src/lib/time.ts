/**
 * Human-readable "N unit ago" string. Kept stupid-simple: no Intl.RelativeTimeFormat,
 * no dependencies. Tests inject a fixed `now` for determinism.
 */
export function formatRelative(date: Date | string, now: Date = new Date()): string {
  const then = typeof date === 'string' ? new Date(date) : date;
  const diffMs = now.getTime() - then.getTime();
  const absSec = Math.max(0, Math.floor(diffMs / 1000));

  if (absSec < 60) return 'just now';

  const minutes = Math.floor(absSec / 60);
  if (minutes < 60) return `${String(minutes)}m ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${String(hours)}h ago`;

  const days = Math.floor(hours / 24);
  if (days < 30) return `${String(days)}d ago`;

  const months = Math.floor(days / 30);
  if (months < 12) return `${String(months)}mo ago`;

  const years = Math.floor(days / 365);
  return `${String(years)}y ago`;
}
