import type { JSONContent, Editor as TiptapEditor } from '@tiptap/core';
import { EditorContent, useEditor } from '@tiptap/react';
import type { JSX, ReactNode } from 'react';
import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { CharRefMenu } from '@/components/CharRefMenu';
import { EditorEmptyHints } from '@/components/EditorEmptyHints';
import { useCharactersQuery } from '@/hooks/useCharacters';
import { useCharRefSuggestionProvider } from '@/hooks/useCharRefSuggestionProvider';
import { useUserSettingsQuery } from '@/hooks/useUserSettings';
import { formatBarExtensions } from '@/lib/tiptap-extensions';
import { getTypographyExtensions } from '@/lib/tiptap-typography';

/**
 * Paper editor layout (F32).
 *
 * Mockup-fidelity document container that wraps a TipTap editor mount.
 * Reproduces the `.editor-paper` styling from
 * `mockups/frontend-prototype/design/styles.css`:
 *   - centered column, grows from the mockup's 720px up to 1080px on wider screens
 *   - 48 / 80 / 240 page padding
 *   - editable chapter title as the level-1 heading (serif 28/600) with a
 *     right-aligned `§ NN` label, followed by an uppercase mono-feel
 *     sub-row (draft · word count · status chip)
 *   - serif 18 / line-height 1.7 / `text-wrap: pretty` prose surface
 *     (rules in `src/index.css` under `.paper-prose .ProseMirror`)
 *
 * Editor mount mirrors the F8 patterns from `Editor.tsx` — onUpdate /
 * onReady routed through refs, controlled `initialBodyJson` swapped
 * with a JSON-equality guard, and `formatBarExtensions` (the canonical
 * extension list from F31) supplying the schema. F8's component is
 * left intact for back-compat; the EditorPage wire-up to switch over
 * to Paper is a later integration step.
 */
export interface PaperProps {
  draftLabel?: string | null;
  initialWordCount?: number;
  storyStatus?: string | null;
  chapterNumber?: number | null;
  chapterTitle?: string | null;
  initialBodyJson?: JSONContent | null;
  onUpdate?: (args: { bodyJson: JSONContent; wordCount: number }) => void;
  // Called with the new TipTap instance on mount and with `null` on unmount
  // (Paper is keyed on chapterId — a chapter switch destroys the editor).
  // Consumers must clear any stored ref when they receive null.
  onReady?: (editor: TiptapEditor | null) => void;
  // The chapter id is bound at render time to defeat blur-vs-chapter-switch
  // races (see ChapterTitleInput). Callers can ignore the id when they only
  // care about the active chapter, but it's the source of truth for the PATCH.
  chapterId?: string | null;
  onChapterTitleChange?: (chapterId: string, title: string) => void;
  // Story id for the character suggestion provider — drives
  // `useCharactersQuery` for the @-trigger menu. Without this, the
  // menu permanently shows "No characters in this story yet."
  storyId?: string | null;
}

const DEFAULT_EMPTY_DOC: JSONContent = {
  type: 'doc',
  content: [{ type: 'paragraph' }],
};

/**
 * Word-count rule mirrors `Editor.tsx` (F8) and the backend's
 * `computeWordCount`: trim plain text, return 0 when empty, otherwise
 * split on `/\s+/` and count non-empty tokens.
 */
function countWords(text: string): number {
  const trimmed = text.trim();
  if (trimmed.length === 0) return 0;
  return trimmed.split(/\s+/).filter(Boolean).length;
}

interface SubRowProps {
  draftLabel?: string | null;
  wordCount?: number;
  status?: string | null;
}

interface SubRowPart {
  key: string;
  node: ReactNode;
}

function SubRow({ draftLabel, wordCount, status }: SubRowProps): JSX.Element {
  // Build the inline parts in order, inserting middle-dot separators
  // only between fields that are actually present. Each part carries a
  // stable identity-based key (not an array index) so React can keep
  // refs steady when fields toggle on/off. The status chip is rendered
  // separately because it sits on the right of the row.
  const parts: SubRowPart[] = [];
  if (draftLabel) parts.push({ key: 'draft', node: <span>{draftLabel}</span> });

  if (typeof wordCount === 'number') {
    parts.push({ key: 'wc', node: <span>{wordCount.toLocaleString()} words</span> });
  }

  return (
    <div
      data-testid="paper-sub"
      className="paper-sub mt-1.5 flex items-center gap-2 font-mono text-[11px] uppercase tracking-[.04em] text-ink-4"
    >
      {parts.map((part, i) => (
        <Fragment key={part.key}>
          {i > 0 ? (
            <span key={`sep-${part.key}`} aria-hidden="true">
              ·
            </span>
          ) : null}
          {part.node}
        </Fragment>
      ))}
      {status ? (
        <span
          data-testid="paper-status-chip"
          className="ml-auto rounded-full bg-[var(--accent-soft)] px-2 py-0.5 text-[10px] uppercase tracking-[.08em] text-ink"
        >
          {status}
        </span>
      ) : null}
    </div>
  );
}

function ChapterTitleInput({
  chapterId,
  value,
  onCommit,
}: {
  // `chapterId` is bound into the commit closure so a blur fired while the
  // user clicks a different chapter still PATCHes the chapter that was
  // displayed when they were typing — not whatever activeChapterId is at the
  // moment React processes the blur (which can already be the next chapter).
  chapterId: string;
  value: string;
  onCommit?: (chapterId: string, next: string) => void;
}): JSX.Element {
  // Local draft so typing is instantaneous; commit on blur or Enter so we
  // don't issue a PATCH on every keystroke. Re-sync when the prop changes
  // (chapter switch, server-side rename, optimistic-update settle).
  const [draft, setDraft] = useState<string>(value);
  useEffect(() => {
    setDraft(value);
  }, [value]);

  const commit = (): void => {
    const next = draft.trim();
    // Empty title is rejected by the backend (`title: z.string().min(1)`).
    // Mirror that here as a silent revert so blurring an empty input restores
    // the previous title rather than firing a PATCH that 400s with no UI.
    if (next.length === 0) {
      setDraft(value);
      return;
    }
    if (next === value) return;
    onCommit?.(chapterId, next);
  };

  return (
    <input
      type="text"
      value={draft}
      onChange={(e) => {
        setDraft(e.target.value);
      }}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          (e.currentTarget as HTMLInputElement).blur();
        } else if (e.key === 'Escape') {
          e.preventDefault();
          setDraft(value);
          (e.currentTarget as HTMLInputElement).blur();
        }
      }}
      data-testid="chapter-title-input"
      aria-label="Chapter title"
      placeholder="Untitled chapter"
      className="w-full bg-transparent font-serif text-[28px] font-semibold leading-tight tracking-[-0.01em] text-ink outline-none focus:bg-[var(--accent-soft)]/30 rounded-sm px-1 -mx-1"
    />
  );
}

export function Paper({
  draftLabel,
  initialWordCount,
  storyStatus,
  chapterId,
  chapterNumber,
  chapterTitle,
  initialBodyJson,
  onUpdate,
  onReady,
  onChapterTitleChange,
  storyId,
}: PaperProps): JSX.Element {
  // Live per-draft word count for the status line. Seeded from the open
  // draft's server-authoritative count so it's correct before the first
  // keystroke; Paper is keyed on viewedDraftId upstream, so a draft switch
  // remounts and re-seeds — no effect needed.
  const [liveWordCount, setLiveWordCount] = useState<number>(initialWordCount ?? 0);

  // `useEditor` re-creates options on every render but only re-subscribes
  // its callbacks at mount; route the prop callbacks through refs so the
  // latest function reference is always called. (Same pattern as F8's
  // Editor.tsx — see CLAUDE.md "Known Gotchas".)
  const onUpdateRef = useRef(onUpdate);
  useEffect(() => {
    onUpdateRef.current = onUpdate;
  }, [onUpdate]);

  const onReadyRef = useRef(onReady);
  useEffect(() => {
    onReadyRef.current = onReady;
  }, [onReady]);

  // [F62] Provide the active story's characters to the @-trigger suggestion.
  // [X30] storyId comes from the parent (EditorPage threads it from the URL
  // params) — the previous implementation read from a `useActiveStoryStore`
  // whose setter was never called anywhere, so the query was always disabled
  // and the menu always showed "No characters in this story yet."
  const charactersQuery = useCharactersQuery(storyId ?? undefined);
  useCharRefSuggestionProvider(() =>
    (charactersQuery.data ?? []).map((c) => ({
      id: c.id,
      name: c.name,
      role: c.role,
    })),
  );

  // [F66] Read writing.smartQuotes / writing.emDashExpansion from B11 and
  // append the matching TipTap input rules. The editor remounts when either
  // flips because `extensions` is keyed off the booleans.
  const settingsQuery = useUserSettingsQuery();
  const smartQuotes = settingsQuery.data?.writing?.smartQuotes ?? false;
  const emDashExpansion = settingsQuery.data?.writing?.emDashExpansion ?? false;
  const extensions = useMemo(
    () => [...formatBarExtensions, ...getTypographyExtensions({ smartQuotes, emDashExpansion })],
    [smartQuotes, emDashExpansion],
  );

  const editor = useEditor({
    extensions,
    content: initialBodyJson ?? DEFAULT_EMPTY_DOC,
    shouldRerenderOnTransaction: true,
    editorProps: {
      attributes: {
        // Typography rules live in `.paper-prose .ProseMirror` in
        // `src/index.css`; the wrapper div below applies that scope.
        role: 'textbox',
        'aria-multiline': 'true',
        'aria-label': 'Chapter body',
      },
    },
    onUpdate({ editor: ed }) {
      const json = ed.getJSON();
      const wordCount = countWords(ed.getText());
      setLiveWordCount(wordCount);
      onUpdateRef.current?.({ bodyJson: json, wordCount });
    },
  });

  // [F64] Hint strip toggles off as soon as the editor has any content.
  // shouldRerenderOnTransaction ensures this re-evaluates on every keystroke.
  const isEmpty = editor?.isEmpty ?? true;

  // Fire onReady once per editor instance — guards against React
  // StrictMode double-invoke and parent-callback identity churn. On unmount
  // (e.g. Paper is keyed on chapterId and the user switches chapters)
  // notify the parent so it can drop its `editor` state — otherwise the
  // parent holds a destroyed TipTap instance for a render cycle and
  // FormatBar / InlineAIResult crash on `editor.isActive(...)`.
  const readyFiredFor = useRef<TiptapEditor | null>(null);
  useEffect(() => {
    if (!editor) return;
    if (readyFiredFor.current === editor) return;
    readyFiredFor.current = editor;
    onReadyRef.current?.(editor);
    return () => {
      readyFiredFor.current = null;
      onReadyRef.current?.(null);
    };
  }, [editor]);

  // Swap content when the controlled prop changes, but only when it
  // actually differs from the editor's current document — `setContent`
  // would otherwise reset selection / history.
  useEffect(() => {
    if (!editor || !initialBodyJson) return;
    const current = editor.getJSON();
    if (JSON.stringify(current) !== JSON.stringify(initialBodyJson)) {
      editor.commands.setContent(initialBodyJson, { emitUpdate: false });
    }
  }, [editor, initialBodyJson]);

  const chapterLabel =
    typeof chapterNumber === 'number' ? `§ ${String(chapterNumber).padStart(2, '0')}` : null;

  return (
    <article className="paper mx-auto w-full max-w-[1080px] px-20 pt-12 pb-60">
      {chapterTitle !== null && chapterTitle !== undefined && chapterId ? (
        <header data-testid="chapter-heading" className="flex items-baseline gap-3">
          <h1 className="paper-title flex-1 min-w-0 m-0">
            <ChapterTitleInput
              chapterId={chapterId}
              value={chapterTitle}
              onCommit={onChapterTitleChange}
            />
          </h1>
          {chapterLabel ? (
            <span
              data-testid="chapter-label"
              className="font-sans text-[11px] uppercase tracking-[.06em] text-ink-4"
            >
              {chapterLabel}
            </span>
          ) : null}
        </header>
      ) : null}

      <SubRow draftLabel={draftLabel} wordCount={liveWordCount} status={storyStatus} />

      <div className="paper-prose mt-6">
        <EditorContent editor={editor} />
      </div>
      {isEmpty ? <EditorEmptyHints /> : null}
      <CharRefMenu />
    </article>
  );
}
