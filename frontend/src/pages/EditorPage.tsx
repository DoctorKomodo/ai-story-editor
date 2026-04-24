import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useStoryQuery } from '@/hooks/useStories';

/**
 * Three-pane editor shell (F7).
 *
 * Owns only the layout and the story-title fetch. The panes are placeholders:
 * - F8  replaces the centre with the TipTap editor.
 * - F10 replaces the left sidebar with the chapter list (dnd-kit).
 * - F12 replaces the right panel with the AI assistant.
 * - F25 redesigns the shell to the mockup spec (CSS grid, data-layout
 *   variants, Inkwell brand lockup, focus mode).
 *
 * The right AI panel is collapsible; state is local to this page (no Zustand
 * or localStorage yet — F22 folds it into the layout slice).
 */
export function EditorPage(): JSX.Element {
  const { id } = useParams<{ id: string }>();
  const { data: story, isLoading, isError } = useStoryQuery(id);
  const [aiOpen, setAiOpen] = useState(true);

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
          <p className="text-sm text-neutral-500">Chapter list mounts in F10.</p>
        </aside>

        <main aria-label="Editor" className="flex-1 min-w-0 overflow-y-auto p-6">
          <div className="mx-auto max-w-3xl rounded border border-dashed border-neutral-300 bg-white p-8 text-neutral-500">
            Editor &mdash; TipTap mounts in F8.
          </div>
        </main>

        {aiOpen ? (
          <aside
            id="ai-panel"
            aria-label="AI assistant"
            className="w-80 shrink-0 border-l border-neutral-200 bg-white p-4 overflow-y-auto"
          >
            <h2 className="text-sm font-semibold uppercase tracking-wide text-neutral-500 mb-3">
              AI
            </h2>
            <p className="text-sm text-neutral-500">AI assistant mounts in F12.</p>
          </aside>
        ) : null}
      </div>
    </div>
  );
}
