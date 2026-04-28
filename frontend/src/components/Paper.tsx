import type { JSONContent, Editor as TiptapEditor } from '@tiptap/core';
import { EditorContent, useEditor } from '@tiptap/react';
import type { JSX, ReactNode } from 'react';
import { Fragment, useEffect, useMemo, useRef } from 'react';
import { CharRefMenu } from '@/components/CharRefMenu';
import { EditorEmptyHints } from '@/components/EditorEmptyHints';
import { useCharactersQuery } from '@/hooks/useCharacters';
import { useCharRefSuggestionProvider } from '@/hooks/useCharRefSuggestionProvider';
import { useUserSettingsQuery } from '@/hooks/useUserSettings';
import { formatBarExtensions } from '@/lib/tiptap-extensions';
import { getTypographyExtensions } from '@/lib/tiptap-typography';
import { useActiveStoryStore } from '@/store/activeStory';

/**
 * Paper editor layout (F32).
 *
 * Mockup-fidelity document container that wraps a TipTap editor mount.
 * Reproduces the `.editor-paper` styling from
 * `mockups/frontend-prototype/design/styles.css`:
 *   - 720px max-width centered column
 *   - 48 / 80 / 240 page padding
 *   - serif 28/600 document title with an uppercase mono-feel sub-row
 *     (genre · draft · word count · status chip)
 *   - serif italic 22 chapter heading with a right-aligned `§ NN` label
 *     and a 1px bottom border
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
  storyTitle: string;
  storyGenre?: string | null;
  draftLabel?: string | null;
  storyWordCount?: number;
  storyStatus?: string | null;
  chapterNumber?: number | null;
  chapterTitle?: string | null;
  initialBodyJson?: JSONContent | null;
  onUpdate?: (args: { bodyJson: JSONContent; wordCount: number }) => void;
  onReady?: (editor: TiptapEditor) => void;
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
  genre?: string | null;
  draftLabel?: string | null;
  wordCount?: number;
  status?: string | null;
}

interface SubRowPart {
  key: string;
  node: ReactNode;
}

function SubRow({ genre, draftLabel, wordCount, status }: SubRowProps): JSX.Element {
  // Build the inline parts in order, inserting middle-dot separators
  // only between fields that are actually present. Each part carries a
  // stable identity-based key (not an array index) so React can keep
  // refs steady when fields toggle on/off. The status chip is rendered
  // separately because it sits on the right of the row.
  const parts: SubRowPart[] = [];
  if (genre) parts.push({ key: 'genre', node: <span>{genre}</span> });

  const draft = draftLabel ?? 'Draft 1';
  if (draft) parts.push({ key: 'draft', node: <span>{draft}</span> });

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

export function Paper({
  storyTitle,
  storyGenre,
  draftLabel,
  storyWordCount,
  storyStatus,
  chapterNumber,
  chapterTitle,
  initialBodyJson,
  onUpdate,
  onReady,
}: PaperProps): JSX.Element {
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
  const activeStoryId = useActiveStoryStore((s) => s.activeStoryId);
  const charactersQuery = useCharactersQuery(activeStoryId ?? undefined);
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
      const cb = onUpdateRef.current;
      if (!cb) return;
      const json = ed.getJSON();
      const wordCount = countWords(ed.getText());
      cb({ bodyJson: json, wordCount });
    },
  });

  // [F64] Hint strip toggles off as soon as the editor has any content.
  // shouldRerenderOnTransaction ensures this re-evaluates on every keystroke.
  const isEmpty = editor?.isEmpty ?? true;

  // Fire onReady once per editor instance — guards against React
  // StrictMode double-invoke and parent-callback identity churn.
  const readyFiredFor = useRef<TiptapEditor | null>(null);
  useEffect(() => {
    if (!editor) return;
    if (readyFiredFor.current === editor) return;
    readyFiredFor.current = editor;
    onReadyRef.current?.(editor);
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
    <article className="paper mx-auto w-full max-w-[720px] px-20 pt-12 pb-60">
      <h1 className="paper-title font-serif text-[28px] font-semibold leading-tight tracking-[-0.01em] text-ink">
        {storyTitle || 'Untitled'}
      </h1>

      <SubRow
        genre={storyGenre}
        draftLabel={draftLabel}
        wordCount={storyWordCount}
        status={storyStatus}
      />

      {chapterTitle ? (
        <header
          data-testid="chapter-heading"
          className="chapter-heading mt-12 flex items-baseline gap-3 border-b border-line pt-2 pb-2"
        >
          <h2 className="flex-1 font-serif text-[22px] italic text-ink">{chapterTitle}</h2>
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

      <div className="paper-prose mt-6">
        <EditorContent editor={editor} />
      </div>
      {isEmpty ? <EditorEmptyHints /> : null}
      <CharRefMenu />
    </article>
  );
}
