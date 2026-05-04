// [F51 + F52] EditorPage — AppShell shell with FormatBar + Paper editor.
//
// Survivor list (F7 → F51 → F52):
//   - useStoryQuery(activeStoryId)        → breadcrumbs (TopBar)
//   - useChaptersQuery(storyId)           → ChapterList + Export + word-count footer
//   - useChapterQuery(activeChapterId)    → Paper bodyJson source (F52)
//   - useUpdateChapterMutation            → autosave PATCH (F52)
//   - useCharactersQuery(storyId)         → CastTab body
//   - useVeniceAccountQuery()             → UserMenu balance
//   - useSessionStore(user)               → UserMenu username
//   - useAuth().logout + navigate         → sign out
//   - useActiveChapterStore               → ChapterList selection
//   - useSidebarTabStore                  → active tab
//   - <CharacterSheet> modal              → page-root, id-driven
//   - <FormatBar> + <Paper>               → editor slot (F52 — replaces F8)
//   - <ChatPanel> (ChatMessages + ChatComposer + ModelPicker) → chat slot (F55)
//   - <Export>                            → rendered below Paper (until F52 promote)
//
// Modal-mount convention (locked in F51 for the rest of the F-series):
//   page-level useState per modal; callback prop down via TopBar / Sidebar /
//   ChatPanel; <Modal /> rendered at the bottom of the component, NOT inside
//   AppShell. F55 mounts <SettingsModal>, <StoryPicker>, <ModelPicker> here;
//   F61 mounts <AccountPrivacyModal>.

import { useQueryClient } from '@tanstack/react-query';
import type { JSONContent, Editor as TiptapEditor } from '@tiptap/core';
import type { JSX } from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { AccountPrivacyModal } from '@/components/AccountPrivacyModal';
import { AppShell } from '@/components/AppShell';
import { CastTab } from '@/components/CastTab';
import { ChapterList } from '@/components/ChapterList';
import {
  CharacterPopoverHost,
  type CharacterPopoverHostHandle,
} from '@/components/CharacterPopoverHost';
import { CharacterSheet } from '@/components/CharacterSheet';
import { ChatComposer, type SendArgs as ChatSendArgs } from '@/components/ChatComposer';
import { ChatMessages } from '@/components/ChatMessages';
import { ChatPanel } from '@/components/ChatPanel';
import { ContinueWriting } from '@/components/ContinueWriting';
import { Export, type ExportStory } from '@/components/Export';
import { FormatBar } from '@/components/FormatBar';
import { InlineAIResult } from '@/components/InlineAIResult';
import { ModelPicker } from '@/components/ModelPicker';
import { OutlineTab } from '@/components/OutlineTab';
import { Paper } from '@/components/Paper';
import { type SelectionAction, SelectionBubble } from '@/components/SelectionBubble';
import { SettingsModal } from '@/components/Settings';
import { Sidebar } from '@/components/Sidebar';
import { StoryPicker } from '@/components/StoryPicker';
import { TopBar } from '@/components/TopBar';
import { type RunArgs, useAICompletion } from '@/hooks/useAICompletion';
import { useAuth } from '@/hooks/useAuth';
import { useAutosave } from '@/hooks/useAutosave';
import {
  type Chapter,
  chapterQueryKey,
  useChapterQuery,
  useChaptersQuery,
  useUpdateChapterMutation,
} from '@/hooks/useChapters';
import { useCharactersQuery } from '@/hooks/useCharacters';
import {
  useChatMessagesQuery,
  useChatsQuery,
  useCreateChatMutation,
  useSendChatMessageMutation,
} from '@/hooks/useChat';
import { useStoryQuery } from '@/hooks/useStories';
import { useUserSettings } from '@/hooks/useUserSettings';
import { useVeniceAccountQuery } from '@/hooks/useVeniceAccount';
import { ApiError, api } from '@/lib/api';
import { triggerAskAI } from '@/lib/askAi';
import { checkChatSendGuards } from '@/lib/chatSendGuards';
import { useActiveChapterStore } from '@/store/activeChapter';
import { useAttachedSelectionStore } from '@/store/attachedSelection';
import { useErrorStore } from '@/store/errors';
import { useInlineAIResultStore } from '@/store/inlineAIResult';
import { useSelectedCharacterStore } from '@/store/selectedCharacter';
import { useSessionStore } from '@/store/session';

function extractSelection(editor: TiptapEditor): string {
  const { from, to } = editor.state.selection;
  if (from === to) return '';
  return editor.state.doc.textBetween(from, to, ' ');
}

export function EditorPage(): JSX.Element {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const queryClient = useQueryClient();
  const storyQuery = useStoryQuery(id);
  const story = storyQuery.data;
  const chaptersQuery = useChaptersQuery(story?.id);
  const charactersQuery = useCharactersQuery(story?.id);
  const balanceQuery = useVeniceAccountQuery();
  const balanceErrorCode =
    balanceQuery.error instanceof ApiError ? (balanceQuery.error.code ?? null) : null;

  const username = useSessionStore((s) => s.user?.username) ?? '';
  const { logout } = useAuth();
  const handleSignOut = useCallback((): void => {
    void logout().finally(() => {
      navigate('/login');
    });
  }, [logout, navigate]);

  const activeChapterId = useActiveChapterStore((s) => s.activeChapterId);
  const setActiveChapterId = useActiveChapterStore((s) => s.setActiveChapterId);
  const setSelectedCharacterId = useSelectedCharacterStore((s) => s.setSelectedCharacterId);

  // Clear cast selection when the active chapter or story changes — keeps
  // the inline-delete affordance scoped to a single editing context. The deps
  // are triggers, not values read by the body; the lint exhaustive-deps check
  // can't tell the difference.
  // biome-ignore lint/correctness/useExhaustiveDependencies: triggers, not value reads.
  useEffect(() => {
    setSelectedCharacterId(null);
  }, [activeChapterId, story?.id, setSelectedCharacterId]);

  const [editor, setEditor] = useState<TiptapEditor | null>(null);
  // Paper passes `null` on unmount (chapter switch via key={chapterId}); we
  // must drop the destroyed instance immediately so FormatBar / InlineAIResult
  // don't read `editor.isActive(...)` on a torn-down TipTap instance.
  const handleEditorReady = useCallback((ed: TiptapEditor | null) => {
    setEditor(ed);
  }, []);

  // [F19 + F28] Character sheet modal — discriminated state covers both edit
  // (existing id) and create (new) modes. null = closed.
  type CharacterModalState = { mode: 'edit'; id: string } | { mode: 'create' } | null;
  const [characterModal, setCharacterModal] = useState<CharacterModalState>(null);

  // [F54] Character popover host — opened from charRef hover (F36 dispatcher,
  // wired inside the host) and from Cast-tab clicks (imperative ref).
  const characterPopoverRef = useRef<CharacterPopoverHostHandle | null>(null);
  const handleOpenCharacterFromCast = useCallback((id: string, el: HTMLElement) => {
    characterPopoverRef.current?.openFor(id, el);
  }, []);
  const handleEditCharacter = useCallback((id: string) => {
    setCharacterModal({ mode: 'edit', id });
  }, []);
  const handleCreateCharacter = useCallback(() => {
    setCharacterModal({ mode: 'create' });
  }, []);

  // [F55] Page-root modal state. The page renders each modal at the bottom
  // of its JSX; TopBar / Sidebar / ChatPanel callbacks flip these flags.
  const [storyPickerOpen, setStoryPickerOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [modelPickerOpen, setModelPickerOpen] = useState(false);
  // [F61] Account & privacy modal state — same page-root convention.
  const [accountPrivacyOpen, setAccountPrivacyOpen] = useState(false);

  const selectedModelId = useUserSettings().chat.model;
  const completion = useAICompletion();

  // [F55] Chat surface wiring. Active chat = first chat for the active chapter
  // (until a per-chapter "remembered chat" slice is added). Sending a message
  // creates a chat on the fly when none exists.
  const chatsQuery = useChatsQuery(activeChapterId ?? null);
  const activeChatId = chatsQuery.data?.[0]?.id ?? null;
  const chatMessages = useChatMessagesQuery(activeChatId);
  void chatMessages; // ChatMessages reads from the cache directly via chatId
  const createChat = useCreateChatMutation();
  const sendChatMessage = useSendChatMessageMutation();
  const attachedSelection = useAttachedSelectionStore((s) => s.attachedSelection);
  const clearAttachedSelection = useAttachedSelectionStore((s) => s.clear);

  const handleNewChat = useCallback(async (): Promise<void> => {
    if (!activeChapterId) return;
    await createChat.mutateAsync({ chapterId: activeChapterId });
  }, [activeChapterId, createChat]);

  const lastChatSendArgsRef = useRef<ChatSendArgs | null>(null);

  const handleChatSend = useCallback(
    async (args: ChatSendArgs): Promise<void> => {
      const guard = checkChatSendGuards({ activeChapterId, selectedModelId });
      if (guard) {
        useErrorStore.getState().push(guard);
        return;
      }
      // After the guard, both fields are non-null. Narrow for TS.
      const chapterId = activeChapterId as string;
      const modelId = selectedModelId as string;

      let chatId = activeChatId;
      if (!chatId) {
        const created = await createChat.mutateAsync({ chapterId });
        chatId = created.id;
      }
      if (!chatId) {
        useErrorStore.getState().push({
          severity: 'warn',
          source: 'chat.send',
          code: 'no_chat',
          message: 'Could not create a chat — try again.',
        });
        return;
      }

      lastChatSendArgsRef.current = args;
      const attachment = args.attachment
        ? {
            selectionText: args.attachment.text,
            chapterId: args.attachment.chapter.id,
          }
        : undefined;
      const sendArgs: Parameters<typeof sendChatMessage.mutateAsync>[0] = {
        chatId,
        content: args.content,
        modelId,
        enableWebSearch: args.enableWebSearch,
      };
      if (attachment) sendArgs.attachment = attachment;
      await sendChatMessage.mutateAsync(sendArgs);
      // Composer keeps its own state; clear the attached selection chip after
      // a successful send so the next turn starts fresh.
      clearAttachedSelection();
    },
    [
      activeChapterId,
      activeChatId,
      createChat,
      selectedModelId,
      sendChatMessage,
      clearAttachedSelection,
    ],
  );

  const handleRetryChatSend = useCallback((): void => {
    const last = lastChatSendArgsRef.current;
    if (!last) return;
    void handleChatSend(last);
  }, [handleChatSend]);

  const handleStoryPickerSelect = useCallback(
    (id: string): void => {
      setStoryPickerOpen(false);
      navigate(`/stories/${id}`);
    },
    [navigate],
  );

  // [F52] Active chapter content is read via the cache-first single-chapter
  // query, then mirrored into local state so Paper's onUpdate can mutate it
  // without re-rendering through TanStack Query on every keystroke. Autosave
  // observes the local state.
  const chapterQuery = useChapterQuery(activeChapterId ?? null, story?.id);
  const updateChapter = useUpdateChapterMutation();
  const [draftBodyJson, setDraftBodyJson] = useState<JSONContent | null>(null);
  const lastWordCountRef = useRef<number>(0);

  // [T8.1] Seed the local draft exactly once per active-chapter switch — not
  // on every chapterQuery.data reference change. The earlier shape (deps:
  // [activeChapterId, chapterQuery.data]) was racy: typing into a freshly-
  // created chapter would race a late-arriving chapterQuery.data resolve,
  // and the second run of this effect wiped `draftBodyJson` back to the
  // server's empty body before the 4s autosave debounce fired. Tracking the
  // last-seeded chapter id makes the seed strictly idempotent per chapter
  // while still re-seeding on chapter switch.
  //
  // For chapters that load with `bodyJson === null` (freshly created), seed
  // with the canonical empty TipTap doc instead of null — `useAutosave`
  // treats the first *non-null* payload as a baseline (no save fires) and
  // ignores null entirely, so seeding with null leaves the user's first
  // keystroke being mistaken for the baseline. The empty-doc seed gives
  // autosave a real baseline to diff against, and the user's first typed
  // character correctly schedules a PATCH.
  const seededForChapterIdRef = useRef<string | null>(null);
  useEffect(() => {
    if (activeChapterId === null) {
      seededForChapterIdRef.current = null;
      setDraftBodyJson(null);
      lastWordCountRef.current = 0;
      return;
    }
    if (seededForChapterIdRef.current === activeChapterId) return;
    if (chapterQuery.data === undefined) return;
    seededForChapterIdRef.current = activeChapterId;
    const serverBody = chapterQuery.data.bodyJson as JSONContent | null;
    const seed: JSONContent = serverBody ?? { type: 'doc', content: [{ type: 'paragraph' }] };
    setDraftBodyJson(seed);
    lastWordCountRef.current = chapterQuery.data.wordCount ?? 0;
  }, [activeChapterId, chapterQuery.data]);

  const handleSave = useCallback(
    async (value: JSONContent): Promise<void> => {
      if (!story?.id || !activeChapterId) return;
      // [T8.1] Don't send `wordCount` — the backend's `UpdateChapterBody`
      // schema is `.strict()` and rejects the extra key with 400, and the
      // chapter route already recomputes wordCount server-side from
      // `bodyJson` (see `chapters.routes.ts:242`). The local
      // `lastWordCountRef` still feeds the topbar word-count display.
      await updateChapter.mutateAsync({
        storyId: story.id,
        chapterId: activeChapterId,
        input: { bodyJson: value },
      });
    },
    [story?.id, activeChapterId, updateChapter],
  );

  const autosave = useAutosave<JSONContent>({
    payload: draftBodyJson,
    save: handleSave,
    // Treat each chapter as its own document — switching chapters resets the
    // baseline so the new chapter's freshly-loaded body isn't mistaken for a
    // dirty edit of the old one (which would fire a spurious PATCH and, if a
    // save was in flight during the switch, could land the new body under the
    // new chapter id via the pending-follow-up branch).
    resetKey: activeChapterId,
  });

  const handlePaperUpdate = useCallback(
    ({ bodyJson, wordCount }: { bodyJson: JSONContent; wordCount: number }): void => {
      lastWordCountRef.current = wordCount;
      setDraftBodyJson(bodyJson);
    },
    [],
  );

  const handleChapterTitleChange = useCallback(
    (chapterId: string, title: string): void => {
      // The chapter id is bound from `<ChapterTitleInput>`'s closure (Paper)
      // rather than read from `activeChapterId` here, so a blur fired during
      // a chapter switch still PATCHes the chapter the user was renaming.
      if (!story?.id) return;
      // Mutation's onSuccess refreshes both the chapters list cache and the
      // single-chapter cache, so the sidebar list re-renders with the new title.
      void updateChapter.mutateAsync({
        storyId: story.id,
        chapterId,
        input: { title },
      });
    },
    [story?.id, updateChapter],
  );

  // [F53] inline-result store wiring; full handler defined after activeChapter
  // is derived (the handler reads activeChapter.orderIndex / title for the
  // ask-AI delegation).
  const setInlineAIResult = useInlineAIResultStore((s) => s.setInlineAIResult);
  const clearInlineAIResult = useInlineAIResultStore((s) => s.clear);
  const lastRunArgsRef = useRef<RunArgs | null>(null);
  const ACTION_MAP: Record<Exclude<SelectionAction, 'ask'>, RunArgs['action']> = useMemo(
    () => ({
      rewrite: 'rephrase',
      describe: 'summarise',
      expand: 'expand',
    }),
    [],
  );

  const exportStory: ExportStory | null = useMemo(() => {
    if (!story) return null;
    const chapters = chaptersQuery.data ?? [];
    // List cache is metadata-only; bodies are resolved lazily by Export via
    // `resolveExportBody` below, which hits the per-chapter cache (or fetches
    // on miss).
    return {
      id: story.id,
      title: story.title,
      chapters: chapters.map((c) => ({
        id: c.id,
        title: c.title,
        orderIndex: c.orderIndex,
      })),
    };
  }, [story, chaptersQuery.data]);

  const resolveExportBody = useCallback(
    async (chapterId: string): Promise<JSONContent | null> => {
      if (!story?.id) return null;
      // `fetchQuery` returns cached data when fresh, otherwise issues one
      // `GET /chapters/:id`. Same staleTime as `useChapterQuery` so the
      // dedupe behaviour matches the editor mount path.
      const chapter = await queryClient.fetchQuery<Chapter>({
        queryKey: chapterQueryKey(chapterId),
        queryFn: async () => {
          const res = await api<{ chapter: Chapter }>(
            `/stories/${encodeURIComponent(story.id)}/chapters/${encodeURIComponent(chapterId)}`,
          );
          return res.chapter;
        },
        staleTime: 30_000,
      });
      return (chapter.bodyJson as JSONContent | null) ?? null;
    },
    [queryClient, story?.id],
  );

  const totalWordCount = useMemo(() => {
    return (chaptersQuery.data ?? []).reduce((sum, c) => sum + (c.wordCount ?? 0), 0);
  }, [chaptersQuery.data]);

  const activeChapter = chaptersQuery.data?.find((c) => c.id === activeChapterId) ?? null;

  const handleSelectionAction = useCallback(
    (action: SelectionAction): void => {
      if (!editor || !story?.id || activeChapterId === null) return;
      const text = extractSelection(editor);
      if (text.trim().length === 0) return;

      if (action === 'ask') {
        if (!activeChapter) return;
        triggerAskAI({
          selectionText: text,
          chapter: {
            id: activeChapter.id,
            number: activeChapter.orderIndex + 1,
            title: activeChapter.title,
          },
        });
        return;
      }

      if (selectedModelId === null) {
        setInlineAIResult({
          action,
          text,
          status: 'error',
          output: '',
          error: {
            code: 'no_model',
            message: 'No model selected. Open the model picker to choose one.',
          },
        });
        return;
      }

      const args: RunArgs = {
        action: ACTION_MAP[action],
        selectedText: text,
        chapterId: activeChapterId,
        storyId: story.id,
        modelId: selectedModelId,
      };
      lastRunArgsRef.current = args;
      setInlineAIResult({ action, text, status: 'thinking', output: '' });
      void completion.run(args);
    },
    [
      editor,
      story?.id,
      activeChapterId,
      activeChapter,
      selectedModelId,
      completion,
      setInlineAIResult,
      ACTION_MAP,
    ],
  );

  const handleInlineRetry = useCallback((): void => {
    const args = lastRunArgsRef.current;
    if (!args) return;
    const bubbleAction = (Object.entries(ACTION_MAP).find(([, v]) => v === args.action)?.[0] ??
      'rewrite') as Exclude<SelectionAction, 'ask'>;
    setInlineAIResult({
      action: bubbleAction,
      text: args.selectedText,
      status: 'thinking',
      output: '',
    });
    void completion.run(args);
  }, [completion, setInlineAIResult, ACTION_MAP]);

  // Mirror the streaming completion into the inline-result store so
  // <InlineAIResult> renders progressive output and final state. Guarded by
  // `if (!prev) return;` so AIPanel-driven runs (F12) don't seed the card.
  useEffect(() => {
    if (completion.status === 'idle') return;
    const prev = useInlineAIResultStore.getState().inlineAIResult;
    if (!prev) return;
    // 'thinking' is set directly by handleInlineAction / handleInlineRetry
    // before run() is called; no mirror needed here.
    if (completion.status === 'streaming') {
      setInlineAIResult({ ...prev, status: 'streaming', output: completion.text });
    } else if (completion.status === 'done') {
      setInlineAIResult({ ...prev, status: 'done', output: completion.text });
    } else if (completion.status === 'error') {
      const err = completion.error;
      setInlineAIResult({
        ...prev,
        status: 'error',
        output: '',
        error: err
          ? { code: err.code ?? null, message: err.message, httpStatus: err.status }
          : { code: null, message: 'AI request failed.' },
      });
    }
  }, [completion.status, completion.text, completion.error, setInlineAIResult]);

  // Cancel + clear the inline card on chapter / story switch so a half-streamed
  // rewrite doesn't bleed into the next chapter.
  // biome-ignore lint/correctness/useExhaustiveDependencies: activeChapterId / story?.id are trigger deps — the body intentionally just clears, regardless of value
  useEffect(() => {
    clearInlineAIResult();
    lastRunArgsRef.current = null;
  }, [activeChapterId, story?.id, clearInlineAIResult]);

  if (storyQuery.isLoading) {
    return (
      <div
        role="status"
        aria-live="polite"
        data-testid="editor-page-loading"
        className="min-h-screen flex items-center justify-center font-sans text-[13px] text-ink-3"
      >
        Loading story…
      </div>
    );
  }

  if (storyQuery.isError || !story) {
    return (
      <div
        role="alert"
        data-testid="editor-page-error"
        className="min-h-screen flex items-center justify-center px-6 text-center font-sans text-[13px] text-ink-3"
      >
        Could not load story
      </div>
    );
  }

  return (
    <>
      <AppShell
        topbar={
          <TopBar
            storyTitle={story.title}
            chapterNumber={activeChapter ? activeChapter.orderIndex + 1 : null}
            chapterTitle={activeChapter?.title ?? null}
            // [F56] Pass the F9/F48 autosave triple through; TopBar renders
            // <AutosaveIndicator> from this directly.
            autosave={{
              status: autosave.status,
              savedAt: autosave.savedAt,
              retryAt: autosave.retryAt,
            }}
            wordCount={activeChapter?.wordCount ?? null}
            onOpenSettings={() => {
              setSettingsOpen(true);
            }}
            onOpenStoriesList={() => {
              setStoryPickerOpen(true);
            }}
            onOpenAccount={() => {
              setAccountPrivacyOpen(true);
            }}
            username={username}
            balance={balanceQuery.data ?? null}
            isBalanceLoading={balanceQuery.isLoading}
            isBalanceError={balanceQuery.isError}
            balanceErrorCode={balanceErrorCode}
            onSignOut={handleSignOut}
          />
        }
        sidebar={
          <Sidebar
            storyTitle={story.title}
            totalWordCount={totalWordCount}
            goalWordCount={story.targetWords ?? undefined}
            chaptersCount={chaptersQuery.data?.length ?? null}
            castCount={charactersQuery.data?.length ?? null}
            onOpenStoryPicker={() => {
              setStoryPickerOpen(true);
            }}
            chaptersBody={
              <ChapterList
                storyId={story.id}
                activeChapterId={activeChapterId}
                onSelectChapter={setActiveChapterId}
                onChapterDeleted={(deletedId) => {
                  if (deletedId === activeChapterId) setActiveChapterId(null);
                }}
              />
            }
            castBody={
              <CastTab
                storyId={story.id}
                characters={charactersQuery.data ?? []}
                onOpenCharacter={handleOpenCharacterFromCast}
                onCreateCharacter={handleCreateCharacter}
                isLoading={charactersQuery.isLoading}
                isError={charactersQuery.isError}
              />
            }
            outlineBody={
              <OutlineTab
                storyId={story.id}
                onAddItem={() => undefined}
                onEditItem={() => undefined}
              />
            }
          />
        }
        editor={
          <div className="flex h-full flex-col">
            <FormatBar editor={editor} />
            <div className="flex-1 overflow-y-auto">
              {activeChapterId ? (
                <Paper
                  // Key on chapterId so switching chapters tears down the
                  // previous TipTap editor and mounts a fresh one seeded
                  // with the new chapter's body. Without this, useEditor
                  // retains its initial content across chapter switches and
                  // the in-place setContent effect skips empty bodies — the
                  // user sees the old chapter's text under the new title.
                  key={activeChapterId}
                  storyTitle={story.title}
                  storyGenre={story.genre}
                  storyWordCount={totalWordCount}
                  chapterId={activeChapterId}
                  chapterNumber={activeChapter ? activeChapter.orderIndex + 1 : null}
                  chapterTitle={activeChapter?.title ?? null}
                  initialBodyJson={(chapterQuery.data?.bodyJson as JSONContent | null) ?? null}
                  onUpdate={handlePaperUpdate}
                  onReady={handleEditorReady}
                  onChapterTitleChange={handleChapterTitleChange}
                />
              ) : (
                <div
                  data-testid="editor-empty-state"
                  className="grid h-full place-items-center px-6 text-center text-[13px] text-ink-4"
                >
                  Select a chapter from the sidebar to start writing.
                </div>
              )}
              {/* [F53] Inline AI result card — driven by <SelectionBubble>
                  via useInlineAIResultStore. Renders nothing when the store
                  is empty. */}
              <div className="mx-auto w-full max-w-[720px] px-6">
                <InlineAIResult editor={editor} onRetry={handleInlineRetry} />
              </div>
              {/* [F53] Continue-writing pill — ⌥+Enter or click to extend
                  the prose at the cursor. Only mounts when we have the
                  required context. */}
              {activeChapterId !== null && story.id && selectedModelId !== null ? (
                <div className="mx-auto w-full max-w-[720px] px-6">
                  <ContinueWriting
                    editor={editor}
                    storyId={story.id}
                    chapterId={activeChapterId}
                    modelId={selectedModelId}
                  />
                </div>
              ) : null}
              {exportStory ? (
                <div className="mx-auto mt-4 flex w-full max-w-[720px] justify-end px-6 pb-6">
                  <Export
                    story={exportStory}
                    activeChapterId={activeChapterId}
                    resolveBody={resolveExportBody}
                  />
                </div>
              ) : null}
            </div>
          </div>
        }
        chat={
          <ChatPanel
            messagesBody={
              <ChatMessages
                chatId={activeChatId}
                chapterTitle={activeChapter?.title ?? null}
                attachedCharacterCount={attachedSelection?.text.length ?? 0}
                attachedTokenCount={Math.ceil((attachedSelection?.text.length ?? 0) / 4)}
                sendError={sendChatMessage.error}
                onRetrySend={handleRetryChatSend}
              />
            }
            composer={<ChatComposer onSend={handleChatSend} disabled={sendChatMessage.isPending} />}
            onOpenModelPicker={() => {
              setModelPickerOpen(true);
            }}
            onNewChat={handleNewChat}
            onOpenSettings={() => {
              setSettingsOpen(true);
            }}
          />
        }
      />

      {characterModal?.mode === 'edit' ? (
        <CharacterSheet
          storyId={story.id}
          mode="edit"
          characterId={characterModal.id}
          onClose={() => {
            setCharacterModal(null);
          }}
        />
      ) : null}
      {characterModal?.mode === 'create' ? (
        <CharacterSheet
          storyId={story.id}
          mode="create"
          onClose={(createdId) => {
            setCharacterModal(null);
            if (createdId !== null) {
              setSelectedCharacterId(createdId);
            }
          }}
        />
      ) : null}

      {/* [F54] Character popover — opened from charRef hover and Cast clicks.
          Edit footer routes back into the F19 character sheet. */}
      <CharacterPopoverHost
        storyId={story.id}
        hostRef={characterPopoverRef}
        onEdit={handleEditCharacter}
      />

      {/* [F53] Selection bubble — listens for prose selections inside the
          .paper-prose region and absolute-positions itself over the
          selection. Page-root mount keeps it free of editor-slot overflow. */}
      <SelectionBubble proseSelector=".paper-prose" onAction={handleSelectionAction} />

      {/* [F55] Page-root modals. */}
      <StoryPicker
        open={storyPickerOpen}
        onClose={() => {
          setStoryPickerOpen(false);
        }}
        activeStoryId={story.id}
        onSelectStory={handleStoryPickerSelect}
      />
      <ModelPicker
        open={modelPickerOpen}
        onClose={() => {
          setModelPickerOpen(false);
        }}
      />
      <SettingsModal
        open={settingsOpen}
        onClose={() => {
          setSettingsOpen(false);
        }}
        onOpenModelPicker={() => {
          setModelPickerOpen(true);
        }}
      />
      <AccountPrivacyModal
        open={accountPrivacyOpen}
        onClose={() => {
          setAccountPrivacyOpen(false);
        }}
        username={username}
      />
    </>
  );
}
