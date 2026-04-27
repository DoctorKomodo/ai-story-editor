// [F51 + F52] EditorPage — AppShell shell with FormatBar + Paper editor.
//
// Survivor list (F7 → F51 → F52):
//   - useStoryQuery(activeStoryId)        → breadcrumbs (TopBar)
//   - useChaptersQuery(storyId)           → ChapterList + Export + word-count footer
//   - useChapterQuery(activeChapterId)    → Paper bodyJson source (F52)
//   - useUpdateChapterMutation            → autosave PATCH (F52)
//   - useCharactersQuery(storyId)         → CastTab body
//   - useBalanceQuery()                   → UserMenu balance
//   - useSessionStore(user)               → UserMenu username
//   - useAuth().logout + navigate         → sign out
//   - useActiveChapterStore               → ChapterList selection
//   - useSidebarTabStore                  → active tab
//   - <CharacterSheet> modal              → page-root, id-driven
//   - <FormatBar> + <Paper>               → editor slot (F52 — replaces F8)
//   - <AIPanel> + ModelSelector + …       → chat slot (until F55)
//   - <Export>                            → rendered below Paper (until F52 promote)
//
// Modal-mount convention (locked in F51 for the rest of the F-series):
//   page-level useState per modal; callback prop down via TopBar / Sidebar /
//   ChatPanel; <Modal /> rendered at the bottom of the component, NOT inside
//   AppShell. F55 mounts <SettingsModal>, <StoryPicker>, <ModelPicker> here;
//   F61 mounts <AccountPrivacyModal>.

import type { JSONContent, Editor as TiptapEditor } from '@tiptap/core';
import type { JSX } from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
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
import { useBalanceQuery } from '@/hooks/useBalance';
import {
  useChapterQuery,
  useChaptersQuery,
  useCreateChapterMutation,
  useUpdateChapterMutation,
} from '@/hooks/useChapters';
import { useCharactersQuery, useCreateCharacterMutation } from '@/hooks/useCharacters';
import {
  useChatMessagesQuery,
  useChatsQuery,
  useCreateChatMutation,
  useSendChatMessageMutation,
} from '@/hooks/useChat';
import { useSelectedModel } from '@/hooks/useSelectedModel';
import { useStoryQuery } from '@/hooks/useStories';
import { ApiError } from '@/lib/api';
import { triggerAskAI } from '@/lib/askAi';
import { useActiveChapterStore } from '@/store/activeChapter';
import { useAttachedSelectionStore } from '@/store/attachedSelection';
import { useInlineAIResultStore } from '@/store/inlineAIResult';
import { useSessionStore } from '@/store/session';
import { useSidebarTabStore } from '@/store/sidebarTab';

function extractSelection(editor: TiptapEditor): string {
  const { from, to } = editor.state.selection;
  if (from === to) return '';
  return editor.state.doc.textBetween(from, to, ' ');
}

export function EditorPage(): JSX.Element {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const storyQuery = useStoryQuery(id);
  const story = storyQuery.data;
  const chaptersQuery = useChaptersQuery(story?.id);
  const charactersQuery = useCharactersQuery(story?.id);
  const balanceQuery = useBalanceQuery();
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
  const activeTab = useSidebarTabStore((s) => s.sidebarTab);

  const [editor, setEditor] = useState<TiptapEditor | null>(null);
  const handleEditorReady = useCallback((ed: TiptapEditor) => {
    setEditor(ed);
  }, []);

  // [F19] Character sheet modal is id-driven; null = closed. The sheet only
  // edits — the create path uses the create mutation directly and then opens
  // the new id here.
  const [openCharacterId, setOpenCharacterId] = useState<string | null>(null);

  // [F54] Character popover host — opened from charRef hover (F36 dispatcher,
  // wired inside the host) and from Cast-tab clicks (imperative ref).
  const characterPopoverRef = useRef<CharacterPopoverHostHandle | null>(null);
  const handleOpenCharacterFromCast = useCallback((id: string, el: HTMLElement) => {
    characterPopoverRef.current?.openFor(id, el);
  }, []);
  const handleEditCharacter = useCallback((id: string) => {
    setOpenCharacterId(id);
  }, []);

  // [F55] Page-root modal state. The page renders each modal at the bottom
  // of its JSX; TopBar / Sidebar / ChatPanel callbacks flip these flags.
  const [storyPickerOpen, setStoryPickerOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [modelPickerOpen, setModelPickerOpen] = useState(false);

  const { selectedModelId } = useSelectedModel();
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

  const handleChatSend = useCallback(
    async (args: ChatSendArgs): Promise<void> => {
      if (!activeChapterId) return;
      let chatId = activeChatId;
      if (!chatId) {
        const created = await createChat.mutateAsync({ chapterId: activeChapterId });
        chatId = created.id;
      }
      if (selectedModelId === null) return;
      const attachment = args.attachment
        ? {
            selectionText: args.attachment.text,
            chapterId: args.attachment.chapter.id,
          }
        : undefined;
      const sendArgs: Parameters<typeof sendChatMessage.mutateAsync>[0] = {
        chatId,
        content: args.content,
        modelId: selectedModelId,
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

  const handleStoryPickerSelect = useCallback(
    (id: string): void => {
      setStoryPickerOpen(false);
      navigate(`/stories/${id}`);
    },
    [navigate],
  );

  const createChapter = useCreateChapterMutation(story?.id ?? '');
  const createCharacter = useCreateCharacterMutation(story?.id ?? '');

  // [F52] Active chapter content is read via the cache-first single-chapter
  // query, then mirrored into local state so Paper's onUpdate can mutate it
  // without re-rendering through TanStack Query on every keystroke. Autosave
  // observes the local state.
  const chapterQuery = useChapterQuery(activeChapterId ?? null, story?.id);
  const updateChapter = useUpdateChapterMutation();
  const [draftBodyJson, setDraftBodyJson] = useState<JSONContent | null>(null);
  const lastWordCountRef = useRef<number>(0);

  // Reset the local draft whenever the active chapter changes.
  useEffect(() => {
    const fresh = (chapterQuery.data?.bodyJson as JSONContent | null) ?? null;
    setDraftBodyJson(fresh);
    lastWordCountRef.current = chapterQuery.data?.wordCount ?? 0;
  }, [activeChapterId, chapterQuery.data]);

  const handleSave = useCallback(
    async (value: JSONContent): Promise<void> => {
      if (!story?.id || !activeChapterId) return;
      await updateChapter.mutateAsync({
        storyId: story.id,
        chapterId: activeChapterId,
        input: { bodyJson: value, wordCount: lastWordCountRef.current },
      });
    },
    [story?.id, activeChapterId, updateChapter],
  );

  const autosave = useAutosave<JSONContent>({
    payload: draftBodyJson,
    save: handleSave,
  });

  const handlePaperUpdate = useCallback(
    ({ bodyJson, wordCount }: { bodyJson: JSONContent; wordCount: number }): void => {
      lastWordCountRef.current = wordCount;
      setDraftBodyJson(bodyJson);
    },
    [],
  );

  const handleSidebarAdd = useCallback((): void => {
    if (!story?.id) return;
    if (activeTab === 'chapters') {
      createChapter.mutate({ title: '' });
      return;
    }
    if (activeTab === 'cast') {
      createCharacter.mutate(
        { name: 'Untitled' },
        {
          onSuccess: (created) => {
            setOpenCharacterId(created.id);
          },
        },
      );
      return;
    }
    // Outline: OutlineTab owns its own add affordance via onAddItem; the
    // sidebar + button is a documented no-op for this tab.
  }, [activeTab, story?.id, createChapter, createCharacter]);

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
          output: 'No model selected. Open the model picker to choose one.',
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
    if (completion.status === 'streaming') {
      setInlineAIResult({ ...prev, status: 'streaming', output: completion.text });
    } else if (completion.status === 'done') {
      setInlineAIResult({ ...prev, status: 'done', output: completion.text });
    } else if (completion.status === 'error') {
      setInlineAIResult({
        ...prev,
        status: 'error',
        output: completion.error?.message ?? 'AI request failed.',
      });
    }
  }, [completion.status, completion.text, completion.error, setInlineAIResult]);

  // Cancel + clear the inline card on chapter / story switch so a half-streamed
  // rewrite doesn't bleed into the next chapter.
  useEffect(() => {
    clearInlineAIResult();
    lastRunArgsRef.current = null;
  }, [activeChapterId, story?.id, clearInlineAIResult]);

  if (storyQuery.isLoading) {
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

  if (storyQuery.isError || !story) {
    return (
      <div
        role="alert"
        className="min-h-screen flex items-center justify-center px-6 text-center text-neutral-600"
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
            // onOpenAccount intentionally undefined — F61 wires it.
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
            onOpenStoryPicker={() => {
              setStoryPickerOpen(true);
            }}
            onAdd={handleSidebarAdd}
            chaptersBody={
              <ChapterList
                storyId={story.id}
                activeChapterId={activeChapterId}
                onSelectChapter={setActiveChapterId}
              />
            }
            castBody={
              <CastTab
                characters={charactersQuery.data ?? []}
                onOpenCharacter={handleOpenCharacterFromCast}
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
                  storyTitle={story.title}
                  storyGenre={story.genre}
                  storyWordCount={totalWordCount}
                  chapterNumber={activeChapter ? activeChapter.orderIndex + 1 : null}
                  chapterTitle={activeChapter?.title ?? null}
                  initialBodyJson={(chapterQuery.data?.bodyJson as JSONContent | null) ?? null}
                  onUpdate={handlePaperUpdate}
                  onReady={handleEditorReady}
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
                  <Export story={exportStory} activeChapterId={activeChapterId} />
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

      <CharacterSheet
        storyId={story.id}
        characterId={openCharacterId}
        onClose={() => {
          setOpenCharacterId(null);
        }}
      />

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
      />
    </>
  );
}
