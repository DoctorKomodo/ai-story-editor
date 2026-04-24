// [V26] Projection helper for Venice `venice_search_results` chunks.
//
// When the chat POST opts in with `enableWebSearch: true`, Venice prepends a
// non-standard first chunk carrying `venice_search_results` — an array of
// { title, url, content, date } objects. We project that raw shape to our
// internal `Citation` shape (rename `content → snippet`, `date → publishedAt`)
// before emitting on SSE and persisting on the assistant message.
//
// The projector is intentionally defensive: Venice field names may drift, and
// some items may be partial. Items missing `title` or `url` are dropped
// silently (input-adjacent data; we never log narrative-adjacent strings).
// Output is capped at 10 items; extras are discarded silently.
//
// Null-vs-empty semantics: this function returns `Citation[]` (possibly
// empty). The caller decides how to translate an empty result → persistence.
// Per the V26 spec §6, an empty array must NOT be stored — the caller should
// persist `null` instead. See `backend/src/routes/chat.routes.ts`.

export interface Citation {
  title: string;
  url: string;
  snippet: string;
  publishedAt: string | null;
}

const MAX_CITATIONS = 10;

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

export function projectVeniceCitations(raw: unknown): Citation[] {
  if (!Array.isArray(raw)) return [];

  const out: Citation[] = [];
  for (const item of raw) {
    if (out.length >= MAX_CITATIONS) break;
    if (!isRecord(item)) continue;

    const title = item.title;
    const url = item.url;
    if (typeof title !== 'string' || title.length === 0) continue;
    if (typeof url !== 'string' || url.length === 0) continue;

    const rawSnippet = item.content;
    const snippet = typeof rawSnippet === 'string' ? rawSnippet : '';

    const rawDate = item.date;
    const publishedAt = typeof rawDate === 'string' && rawDate.length > 0 ? rawDate : null;

    out.push({ title, url, snippet, publishedAt });
  }
  return out;
}
