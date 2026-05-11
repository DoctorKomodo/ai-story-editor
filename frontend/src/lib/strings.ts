/**
 * Truncate `text` at the last word boundary <= `max` characters.
 * Falls back to a hard slice if the text has no whitespace within the bound.
 * Used by SceneTab and ChatTab to auto-name a session from the first user message.
 */
export function truncateAtWordBoundary(text: string, max: number): string {
  if (text.length <= max) return text.replace(/\s+/g, ' ').trim();
  const slice = text.slice(0, max);
  const lastSpace = slice.lastIndexOf(' ');
  const cut = lastSpace > 20 ? slice.slice(0, lastSpace) : slice;
  return `${cut.trim().replace(/[.,;:!?]+$/, '')}…`;
}
