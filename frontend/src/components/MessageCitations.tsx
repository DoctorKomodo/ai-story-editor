import type { JSX } from 'react';
import type { Citation } from '@/hooks/useChat';

/**
 * [F50] Inline disclosure under each assistant message that opted into
 * web search. Renders a `Sources (N)` pill that expands to a card listing
 * each citation's title (linked, opens in a new tab), plain-text snippet,
 * and optional `publishedAt`.
 *
 * Rules:
 * - When `citations === null` OR `citations.length === 0`, render nothing.
 *   ([V26] never stores an empty array; null === no search this turn.)
 * - Snippets are third-party web content. They MUST be rendered as plain
 *   text — never via `dangerouslySetInnerHTML`. React's text-child
 *   interpolation is automatically safe; this comment is the contract.
 * - Links carry both `target="_blank"` and `rel="noopener noreferrer"`.
 */

export interface MessageCitationsProps {
  citations: Citation[] | null;
}

function formatPublishedAt(iso: string): string {
  // Defensive: if the upstream gives us a non-ISO string we still show it
  // verbatim rather than throwing.
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toISOString().slice(0, 10);
}

export function MessageCitations({ citations }: MessageCitationsProps): JSX.Element | null {
  if (citations === null || citations.length === 0) return null;

  const count = citations.length;

  return (
    <details className="message-citations mt-2" data-testid="message-citations">
      <summary className="cursor-pointer inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-[var(--accent-soft)] text-ink text-[11px] font-mono">
        {`Sources (${String(count)})`}
      </summary>
      <ul
        className="mt-2 flex flex-col gap-2 p-2 border border-line rounded-[var(--radius)] bg-bg-elevated list-none"
        data-testid="message-citations-list"
      >
        {citations.map((c, i) => (
          <li
            key={`${c.url}-${String(i)}`}
            className="flex flex-col gap-0.5"
            data-testid="message-citation-item"
          >
            <a
              href={c.url}
              target="_blank"
              rel="noopener noreferrer"
              className="font-sans text-[13px] text-ink hover:underline"
            >
              {c.title}
            </a>
            <p className="font-sans text-[12px] text-ink-3" data-testid="message-citation-snippet">
              {c.snippet}
            </p>
            {c.publishedAt !== null ? (
              <span className="font-mono text-[10px] text-ink-4 uppercase tracking-[.04em]">
                {formatPublishedAt(c.publishedAt)}
              </span>
            ) : null}
          </li>
        ))}
      </ul>
    </details>
  );
}
