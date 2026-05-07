/**
 * [SC17] SceneTab — orchestrator for the scene-generation workflow.
 *
 * Wires together:
 *  - SceneSessionPicker (session CRUD + selection)
 *  - useScenes (TanStack Query session list + mutations)
 *  - useSceneTranscript (Zustand + SSE streaming transcript)
 *  - SceneCandidateCard (per-turn pair: user direction → AI candidate)
 *  - SceneComposer (textarea + generate/stop)
 *  - Auto-title: on the first turn of a new session, derives a title from
 *    the user's direction text and patches the chat via patchChat.
 *  - Insert-at-end: SceneCandidateCard.onInsert appends the candidate text
 *    at the document end via the TipTap editor chain.
 *  - Soft-delete with undo: onDelete hides the session immediately and
 *    schedules the real API delete after UNDO_TIMEOUT_MS. onUndo cancels
 *    the timer and restores the session visually.
 */
import type { Editor as TiptapEditor } from '@tiptap/core';
import { type JSX, useCallback, useEffect, useState } from 'react';
import { InlineErrorBanner } from '@/components/InlineErrorBanner';
import { SceneCandidateCard } from '@/components/SceneCandidateCard';
import { SceneComposer } from '@/components/SceneComposer';
import { SceneSessionPicker } from '@/components/SceneSessionPicker';
import { useModelsQuery } from '@/hooks/useModels';
import { useScenes } from '@/hooks/useScenes';
import { useSceneTranscript } from '@/hooks/useSceneTranscript';
import { useSoftDelete } from '@/hooks/useSoftDelete';
import { useUserSettings } from '@/hooks/useUserSettings';
import { listMessagesForChat, patchChat as patchChatApi } from '@/lib/api';
import type { SceneMessage } from '@/store/sceneTranscript';
import { useSceneTranscriptStore } from '@/store/sceneTranscript';

export interface SceneTabProps {
  chapterId: string | null;
  editor: TiptapEditor | null;
}

const TITLE_MAX_CHARS = 50;

function truncateAtWordBoundary(text: string, max: number): string {
  if (text.length <= max) return text.replace(/\s+/g, ' ').trim();
  const slice = text.slice(0, max);
  const lastSpace = slice.lastIndexOf(' ');
  const cut = lastSpace > 20 ? slice.slice(0, lastSpace) : slice;
  return `${cut.trim().replace(/[.,;:!?]+$/, '')}…`;
}

function renderTranscript(
  messages: SceneMessage[],
  onInsert: (text: string) => void,
  onRetry: () => void,
  onCopy: (text: string) => void,
): JSX.Element[] {
  const cards: JSX.Element[] = [];
  for (let i = 0; i < messages.length; i++) {
    const m = messages[i];
    if (m.role !== 'user') continue;
    const next = messages[i + 1];
    if (!next || next.role !== 'assistant') continue;
    const isLatest = i + 2 >= messages.length;
    const state = next.state === 'streaming' ? ('streaming' as const) : ('done' as const);
    cards.push(
      <SceneCandidateCard
        key={next.id}
        direction={m.content}
        candidate={next.content}
        state={state}
        isLatest={isLatest}
        model={next.model}
        onInsert={() => {
          onInsert(next.content);
        }}
        onRetry={onRetry}
        onCopy={() => {
          onCopy(next.content);
        }}
      />,
    );
  }
  return cards;
}

export function SceneTab({ chapterId, editor }: SceneTabProps): JSX.Element {
  const settings = useUserSettings();
  const modelId = settings.chat.model;
  const { data: models } = useModelsQuery();
  const modelName = models?.find((m) => m.id === modelId)?.name;

  const { sessions, create, rename, remove, error: scenesError } = useScenes(chapterId);
  const [activeId, setActiveId] = useState<string | null>(null);
  // [A3] Error state for listMessagesForChat hydration failures.
  const [hydrationError, setHydrationError] = useState<string | null>(null);

  // Pick the most recent session if none is active. If active session was
  // deleted, advance to next.
  useEffect(() => {
    if (!activeId && sessions.length > 0) {
      setActiveId(sessions[0].id);
    }
    if (activeId && !sessions.find((s) => s.id === activeId)) {
      setActiveId(sessions[0]?.id ?? null);
    }
  }, [sessions, activeId]);

  const transcript = useSceneTranscript(modelId, modelName);
  // setChat is a stable Zustand action — use it directly from the store so it
  // doesn't appear in the effect dependency array and cause an infinite loop.
  const setChat = useSceneTranscriptStore((s) => s.setChat);

  // Load messages whenever the active session changes.
  useEffect(() => {
    let cancelled = false;
    setHydrationError(null);
    if (activeId) {
      listMessagesForChat(activeId)
        .then((messages) => {
          if (cancelled) return;
          setChat(
            activeId,
            messages.map((m) => ({
              id: m.id,
              role: m.role as 'user' | 'assistant',
              content:
                typeof m.contentJson === 'string' ? m.contentJson : JSON.stringify(m.contentJson),
              model: m.model ?? undefined,
              state: 'done' as const,
            })),
          );
        })
        .catch((err: unknown) => {
          if (cancelled) return;
          setHydrationError(
            err instanceof Error
              ? err.message
              : "Couldn't load transcript. Try switching sessions.",
          );
        });
    } else {
      setChat(null, []);
    }
    return () => {
      cancelled = true;
    };
  }, [activeId, setChat]);

  const {
    pending: pendingDeletes,
    isPending: isDeletePending,
    scheduleDelete,
    undo: undoDelete,
  } = useSoftDelete(remove, { timeoutMs: 5_000 });

  const {
    generate: transcriptGenerate,
    retry: transcriptRetry,
    messages: transcriptMessages,
  } = transcript;
  const onGenerate = useCallback(
    async (text: string) => {
      let chatId = activeId;
      if (!chatId) {
        if (!chapterId) return;
        const chat = await create();
        chatId = chat.id;
        setActiveId(chatId);
      }
      const isFirstTurn = transcriptMessages.length === 0;
      await transcriptGenerate(chatId, text);
      if (isFirstTurn) {
        const title = truncateAtWordBoundary(text, TITLE_MAX_CHARS);
        try {
          await patchChatApi(chatId, title);
        } catch {
          // non-fatal — session remains usable without a title
        }
      }
    },
    [activeId, chapterId, create, transcriptGenerate, transcriptMessages],
  );

  const onRetry = useCallback(async () => {
    if (!activeId) return;
    await transcriptRetry(activeId);
  }, [activeId, transcriptRetry]);

  const onInsert = useCallback(
    (text: string) => {
      if (!editor) return;
      const docEnd = editor.state.doc.content.size;
      editor.chain().focus().insertContentAt(docEnd, text).run();
    },
    [editor],
  );

  const onCopy = useCallback((text: string) => {
    void navigator.clipboard.writeText(text);
  }, []);

  const onDelete = useCallback(
    (id: string) => {
      const session = sessions.find((s) => s.id === id);
      if (!session) return;
      scheduleDelete(id, session.title ?? 'Untitled');
      if (activeId === id) {
        const remaining = sessions.filter((s) => s.id !== id);
        setActiveId(remaining[0]?.id ?? null);
      }
    },
    [sessions, scheduleDelete, activeId],
  );

  const onUndo = useCallback(
    (id: string) => {
      undoDelete(id);
    },
    [undoDelete],
  );

  const visibleSessions = sessions.filter((s) => !isDeletePending(s.id));

  const lastUndoEntry = (() => {
    if (pendingDeletes.size === 0) return null;
    const entries = Array.from(pendingDeletes.entries());
    return entries[entries.length - 1];
  })();

  return (
    <div className="flex flex-col h-full" data-testid="scene-tab">
      {/* [A2] useScenes query error — renders above (or instead of) the picker */}
      {scenesError !== null ? (
        <div className="px-3 py-2">
          <InlineErrorBanner
            error={{ code: null, message: scenesError.message || 'Failed to load scene sessions.' }}
          />
        </div>
      ) : (
        <SceneSessionPicker
          sessions={visibleSessions.map((s) => ({
            id: s.id,
            title: s.title ?? 'Untitled',
            updatedAt: s.updatedAt,
          }))}
          activeSessionId={activeId}
          onSelect={setActiveId}
          onRename={(id, title) => {
            void rename(id, title);
          }}
          onDelete={onDelete}
          onNew={() => {
            void create().then((c) => {
              setActiveId(c.id);
            });
          }}
        />
      )}

      {lastUndoEntry !== null && (
        <div
          className="mx-3 my-2 bg-ink text-bg rounded-[var(--radius)] px-3 py-2 flex items-center gap-3 text-[12px] shadow-pop"
          role="status"
        >
          <span className="flex-1">Deleted &ldquo;{lastUndoEntry[1].title}&rdquo;</span>
          <button
            type="button"
            onClick={() => {
              onUndo(lastUndoEntry[0]);
            }}
            className="font-mono text-[11px] underline"
          >
            Undo
          </button>
        </div>
      )}

      <section className="flex-1 min-h-0 overflow-y-auto p-3 flex flex-col gap-4">
        {/* [A1] Venice generation error banner */}
        {transcript.streamState === 'error' && transcript.errorMessage !== null && (
          <InlineErrorBanner
            error={{ code: null, message: transcript.errorMessage }}
            onDismiss={() => {
              useSceneTranscriptStore.getState().resetStream();
            }}
          />
        )}

        {/* [A3] Transcript hydration error (listMessagesForChat rejection) */}
        {hydrationError !== null && (
          <InlineErrorBanner
            error={{ code: null, message: hydrationError }}
            onRetry={() => {
              if (activeId) {
                setHydrationError(null);
                listMessagesForChat(activeId)
                  .then((messages) => {
                    setChat(
                      activeId,
                      messages.map((m) => ({
                        id: m.id,
                        role: m.role as 'user' | 'assistant',
                        content:
                          typeof m.contentJson === 'string'
                            ? m.contentJson
                            : JSON.stringify(m.contentJson),
                        model: m.model ?? undefined,
                        state: 'done' as const,
                      })),
                    );
                  })
                  .catch((err: unknown) => {
                    setHydrationError(
                      err instanceof Error
                        ? err.message
                        : "Couldn't load transcript. Try switching sessions.",
                    );
                  });
              }
            }}
          />
        )}

        {transcript.streamState !== 'error' &&
        hydrationError === null &&
        transcript.messages.length === 0 ? (
          <div className="m-auto flex flex-col items-center gap-3 text-center">
            <div className="font-serif italic text-[15px] text-ink-3 max-w-[280px]">
              Describe what happens next — a scene, a beat, an action — and the assistant will draft
              it in your voice.
            </div>
            <div className="text-[11px] font-mono text-ink-4">
              Try: &ldquo;Jenny approaches Linda on the veranda and they talk about cheese.&rdquo;
            </div>
          </div>
        ) : transcript.streamState !== 'error' && hydrationError === null ? (
          renderTranscript(transcript.messages, onInsert, onRetry, onCopy)
        ) : null}
      </section>

      <SceneComposer
        state={transcript.streamState === 'streaming' ? 'streaming' : 'idle'}
        onGenerate={onGenerate}
        onStop={transcript.stop}
      />
    </div>
  );
}
