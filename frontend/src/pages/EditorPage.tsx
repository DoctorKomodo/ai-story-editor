import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import type { Editor as TiptapEditor } from '@tiptap/core';
import type { JSONContent } from '@tiptap/core';
import { ApiError } from '@/lib/api';
import { useStoryQuery } from '@/hooks/useStories';
import { useChaptersQuery } from '@/hooks/useChapters';
import { Editor } from '@/components/Editor';
import { ChapterList } from '@/components/ChapterList';
import { CharacterList } from '@/components/CharacterList';
import { CharacterSheet } from '@/components/CharacterSheet';
import { AIPanel, type AIAction } from '@/components/AIPanel';
import { AIResult } from '@/components/AIResult';
import { UsageIndicator } from '@/components/UsageIndicator';
import { ModelSelector } from '@/components/ModelSelector';
import { WebSearchToggle } from '@/components/WebSearchToggle';
import { UserMenu } from '@/components/UserMenu';
import { Export, type ExportStory } from '@/components/Export';
import { DarkModeToggle } from '@/components/DarkModeToggle';
import { useSelectedModel } from '@/hooks/useSelectedModel';
import { useModelsQuery } from '@/hooks/useModels';
import { useAICompletion } from '@/hooks/useAICompletion';
import { useBalanceQuery } from '@/hooks/useBalance';
import { useAuth } from '@/hooks/useAuth';
import { useSessionStore } from '@/store/session';

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
  const navigate = useNavigate();
  const { data: story, isLoading, isError } = useStoryQuery(id);
  // [F20] Export needs the full chapter list + bodyJson. Chapters come from
  // their own query (loaded already by ChapterList); we reuse the cache here
  // and build the Export payload lazily. When chapters are still loading,
  // the Export component still renders — "Export full story" with an empty
  // chapters array would produce just the title, so we only bind once the
  // list resolves.
  const chaptersQuery = useChaptersQuery(story?.id);
  // [F17] Venice account balance — fetched on editor load and rendered in the
  // user menu. Errors surface via dedicated copy (`venice_key_required` vs
  // generic) inside `<BalanceDisplay />`.
  const balanceQuery = useBalanceQuery();
  const balanceError = balanceQuery.error;
  const balanceErrorCode =
    balanceError instanceof ApiError ? balanceError.code ?? null : null;
  const username = useSessionStore((s) => s.user?.username) ?? '';
  const { logout } = useAuth();
  const handleSignOut = useCallback((): void => {
    void logout().finally(() => {
      navigate('/login');
    });
  }, [logout, navigate]);
  const [aiOpen, setAiOpen] = useState(true);
  // [F10] Selected chapter is local state for now — F22 moves it into the
  // Zustand layout slice once cross-route persistence is required.
  const [activeChapterId, setActiveChapterId] = useState<string | null>(null);
  // [F18] Sidebar tab: Chapters vs Cast. Local state — F22 folds into slice;
  // F27 redesigns to the mockup Cast/Outline tabs.
  const [sidebarTab, setSidebarTab] = useState<'chapters' | 'characters'>('chapters');
  // [F19] Character-sheet modal is driven by a single id — null means closed.
  // F37 later adds a mention-popover as an alternate entry point; the sheet
  // stays as the full "edit all fields" surface.
  const [openCharacterId, setOpenCharacterId] = useState<string | null>(null);
  // [F12] Editor selection plumbed to the AI panel. F22 may fold this into
  // the Zustand `selection` slice once cross-component reads appear.
  const [selectedText, setSelectedText] = useState('');
  const [editor, setEditor] = useState<TiptapEditor | null>(null);
  // [F13] Selected Venice model — persisted to localStorage so reopening the
  // editor keeps the user's last pick. [F15] will read this when calling
  // /api/ai/complete.
  const { selectedModelId, setSelectedModelId } = useSelectedModel();
  // [F14] Web-search opt-in. Only surfaces in the UI when the selected model's
  // `supportsWebSearch` is true; resets to false when the user switches models
  // so a stranded `true` from a capable model doesn't silently persist onto a
  // non-capable one. [F15] forwards this as `enableWebSearch` in the body.
  const [webSearch, setWebSearch] = useState(false);
  const { data: models } = useModelsQuery();
  const selectedModel = models?.find((m) => m.id === selectedModelId) ?? null;
  // [F15] Streaming AI completion hook — owns status/text/error for the
  // in-flight call. `actionError` is the pre-call validation message (no
  // model / no chapter); the hook's own error state is for transport-level
  // failures (no Venice key, rate-limit, mid-stream error).
  const completion = useAICompletion();
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => {
    setWebSearch(false);
  }, [selectedModelId]);

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
      if (!story) return;
      if (selectedModelId === null) {
        setActionError('Select a model before running an AI action.');
        return;
      }
      if (activeChapterId === null) {
        setActionError('Select a chapter before running an AI action.');
        return;
      }
      setActionError(null);
      void completion.run({
        action,
        selectedText,
        chapterId: activeChapterId,
        storyId: story.id,
        modelId: selectedModelId,
        freeformInstruction,
        enableWebSearch: webSearch,
      });
    },
    [activeChapterId, completion, selectedModelId, selectedText, story, webSearch],
  );

  const exportStory: ExportStory | null = useMemo(() => {
    if (!story) return null;
    const chapters = chaptersQuery.data ?? [];
    return {
      id: story.id,
      title: story.title,
      chapters: chapters.map((c) => ({
        id: c.id,
        title: c.title,
        orderIndex: c.orderIndex,
        bodyJson: (c.bodyJson as JSONContent | null) ?? null,
      })),
    };
  }, [story, chaptersQuery.data]);

  const handleInsertAtCursor = useCallback(
    (text: string): void => {
      if (!editor) return;
      editor.chain().focus().insertContent(text).run();
    },
    [editor],
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
    <div className="min-h-screen flex flex-col bg-neutral-50 dark:bg-neutral-950 dark:text-neutral-100">
      <header className="flex items-center justify-between gap-4 border-b border-neutral-200 bg-white px-6 py-3 dark:border-neutral-700 dark:bg-neutral-900">
        <div className="flex items-center gap-4 min-w-0">
          <Link
            to="/"
            aria-label="Back to dashboard"
            className="text-neutral-600 hover:text-neutral-900 dark:text-neutral-300 dark:hover:text-neutral-100"
          >
            &larr;
          </Link>
          <h1 className="text-lg font-semibold truncate">{story.title}</h1>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => {
              setAiOpen((v) => !v);
            }}
            aria-expanded={aiOpen}
            aria-controls="ai-panel"
            className="rounded border border-neutral-300 bg-white px-3 py-1.5 text-sm font-medium hover:bg-neutral-100 transition-colors dark:border-neutral-600 dark:bg-neutral-800 dark:text-neutral-100 dark:hover:bg-neutral-700"
          >
            {aiOpen ? 'Hide AI' : 'Show AI'}
          </button>
          {exportStory ? (
            <Export story={exportStory} activeChapterId={activeChapterId} />
          ) : null}
          <DarkModeToggle />
          <UserMenu
            username={username}
            onSignOut={handleSignOut}
            balance={balanceQuery.data ?? null}
            isLoading={balanceQuery.isLoading}
            isError={balanceQuery.isError}
            errorCode={balanceErrorCode}
          />
        </div>
      </header>

      <div className="flex flex-1 min-h-0">
        <aside
          aria-label="Chapters"
          className="w-64 shrink-0 border-r border-neutral-200 bg-white p-4 overflow-y-auto dark:border-neutral-700 dark:bg-neutral-900"
        >
          {/* [F18] Tab switcher — Chapters / Cast. Both panels stay mounted
              (via `hidden`) so query cache + scroll position survive toggling.
              Keyboard arrow-key navigation between tabs is F27's concern. */}
          <div
            role="tablist"
            aria-label="Sidebar sections"
            className="flex gap-1 mb-3 border-b border-neutral-200"
          >
            <button
              type="button"
              role="tab"
              id="sidebar-tab-chapters"
              aria-selected={sidebarTab === 'chapters'}
              aria-controls="sidebar-panel-chapters"
              onClick={() => {
                setSidebarTab('chapters');
              }}
              className={[
                'px-2 py-1 text-xs font-semibold uppercase tracking-wide transition-colors',
                sidebarTab === 'chapters'
                  ? 'text-neutral-900 border-b-2 border-neutral-900 -mb-px'
                  : 'text-neutral-500 hover:text-neutral-700',
              ].join(' ')}
            >
              Chapters
            </button>
            <button
              type="button"
              role="tab"
              id="sidebar-tab-characters"
              aria-selected={sidebarTab === 'characters'}
              aria-controls="sidebar-panel-characters"
              onClick={() => {
                setSidebarTab('characters');
              }}
              className={[
                'px-2 py-1 text-xs font-semibold uppercase tracking-wide transition-colors',
                sidebarTab === 'characters'
                  ? 'text-neutral-900 border-b-2 border-neutral-900 -mb-px'
                  : 'text-neutral-500 hover:text-neutral-700',
              ].join(' ')}
            >
              Cast
            </button>
          </div>

          <div
            role="tabpanel"
            id="sidebar-panel-chapters"
            aria-labelledby="sidebar-tab-chapters"
            hidden={sidebarTab !== 'chapters'}
          >
            <ChapterList
              storyId={story.id}
              activeChapterId={activeChapterId}
              onSelectChapter={setActiveChapterId}
            />
          </div>

          <div
            role="tabpanel"
            id="sidebar-panel-characters"
            aria-labelledby="sidebar-tab-characters"
            hidden={sidebarTab !== 'characters'}
          >
            <CharacterList storyId={story.id} onOpenCharacter={setOpenCharacterId} />
          </div>
        </aside>

        <main
          aria-label="Editor"
          className="flex-1 min-w-0 overflow-y-auto p-6 dark:bg-neutral-950"
        >
          <div className="mx-auto max-w-3xl">
            <Editor onReady={handleEditorReady} />
          </div>
        </main>

        <aside
          id="ai-panel"
          aria-label="AI assistant"
          hidden={!aiOpen}
          className="w-80 shrink-0 border-l border-neutral-200 bg-white p-4 overflow-y-auto dark:border-neutral-700 dark:bg-neutral-900"
        >
          <AIPanel
            selectedText={selectedText}
            onAction={handleAIAction}
            pending={completion.status === 'streaming'}
            actionError={actionError}
            modelSelector={
              <ModelSelector value={selectedModelId} onChange={setSelectedModelId} />
            }
            webSearchToggle={
              <WebSearchToggle
                model={selectedModel}
                checked={webSearch}
                onChange={setWebSearch}
              />
            }
            result={
              <AIResult
                status={completion.status}
                text={completion.text}
                error={completion.error}
                onInsertAtCursor={handleInsertAtCursor}
                onDismiss={completion.reset}
              />
            }
            usage={<UsageIndicator usage={completion.usage} />}
          />
        </aside>
      </div>

      <CharacterSheet
        storyId={story.id}
        characterId={openCharacterId}
        onClose={() => {
          setOpenCharacterId(null);
        }}
      />
    </div>
  );
}
