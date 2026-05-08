/**
 * [SC17] SceneTab — orchestrator for the scene-generation workflow.
 *
 * Wires together:
 *  - SessionPicker (session CRUD + selection)
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
import { type JSX, useCallback, useEffect, useRef, useState } from 'react';
import { InlineErrorBanner } from '@/components/InlineErrorBanner';
import { SceneCandidateCard } from '@/components/SceneCandidateCard';
import { SceneComposer } from '@/components/SceneComposer';
import { SessionPicker, type SessionPickerLabels } from '@/components/SessionPicker';
import { useModelsQuery } from '@/hooks/useModels';
import { useScenes } from '@/hooks/useScenes';
import { useSceneTranscript } from '@/hooks/useSceneTranscript';
import { useSoftDelete } from '@/hooks/useSoftDelete';
import { useUserSettings } from '@/hooks/useUserSettings';
import { listMessagesForChat } from '@/lib/api';
import type { SceneMessage } from '@/store/sceneTranscript';
import { useSceneTranscriptStore } from '@/store/sceneTranscript';
import { SceneUndoToast } from './SceneUndoToast';

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

/**
 * Walk assistant-first so every assistant message — including a retry's new
 * streaming row that has no paired user row of its own — gets rendered.
 *
 * Direction de-duplication (option a): when consecutive candidates share the
 * same direction text, pass `direction={null}` on all but the first card so the
 * direction bubble is suppressed. This avoids repeated bubbles stacking visually
 * for the same turn while keeping the layout simple.
 */
function renderTranscript(
  messages: SceneMessage[],
  onInsert: (text: string) => void,
  onRetry: () => void,
  onCopy: (text: string) => void,
): JSX.Element[] {
  const cards: JSX.Element[] = [];
  let lastUserContent: string | null = null;
  let prevDirectionShown: string | null = null;

  // Pre-compute the index of the last assistant message so isLatest is correct
  // even when the array ends on a user message (e.g. after failAssistant removes
  // the streaming row, leaving [user, assistant_done, user]).
  let lastAssistantIdx = -1;
  for (let j = messages.length - 1; j >= 0; j--) {
    if (messages[j].role === 'assistant') {
      lastAssistantIdx = j;
      break;
    }
  }

  for (let i = 0; i < messages.length; i++) {
    const m = messages[i];
    if (m.role === 'user') {
      lastUserContent = m.content;
      continue;
    }
    if (m.role !== 'assistant') continue;
    if (lastUserContent === null) continue; // orphaned assistant — shouldn't happen

    const isLatest = i === lastAssistantIdx;
    const state = m.state === 'streaming' ? ('streaming' as const) : ('done' as const);

    // Show direction bubble only on the first card per direction string.
    const direction = lastUserContent === prevDirectionShown ? null : lastUserContent;
    prevDirectionShown = lastUserContent;

    cards.push(
      <SceneCandidateCard
        key={m.id}
        direction={direction}
        candidate={m.content}
        state={state}
        isLatest={isLatest}
        model={m.model}
        onInsert={() => {
          onInsert(m.content);
        }}
        onRetry={onRetry}
        onCopy={() => {
          onCopy(m.content);
        }}
      />,
    );
  }
  return cards;
}

const SCENE_LABELS: SessionPickerLabels = {
  kindLabel: 'SCENE',
  ariaPrefix: 'Scene session: ',
  dropdownHeader: 'Scenes in this chapter',
  newButtonLabel: 'New scene',
};

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

  // Tracks which chatId the transcript store is already in sync with. When
  // onGenerate creates a new chat, it primes the store and sets this ref
  // BEFORE calling setActiveId — so the hydration effect sees that the chatId
  // is already hydrated and skips the round-trip that would wipe streaming state.
  const hydratedChatIdRef = useRef<string | null>(null);

  // Load messages whenever the active session changes.
  useEffect(() => {
    let cancelled = false;
    setHydrationError(null);
    if (activeId) {
      // Skip the fetch if we already seeded the store for this chatId (e.g.
      // right after creating a new chat in onGenerate — the streaming rows
      // are already in the store and a round-trip would wipe them).
      if (hydratedChatIdRef.current === activeId) return;
      listMessagesForChat(activeId)
        .then((messages) => {
          if (cancelled) return;
          hydratedChatIdRef.current = activeId;
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
      hydratedChatIdRef.current = null;
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
        // Prime the store with the new chatId BEFORE setActiveId fires a
        // re-render. This prevents the hydration effect from seeing an
        // un-hydrated chatId and wiping the streaming rows that generate()
        // is about to append.
        hydratedChatIdRef.current = chatId;
        setChat(chatId, []);
        setActiveId(chatId);
      }
      const isFirstTurn = transcriptMessages.length === 0;
      await transcriptGenerate(chatId, text);
      if (isFirstTurn) {
        const title = truncateAtWordBoundary(text, TITLE_MAX_CHARS);
        try {
          await rename(chatId, title);
        } catch {
          // non-fatal — session remains usable without a title
        }
      }
    },
    [activeId, chapterId, create, rename, transcriptGenerate, transcriptMessages, setChat],
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

  // ── Autoscroll ──────────────────────────────────────────────────────────────
  // Keep the transcript viewport pinned to the bottom as new messages or
  // streaming deltas arrive. If the user manually scrolls up (more than 50px
  // from the bottom), stop auto-scrolling so they can read earlier content.
  const transcriptRef = useRef<HTMLElement>(null);
  const stickToBottomRef = useRef(true);

  // Reset autoscroll pin whenever the active session changes so that session B
  // doesn't inherit the scrolled-up state the user left in session A.
  useEffect(() => {
    stickToBottomRef.current = true;
  }, [activeId]);

  const handleTranscriptScroll = useCallback(() => {
    const el = transcriptRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    stickToBottomRef.current = distanceFromBottom < 50;
  }, []);

  useEffect(() => {
    if (stickToBottomRef.current && transcriptRef.current) {
      transcriptRef.current.scrollTop = transcriptRef.current.scrollHeight;
    }
  }, [transcript.messages]);

  const visibleSessions = sessions.filter((s) => !isDeletePending(s.id));

  const pendingEntries = Array.from(pendingDeletes.entries());
  const lastPending = pendingEntries.length > 0 ? pendingEntries[pendingEntries.length - 1] : null;

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
        <SessionPicker
          labels={SCENE_LABELS}
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

      <section
        ref={transcriptRef}
        className="flex-1 min-h-0 overflow-y-auto p-3 flex flex-col gap-4"
        onScroll={handleTranscriptScroll}
      >
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

      <div className="relative">
        {lastPending !== null && (
          <div className="absolute left-3 right-3 bottom-[calc(100%+8px)] z-20">
            <SceneUndoToast
              key={lastPending[0]}
              title={lastPending[1].title}
              onUndo={() => {
                onUndo(lastPending[0]);
              }}
              timeoutMs={5000}
            />
          </div>
        )}
        <SceneComposer
          state={transcript.streamState === 'streaming' ? 'streaming' : 'idle'}
          onGenerate={onGenerate}
          onStop={transcript.stop}
        />
      </div>
    </div>
  );
}
