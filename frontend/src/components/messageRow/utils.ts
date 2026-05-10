/**
 * Coerce a ChatMessage's `contentJson` (typed as unknown at the API surface)
 * to a renderable string. Strings pass through; objects (TipTap JSON, etc.)
 * are JSON.stringify'd defensively. null/undefined/JSON failure → ''.
 */
export function getMessageText(contentJson: unknown): string {
  if (typeof contentJson === 'string') return contentJson;
  if (contentJson === null || contentJson === undefined) return '';
  try {
    return JSON.stringify(contentJson);
  } catch {
    return '';
  }
}
