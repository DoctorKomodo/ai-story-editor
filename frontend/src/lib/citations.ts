/**
 * Shared Citation type and runtime guard.
 *
 * Extracted here so `@/lib/sse` can import it without creating a circular
 * dependency through `@/hooks/useChat`. All SSE-related consumers import
 * from this file; `useChat.ts` re-exports the type for backward compat.
 */

/**
 * [V26][F50] Web-search citation shape returned by the backend on any
 * assistant message that opted into `enableWebSearch`. `null` means the
 * turn did not request search; an empty array is never stored (treated
 * the same as `null` by `<MessageCitations />`).
 */
export interface Citation {
  title: string;
  url: string;
  snippet: string;
  publishedAt: string | null;
}

/**
 * [V26][F50] Defensive runtime guard for citation arrays. Used by the SSE
 * `event: citations` parser so a malformed frame from the wire (or a
 * future schema drift) cannot crash the renderer — we either accept a
 * well-formed array or treat the frame as missing.
 */
export function isCitationArray(value: unknown): value is Citation[] {
  if (!Array.isArray(value)) return false;
  return value.every((item): item is Citation => {
    if (item === null || typeof item !== 'object') return false;
    const c = item as Record<string, unknown>;
    return (
      typeof c.title === 'string' &&
      typeof c.url === 'string' &&
      typeof c.snippet === 'string' &&
      (c.publishedAt === null || typeof c.publishedAt === 'string')
    );
  });
}
