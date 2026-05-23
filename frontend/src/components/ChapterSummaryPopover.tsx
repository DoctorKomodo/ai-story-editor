import type { JSX } from 'react';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { ChapterMeta } from 'story-editor-shared';
import { FieldRow, Spinner } from '@/design/primitives';
import { deriveSummaryState, deriveListSummaryState, useSummariseChapterMutation } from '@/hooks/useChapterSummary';
import { useChapterQuery } from '@/hooks/useChapters';
import { useEscape } from '@/hooks/useKeyboardShortcuts';
import { computePopoverPosition, type Position } from '@/lib/popover-position';

/*
 * Smart popover: the chapter-list cache is metadata-only (no decrypted summary
 * fields), so this component fetches chapter detail to know the real state
 * (current / stale / corrupted) and to render the three summary fields.
 */

const POPOVER_WIDTH_PX = 280;

export interface ChapterSummaryPopoverProps {
  /** List-meta only. `null` → not rendered. */
  chapter: ChapterMeta | null;
  storyId: string;
  /** Element to anchor below. `null` → not rendered. */
  anchorEl: HTMLElement | null;
  modelId: string;
  onClose: () => void;
  /** Called with the chapter id when Edit is clicked → EditorPage opens the summary sheet. */
  onEdit: (chapterId: string) => void;
}

export function ChapterSummaryPopover({
  chapter,
  storyId,
  anchorEl,
  modelId,
  onClose,
  onEdit,
}: ChapterSummaryPopoverProps): JSX.Element | null {
  const popoverRef = useRef<HTMLDivElement | null>(null);
  const [pos, setPos] = useState<Position | null>(null);

  // Early-return guard — mutation hook is only safe to call when chapter is non-null.
  const chapterId = chapter?.id ?? null;

  const detail = useChapterQuery(chapterId, storyId);
  const summariseMutation = useSummariseChapterMutation(chapterId ?? '', storyId);

  // Recompute position whenever the anchor changes (non-null).
  useLayoutEffect(() => {
    if (!anchorEl) {
      setPos(null);
      return;
    }
    setPos(computePopoverPosition(anchorEl, { width: POPOVER_WIDTH_PX }));
  }, [anchorEl]);

  // Escape dismissal via priority registry — priority 50 (below modals, above selection bubble).
  useEscape(
    () => {
      onClose();
      return true;
    },
    { priority: 50, enabled: chapter !== null && anchorEl !== null },
  );

  // Outside-click dismissal.
  useEffect(() => {
    if (!chapter || !anchorEl) return;
    const onMouseDown = (e: MouseEvent): void => {
      const target = e.target as Node | null;
      if (!target) return;
      if (popoverRef.current?.contains(target)) return;
      if (anchorEl.contains(target)) return;
      onClose();
    };
    document.addEventListener('mousedown', onMouseDown);
    return () => {
      document.removeEventListener('mousedown', onMouseDown);
    };
  }, [chapter, anchorEl, onClose]);

  if (!chapter || !anchorEl) return null;

  // Derive the display state. Use fetched detail when available; fall back to
  // list-meta flags while the detail query is still in flight.
  const hasSummary = detail.data?.hasSummary ?? chapter.hasSummary;
  const summaryIsStale = detail.data?.summaryIsStale ?? chapter.summaryIsStale;
  const summary = detail.data?.summary ?? null;

  const summaryState = summariseMutation.isPending
    ? 'generating'
    : detail.data !== undefined
      ? deriveSummaryState({ hasSummary, summaryIsStale, summary })
      : deriveListSummaryState({ hasSummary, summaryIsStale });

  // Token estimate: rough word→token ratio (3/4 words = 1 token).
  const tokenEstimate = Math.ceil(chapter.wordCount * 0.75);

  const displayTitle =
    chapter.title && chapter.title.trim().length > 0 ? chapter.title : 'Untitled';
  const headerCaption = `Chapter ${chapter.orderIndex + 1}`;

  return (
    <div
      ref={popoverRef}
      role="dialog"
      aria-label={`Chapter summary: ${displayTitle}`}
      className="t-popover-in chapter-summary-popover absolute z-40 w-[280px] bg-bg-elevated border border-line rounded-[var(--radius-lg)] shadow-pop p-3"
      style={{
        top: pos ? `${pos.top}px` : 0,
        left: pos ? `${pos.left}px` : 0,
        visibility: pos ? 'visible' : 'hidden',
      }}
    >
      <header className="mb-1">
        <h3 className="font-serif text-[16px] text-ink leading-tight">{displayTitle}</h3>
        <div className="mt-0.5 text-[10px] uppercase tracking-[.08em] text-ink-4 font-mono flex items-center gap-2">
          <span>{headerCaption}</span>
          {summaryState === 'stale' && (
            <span className="rounded border border-line px-1.5 py-0.5 normal-case tracking-normal text-ink-3 italic">
              possibly stale
            </span>
          )}
          {summaryState === 'corrupted' && (
            <span className="rounded border border-line px-1.5 py-0.5 normal-case tracking-normal text-ink-3">
              unreadable
            </span>
          )}
        </div>
      </header>

      {(summaryState === 'current' || summaryState === 'stale') && (
        <dl>
          <FieldRow label="Events" value={summary?.events ?? '—'} />
          <FieldRow label="State at end" value={summary?.stateAtEnd ?? '—'} />
          <FieldRow label="Open threads" value={summary?.openThreads ?? '—'} />
        </dl>
      )}

      {summaryState === 'missing' && (
        <p className="mt-2 font-serif text-[13px] text-ink-3 leading-relaxed">
          No summary yet. Generate one so this chapter contributes context when you write later
          chapters.
        </p>
      )}

      {summaryState === 'corrupted' && (
        <p className="mt-2 font-serif text-[13px] text-ink-3 leading-relaxed">
          A summary is stored but couldn't be read in this session. Regenerating will replace it.
        </p>
      )}

      {summaryState === 'generating' && (
        <div className="mt-2 flex items-center gap-2 font-serif text-[13px] text-ink-3">
          <Spinner /> Generating summary…
        </div>
      )}

      <div className="mt-3 flex items-center gap-2">
        {(summaryState === 'current' || summaryState === 'stale') && (
          <>
            <button
              type="button"
              onClick={() => onEdit(chapter.id)}
              className="text-[12px] px-2 py-1 rounded-[var(--radius)] hover:bg-[var(--surface-hover)]"
            >
              Edit
            </button>
            <button
              type="button"
              onClick={() => summariseMutation.mutate(modelId)}
              className="text-[12px] px-2 py-1 rounded-[var(--radius)] hover:bg-[var(--surface-hover)]"
            >
              Regenerate
            </button>
          </>
        )}
        {(summaryState === 'missing' || summaryState === 'corrupted') && (
          <button
            type="button"
            onClick={() => summariseMutation.mutate(modelId)}
            className="text-[12px] px-2 py-1 rounded-[var(--radius)] hover:bg-[var(--surface-hover)]"
          >
            Generate summary
          </button>
        )}
        {summaryState === 'generating' && (
          <button
            type="button"
            onClick={onClose}
            className="text-[12px] px-2 py-1 rounded-[var(--radius)] hover:bg-[var(--surface-hover)]"
          >
            Cancel
          </button>
        )}
        <span className="ml-auto text-[10px] text-ink-4 font-mono">
          {(summaryState === 'missing' ||
            summaryState === 'corrupted' ||
            summaryState === 'generating') &&
            `~${tokenEstimate} tok`}
        </span>
      </div>
    </div>
  );
}
