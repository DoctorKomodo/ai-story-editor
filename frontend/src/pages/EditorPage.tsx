import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import type { Editor as TiptapEditor } from '@tiptap/core';
import { useStoryQuery } from '@/hooks/useStories';
import { Editor } from '@/components/Editor';
import { ChapterList } from '@/components/ChapterList';
import { AIPanel, type AIAction } from '@/components/AIPanel';

function extractSelection(editor: TiptapEditor): string {
  const { from, to } = editor.state.selection;
  if (from === to) return '';
  return editor.state.doc.textBetween(from, to, ' ');
}

/**
 * Three-pane editor shell (F7).
 *
 * Owns the layout, the story-title fetch, and the editor-selection plumbing
 * that feeds the AI panel (F12). Panes:
 * - Left:   chapter list (F10, dnd-kit).
 * - Centre: TipTap editor (F8).
 * - Right:  AI assistant panel (F12) — `handleAIAction` is a stub that F15
 *           will replace with the streaming call to `/api/ai/complete`.
 *
 * F25 later redesigns the shell to mockup spec (CSS grid, data-layout
 * variants, Inkwell brand lockup, focus mode).
 *
 * The right AI panel is collapsible; state is local to this page (no Zustand
 * or localStorage yet — F22 folds it into the layout slice).
 */
export function EditorPage(): JSX.Element {
  const { id } = useParams<{ id: string }>();
  const { data: story, isLoading, isError } = useStoryQuery(id);
  const [aiOpen, setAiOpen] = useState(true);
  // [F10] Selected chapter is local state for now — F22 moves it into the
  // Zustand layout slice once cross-route persistence is required.
  const [activeChapterId, setActiveChapterId] = useState<string | null>(null);
  // [F12] Editor selection plumbed to the AI panel. F22 may fold this into
  // the Zustand `selection` slice once cross-component reads appear.
  const [selectedText, setSelectedText] = useState('');
  const [editor, setEditor] = useState<TiptapEditor | null>(null);

  const handleEditorReady = useCallback((ed: TiptapEditor) => {
    setEditor(ed);
  }, []);

  useEffect(() => {
    if (!editor) return;
    const handler = (): void => {
      setSelectedText(extractSelection(editor));
    };
    editor.on('selectionUpdate', handler);
    return () => {
      editor.off('selectionUpdate', handler);
    };
  }, [editor]);

  const handleAIAction = useCallback(
    (action: AIAction, freeformInstruction?: string): void => {
      // [F15] will replace this stub with the streaming call to /api/ai/complete.
      // eslint-disable-next-line no-console
      console.info('F15 will call /api/ai/complete with', {
        action,
        freeformInstruction,
        selectedText,
      });
    },
    [selectedText],
  );

  if (isLoading) {
    return (
      <div
        role="status"
        aria-live="polite"
        className="min-h-screen flex items-center justify-center text-neutral-600"
      >
        Loading story…
      </div>
    );
  }

  if (isError || !story) {
    // Backend returns 403 for both "unknown id" and "not owned" to avoid
    // id-enumeration oracles; surface a neutral message rather than the raw
    // status text.
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-3 p-6">
        <p role="alert" className="text-red-600">
          Could not load story
        </p>
        <Link to="/" className="text-blue-600 hover:underline">
          Back to dashboard
        </Link>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col bg-neutral-50">
      <header className="flex items-center justify-between gap-4 border-b border-neutral-200 bg-white px-6 py-3">
        <div className="flex items-center gap-4 min-w-0">
          <Link
            to="/"
            aria-label="Back to dashboard"
            className="text-neutral-600 hover:text-neutral-900"
          >
            &larr;
          </Link>
          <h1 className="text-lg font-semibold truncate">{story.title}</h1>
        </div>
        <button
          type="button"
          onClick={() => {
            setAiOpen((v) => !v);
          }}
          aria-expanded={aiOpen}
          aria-controls="ai-panel"
          className="rounded border border-neutral-300 bg-white px-3 py-1.5 text-sm font-medium hover:bg-neutral-100 transition-colors"
        >
          {aiOpen ? 'Hide AI' : 'Show AI'}
        </button>
      </header>

      <div className="flex flex-1 min-h-0">
        <aside
          aria-label="Chapters"
          className="w-64 shrink-0 border-r border-neutral-200 bg-white p-4 overflow-y-auto"
        >
          <h2 className="text-sm font-semibold uppercase tracking-wide text-neutral-500 mb-3">
            Chapters
          </h2>
          <ChapterList
            storyId={story.id}
            activeChapterId={activeChapterId}
            onSelectChapter={setActiveChapterId}
          />
        </aside>

        <main aria-label="Editor" className="flex-1 min-w-0 overflow-y-auto p-6">
          <div className="mx-auto max-w-3xl">
            <Editor onReady={handleEditorReady} />
          </div>
        </main>

        <aside
          id="ai-panel"
          aria-label="AI assistant"
          hidden={!aiOpen}
          className="w-80 shrink-0 border-l border-neutral-200 bg-white p-4 overflow-y-auto"
        >
          <AIPanel selectedText={selectedText} onAction={handleAIAction} />
        </aside>
      </div>
    </div>
  );
}
