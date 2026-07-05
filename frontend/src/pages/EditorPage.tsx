// [F51 + F52 + 9wk.6] EditorPage — AppShell shell with FormatBar + Paper editor.
//
// Survivor list (F7 → F51 → F52 → 9wk.6):
//   - useStoryQuery(activeStoryId)        → breadcrumbs (TopBar)
//   - useChaptersQuery(storyId)           → ChapterList + Export + word-count footer
//   - useDraftsQuery/useDraftQuery        → Paper bodyJson source (9wk.6, draft-native)
//   - useUpdateDraftMutation              → autosave PATCH (9wk.6, draft-native)
//   - useUpdateChapterMutation            → title-only PATCH (chapter body left drafts.routes.ts in step 5)
//   - useCharactersQuery(storyId)         → CastTab body
//   - useVeniceAccountQuery()             → UserMenu balance
//   - useSessionStore(user)               → UserMenu username
//   - useAuth().logout + navigate         → sign out
//   - useActiveChapterStore               → ChapterList selection
//   - useSidebarTabStore                  → active tab
//   - <CharacterSheet> modal              → page-root, id-driven
//   - <FormatBar> + <Paper>               → editor slot (F52 — replaces F8)
//   - <ChatPanel> + <ChatTab> (chat session picker + messages + composer) → chat slot
//   - <Export>                            → rendered below Paper (until F52 promote)
//
// Modal-mount convention (locked in F51 for the rest of the F-series):
//   page-level useState per modal; callback prop down via TopBar / Sidebar /
//   ChatPanel; <Modal /> rendered at the bottom of the component, NOT inside
//   AppShell. F55 mounts <SettingsModal>, <StoryBrowser> here; F61 mounts
//   <AccountPrivacyModal>. (X33 retired the standalone <ModelPicker> — model
//   selection lives inside <SettingsModal initialTab="models">.)

import { useQueryClient } from '@tanstack/react-query';
import type { JSONContent, Editor as TiptapEditor } from '@tiptap/core';
import type { JSX } from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import type { Chapter } from 'story-editor-shared';
import { AccountPrivacyModal } from '@/components/AccountPrivacyModal';
import { AppShell } from '@/components/AppShell';
import { CastTab } from '@/components/CastTab';
import { ChapterConflictBanner } from '@/components/ChapterConflictBanner';
import { ChapterList } from '@/components/ChapterList';
import { ChapterSummaryPopover } from '@/components/ChapterSummaryPopover';
import { ChapterSummarySheet } from '@/components/ChapterSummarySheet';
import {
  CharacterPopoverHost,
  type CharacterPopoverHostHandle,
} from '@/components/CharacterPopoverHost';
import { CharacterSheet } from '@/components/CharacterSheet';
import { ChatPanel } from '@/components/ChatPanel';
import { ChatTab } from '@/components/ChatTab';
import { ContinueWriting } from '@/components/ContinueWriting';
import { DraftRestoreBanner } from '@/components/DraftRestoreBanner';
import { Export, type ExportStory } from '@/components/Export';
import { FormatBar } from '@/components/FormatBar';
import { InlineAIResult } from '@/components/InlineAIResult';
import { OutlineTab } from '@/components/OutlineTab';
import { Paper } from '@/components/Paper';
import { SceneTab } from '@/components/SceneTab';
import { type SelectionAction, SelectionBubble } from '@/components/SelectionBubble';
import { SettingsModal } from '@/components/Settings';
import { Sidebar } from '@/components/Sidebar';
import { StoryBrowser } from '@/components/StoryBrowser';
import { StoryModal } from '@/components/StoryModal';
import { TopBar } from '@/components/TopBar';
import { type RunArgs, useAICompletion } from '@/hooks/useAICompletion';
import { useAuth } from '@/hooks/useAuth';
import { useAutosave } from '@/hooks/useAutosave';
import { useChapterDraft } from '@/hooks/useChapterDraft';
import {
  chapterQueryKey,
  useChapterQuery,
  useChaptersQuery,
  useUpdateChapterMutation,
} from '@/hooks/useChapters';
import { useCharactersQuery } from '@/hooks/useCharacters';
import {
  activeDraftIdOf,
  isDraftConflictError,
  useDraftQuery,
  useDraftsQuery,
  useUpdateDraftMutation,
} from '@/hooks/useDrafts';
import { useStoryQuery } from '@/hooks/useStories';
import { useUnloadFlush } from '@/hooks/useUnloadFlush';
import { useUserSettings } from '@/hooks/useUserSettings';
import { useVeniceAccountQuery } from '@/hooks/useVeniceAccount';
import { ApiError, api } from '@/lib/api';
import { triggerAskAI } from '@/lib/askAi';
import { extractVeniceMessage } from '@/lib/veniceError';
import { resolveActiveChapterId, useActiveChapterStore } from '@/store/activeChapter';
import { useInlineAIResultStore } from '@/store/inlineAIResult';
import { useSelectedCharacterStore } from '@/store/selectedCharacter';
import { useSelectedDraftStore } from '@/store/selectedDraft';
import { useSessionStore } from '@/store/session';
import { useSettingsModalStore } from '@/store/settingsModal';

function extractSelection(editor: TiptapEditor): string {
  const { from, to } = editor.state.selection;
  if (from === to) return '';
  return editor.state.doc.textBetween(from, to, ' ');
}

// [F53] Maps the SelectionBubble action id to the backend action id sent to
// /api/ai/complete. 1:1 since V14 added real 'rewrite' and 'describe' actions.
export const ACTION_MAP: Record<Exclude<SelectionAction, 'ask'>, RunArgs['action']> = {
  rewrite: 'rewrite',
  describe: 'describe',
  expand: 'expand',
};

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
  const displayName = useSessionStore((s) => s.user?.name) ?? null;
  const userId = useSessionStore((s) => s.user?.id) ?? null;
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

  useEffect(() => {
    const chapters = chaptersQuery.data;
    if (!chapters) return;
    const next = resolveActiveChapterId(chapters, activeChapterId);
    if (next !== activeChapterId) setActiveChapterId(next);
  }, [chaptersQuery.data, activeChapterId, setActiveChapterId]);

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

  const [summaryPopoverState, setSummaryPopoverState] = useState<{
    chapterId: string;
    anchorEl: HTMLElement;
  } | null>(null);
  const [summarySheetChapterId, setSummarySheetChapterId] = useState<string | null>(null);

  // Fetch chapter detail for the sheet so it receives a real initialSummary from the
  // per-chapter cache (the chapters-list cache is metadata-only and carries no summary field).
  const detailForSheet = useChapterQuery(summarySheetChapterId, story?.id);

  // [F55] Page-root modal state. The page renders each modal at the bottom
  // of its JSX; TopBar / Sidebar / ChatPanel callbacks flip these flags.
  const [storyPickerOpen, setStoryPickerOpen] = useState(false);
  const [editStoryOpen, setEditStoryOpen] = useState(false);
  const settingsOpen = useSettingsModalStore((s) => s.open);
  const settingsInitialTab = useSettingsModalStore((s) => s.initialTab);
  // [F61] Account & privacy modal state — same page-root convention.
  const [accountPrivacyOpen, setAccountPrivacyOpen] = useState(false);

  const selectedModelId = useUserSettings().chat.model;
  const completion = useAICompletion();

  const updateChapter = useUpdateChapterMutation();
  const [draftBodyJson, setDraftBodyJson] = useState<JSONContent | null>(null);

  // [9wk.6] Draft-native editor: which draft is being viewed. selectedDraftId
  // is null until the 9wk.7 sidebar sets it — null means "follow the active
  // draft". Reset on chapter switch.
  const selectedDraftId = useSelectedDraftStore((s) => s.selectedDraftId);
  const resetSelectedDraft = useSelectedDraftStore((s) => s.reset);
  // biome-ignore lint/correctness/useExhaustiveDependencies: activeChapterId is the reset trigger.
  useEffect(() => {
    resetSelectedDraft();
  }, [activeChapterId]);

  const draftsQuery = useDraftsQuery(activeChapterId);
  const viewedDraftId = selectedDraftId ?? activeDraftIdOf(draftsQuery.data);
  const draftQuery = useDraftQuery(viewedDraftId);
  const updateDraft = useUpdateDraftMutation();

  // Local (device-only, plaintext) chapter-draft persistence — survives tab
  // close, crash, session expiry, and re-login. See plan "Design decisions"
  // §1 for the accepted plaintext-on-device trade.
  const chapterDraft = useChapterDraft({
    userId,
    storyId: story?.id ?? null,
    chapterId: activeChapterId,
    draftId: viewedDraftId,
    serverUpdatedAt: draftQuery.data?.updatedAt ?? null,
    serverLoaded: draftQuery.data !== undefined,
  });

  // Non-null while a restored (or reloaded-after-conflict) draft body must
  // remount Paper with content that isn't `draftQuery.data.bodyJson` — the
  // `key` includes `nonce` so Paper tears down and re-seeds even when
  // `viewedDraftId` hasn't changed.
  const [restoreSeed, setRestoreSeed] = useState<{
    nonce: number;
    bodyJson: JSONContent;
  } | null>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: viewedDraftId is the reset trigger — the effect must re-run on draft switch even though it doesn't read the id.
  useEffect(() => {
    setRestoreSeed(null);
  }, [viewedDraftId]);

  // [T8.1] Seed the local draft exactly once per viewed-draft switch — not on
  // every draftQuery.data reference change. The earlier shape (deps:
  // [viewedDraftId, draftQuery.data]) was racy: typing into a freshly-
  // created draft would race a late-arriving draftQuery.data resolve, and
  // the second run of this effect wiped `draftBodyJson` back to the server's
  // empty body before the 4s autosave debounce fired. Tracking the
  // last-seeded draft id makes the seed strictly idempotent per draft while
  // still re-seeding on draft switch.
  //
  // For drafts that load with `bodyJson === null` (freshly created), seed
  // with the canonical empty TipTap doc instead of null — `useAutosave`
  // treats the first *non-null* payload as a baseline (no save fires) and
  // ignores null entirely, so seeding with null leaves the user's first
  // keystroke being mistaken for the baseline. The empty-doc seed gives
  // autosave a real baseline to diff against, and the user's first typed
  // character correctly schedules a PATCH.
  const seededForDraftIdRef = useRef<string | null>(null);
  useEffect(() => {
    if (viewedDraftId === null) {
      seededForDraftIdRef.current = null;
      setDraftBodyJson(null);
      return;
    }
    if (seededForDraftIdRef.current === viewedDraftId) return;
    if (draftQuery.data === undefined) return;
    seededForDraftIdRef.current = viewedDraftId;
    const serverBody = draftQuery.data.bodyJson as JSONContent | null;
    const seed: JSONContent = serverBody ?? { type: 'doc', content: [{ type: 'paragraph' }] };
    setDraftBodyJson(seed);
  }, [viewedDraftId, draftQuery.data]);

  // Last-seen server `updatedAt` — sent as the PATCH's `expectedUpdatedAt`
  // precondition. Kept fresh from the draft cache, which
  // `useUpdateDraftMutation`'s `onSuccess` also writes after every save.
  const serverUpdatedAtRef = useRef<string | null>(null);
  useEffect(() => {
    serverUpdatedAtRef.current = draftQuery.data?.updatedAt ?? null;
  }, [draftQuery.data?.updatedAt]);

  // True when the last save was rejected 409 (another tab/device moved the
  // chapter since we last read it). While true, autosave is inert — the
  // local draft (already persisted by `onDirty`) is the safety net, and the
  // conflict banner offers Reload / Overwrite.
  const [conflict, setConflict] = useState(false);
  const [conflictActionBusy, setConflictActionBusy] = useState(false);
  // biome-ignore lint/correctness/useExhaustiveDependencies: viewedDraftId is the reset trigger — the effect must re-run on draft switch even though it doesn't read the id.
  useEffect(() => {
    setConflict(false);
  }, [viewedDraftId]);

  const handleSave = useCallback(
    async (value: JSONContent): Promise<void> => {
      if (!story?.id || activeChapterId === null || viewedDraftId === null) return;
      // wordCount is recomputed server-side from bodyJson (drafts.routes.ts).
      try {
        await updateDraft.mutateAsync({
          draftId: viewedDraftId,
          chapterId: activeChapterId,
          storyId: story.id,
          input: {
            bodyJson: value,
            ...(serverUpdatedAtRef.current !== null
              ? { expectedUpdatedAt: serverUpdatedAtRef.current }
              : {}),
          },
        });
      } catch (err) {
        if (isDraftConflictError(err)) setConflict(true);
        throw err;
      }
    },
    [story?.id, activeChapterId, viewedDraftId, updateDraft],
  );

  const autosave = useAutosave<JSONContent>({
    // Payload stays live (not forced null) during a conflict — the user's
    // continued typing must keep flowing into the local draft via `onDirty`
    // below. `suspended` is what stops the SERVER save; see that option.
    payload: draftBodyJson,
    save: handleSave,
    // Treat each DRAFT as its own document — switching drafts resets the
    // baseline so the new draft's freshly-loaded body isn't mistaken for a
    // dirty edit of the old one (which would fire a spurious PATCH and, if a
    // save was in flight during the switch, could land the new body under the
    // new draft id via the pending-follow-up branch).
    resetKey: viewedDraftId,
    // Persists a plaintext draft to IndexedDB on every dirty change and
    // deletes it once a save is confirmed (see useChapterDraft). Keeps firing
    // while `suspended`, so keystrokes typed during an unresolved conflict
    // still land on disk.
    onDirty: chapterDraft.persistDraft,
    onSaved: chapterDraft.clearDraft,
    // While a conflict is unresolved, suppress the debounced/retry SERVER
    // save (and `getPendingPayload`, so the unload-time keepalive flush also
    // stays suppressed) — the local draft above is the safety net until the
    // user resolves via Reload or Overwrite. Neither send an unconditional
    // clobbering PATCH: Reload discards local edits in favor of the server's
    // version, Overwrite is one explicit user-sanctioned PATCH.
    suspended: conflict,
  });

  const handleConflictReload = useCallback(async (): Promise<void> => {
    setConflictActionBusy(true);
    try {
      const res = await draftQuery.refetch();
      const serverBody = (res.data?.bodyJson as JSONContent | null) ?? {
        type: 'doc',
        content: [{ type: 'paragraph' }],
      };
      setConflict(false);
      setRestoreSeed({ nonce: Date.now(), bodyJson: serverBody });
      setDraftBodyJson(serverBody);
    } finally {
      setConflictActionBusy(false);
    }
  }, [draftQuery]);

  const handleConflictOverwrite = useCallback(async (): Promise<void> => {
    if (!story?.id || activeChapterId === null || viewedDraftId === null || draftBodyJson === null)
      return;
    setConflictActionBusy(true);
    try {
      // Deliberately WITHOUT `expectedUpdatedAt` — explicit user-sanctioned
      // last-write-wins.
      await updateDraft.mutateAsync({
        draftId: viewedDraftId,
        chapterId: activeChapterId,
        storyId: story.id,
        input: { bodyJson: draftBodyJson },
      });
      setConflict(false);
    } finally {
      setConflictActionBusy(false);
    }
  }, [story?.id, activeChapterId, viewedDraftId, draftBodyJson, updateDraft]);

  useUnloadFlush(
    useCallback(() => {
      const pending = autosave.getPendingPayload();
      if (pending === null || viewedDraftId === null) return null;
      // Closure-read ids are safe: switching the viewed draft changes
      // useAutosave's resetKey, which nulls getPendingPayload() until the new
      // draft's baseline seeds — a stale buffer can't flush at the new id.
      return {
        draftId: viewedDraftId,
        bodyJson: pending,
        expectedUpdatedAt: serverUpdatedAtRef.current,
      };
    }, [autosave.getPendingPayload, viewedDraftId]),
  );

  const handlePaperUpdate = useCallback(
    ({ bodyJson }: { bodyJson: JSONContent; wordCount: number }): void => {
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

  // StoryModal's reset effect re-seeds all fields whenever `initial` changes;
  // a stable reference here prevents in-progress typing from being wiped on
  // any EditorPage re-render (autosave ticks, balance polling, streaming).
  const editStoryInitial = useMemo(
    () =>
      story
        ? {
            id: story.id,
            title: story.title,
            genre: story.genre,
            synopsis: story.synopsis,
            worldNotes: story.worldNotes,
            includePreviousChaptersInPrompt: story.includePreviousChaptersInPrompt,
          }
        : undefined,
    [story],
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
  }, [completion, setInlineAIResult]);

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
          ? {
              code: err.code ?? null,
              message: err.message,
              httpStatus: err.status,
              retryAfterSeconds: err.body?.error?.retryAfterSeconds ?? null,
              veniceMessage: extractVeniceMessage(err.body),
            }
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

  // Reset settings-modal store on unmount so a remount of EditorPage (e.g. story switch) doesn't re-open it.
  useEffect(() => {
    return () => {
      useSettingsModalStore.getState().close();
    };
  }, []);

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
        className="min-h-screen flex flex-col items-center justify-center gap-4 px-6 text-center font-sans text-[13px] text-ink-3"
      >
        <p className="m-0">Could not load story</p>
        <Link
          to="/"
          data-testid="editor-page-error-home"
          className="px-3 py-1.5 text-[12px] rounded-[var(--radius)] bg-ink text-bg hover:bg-ink-2 transition-colors"
        >
          Back to library
        </Link>
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
            onOpenSettings={() => {
              useSettingsModalStore.getState().openWith();
            }}
            onOpenStoriesList={() => {
              setStoryPickerOpen(true);
            }}
            onOpenAccount={() => {
              setAccountPrivacyOpen(true);
            }}
            username={username}
            displayName={displayName}
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
            onEditStory={() => {
              setEditStoryOpen(true);
            }}
            chaptersBody={
              <ChapterList
                storyId={story.id}
                activeChapterId={activeChapterId}
                onSelectChapter={setActiveChapterId}
                onChapterDeleted={(deletedId) => {
                  if (deletedId === activeChapterId) setActiveChapterId(null);
                }}
                onOpenSummary={(chapterId, anchorEl) => {
                  setSummaryPopoverState({ chapterId, anchorEl });
                }}
                openPopoverChapterId={summaryPopoverState?.chapterId ?? null}
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
                <>
                  {conflict ? (
                    <div className="mx-auto w-full max-w-[720px] px-6 pt-4">
                      <ChapterConflictBanner
                        onReload={() => {
                          void handleConflictReload();
                        }}
                        onOverwrite={() => {
                          void handleConflictOverwrite();
                        }}
                        busy={conflictActionBusy}
                      />
                    </div>
                  ) : chapterDraft.pendingDraft !== null ? (
                    <div className="mx-auto w-full max-w-[720px] px-6 pt-4">
                      <DraftRestoreBanner
                        savedAt={chapterDraft.pendingDraft.savedAt}
                        onRestore={() => {
                          const d = chapterDraft.acceptDraft();
                          if (d === null) return;
                          const bodyJson = d.bodyJson as JSONContent;
                          setRestoreSeed({ nonce: Date.now(), bodyJson });
                          // Feeds the dirty payload straight into autosave —
                          // it differs from the server baseline and schedules
                          // the PATCH that re-saves the restored text.
                          setDraftBodyJson(bodyJson);
                        }}
                        onDiscard={chapterDraft.discardDraft}
                      />
                    </div>
                  ) : null}
                  <Paper
                    // Key on viewedDraftId (plus a restore nonce) so switching
                    // drafts — or restoring a local draft — tears down the
                    // previous TipTap editor and mounts a fresh one seeded
                    // with the right body. Without this, useEditor retains
                    // its initial content across draft switches and the
                    // in-place setContent effect skips empty bodies — the
                    // user sees the old draft's text under the new title.
                    key={
                      restoreSeed !== null
                        ? `${viewedDraftId}:r${restoreSeed.nonce}`
                        : (viewedDraftId ?? activeChapterId)
                    }
                    storyId={story.id}
                    storyTitle={story.title}
                    storyGenre={story.genre}
                    storyWordCount={totalWordCount}
                    chapterId={activeChapterId}
                    chapterNumber={activeChapter ? activeChapter.orderIndex + 1 : null}
                    chapterTitle={activeChapter?.title ?? null}
                    initialBodyJson={
                      restoreSeed?.bodyJson ??
                      (draftQuery.data?.bodyJson as JSONContent | null) ??
                      null
                    }
                    onUpdate={handlePaperUpdate}
                    onReady={handleEditorReady}
                    onChapterTitleChange={handleChapterTitleChange}
                  />
                </>
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
            chatBody={<ChatTab draftId={viewedDraftId} editor={editor} />}
            sceneBody={<SceneTab draftId={viewedDraftId} editor={editor} />}
            onOpenModelPicker={() => {
              useSettingsModalStore.getState().openWith('models');
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

      {/* [pcs] Chapter summary popover — opened from ChapterList SummaryStateIcon clicks.
          Page-root mount prevents clipping by the sidebar scroll container. */}
      {summaryPopoverState !== null ? (
        <ChapterSummaryPopover
          chapter={chaptersQuery.data?.find((c) => c.id === summaryPopoverState.chapterId) ?? null}
          storyId={story.id}
          anchorEl={summaryPopoverState.anchorEl}
          onClose={() => {
            setSummaryPopoverState(null);
          }}
          onEdit={(chapterId) => {
            setSummaryPopoverState(null);
            setSummarySheetChapterId(chapterId);
          }}
          modelId={selectedModelId ?? ''}
        />
      ) : null}

      {/* [pcs] Chapter summary sheet — opened from popover Edit button.
          detailForSheet supplies initialSummary from the per-chapter cache (list cache
          is metadata-only and carries no summary field). */}
      {summarySheetChapterId !== null ? (
        <ChapterSummarySheet
          chapterId={summarySheetChapterId}
          storyId={story.id}
          activeDraftId={detailForSheet.data?.activeDraftId ?? ''}
          open
          onClose={() => {
            setSummarySheetChapterId(null);
          }}
          initialSummary={detailForSheet.data?.summary ?? undefined}
        />
      ) : null}

      {/* [F53] Selection bubble — listens for prose selections inside the
          .paper-prose region and absolute-positions itself over the
          selection. Page-root mount keeps it free of editor-slot overflow. */}
      <SelectionBubble proseSelector=".paper-prose" onAction={handleSelectionAction} />

      {/* [F55] Page-root modals. */}
      <StoryBrowser
        open={storyPickerOpen}
        onClose={() => {
          setStoryPickerOpen(false);
        }}
        activeStoryId={story.id}
      />
      <StoryModal
        mode="edit"
        open={editStoryOpen}
        onClose={() => {
          setEditStoryOpen(false);
        }}
        initial={editStoryInitial}
      />
      <SettingsModal
        open={settingsOpen}
        initialTab={settingsInitialTab}
        onClose={() => {
          useSettingsModalStore.getState().close();
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
