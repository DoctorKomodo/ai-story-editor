import { useAttachedSelectionStore } from '@/store/attachedSelection';
import { useComposerDraftStore } from '@/store/composerDraft';
import { useSelectionStore } from '@/store/selection';
import { useUiStore } from '@/store/ui';

/**
 * [F41] Ask-AI flow.
 *
 * Wired from the F33 SelectionBubble's "Ask AI" action. Performs four
 * coordinated state changes:
 *
 *   1. Attach the selected passage so the chat composer renders the
 *      attachment block (handled by F40 + F22's `attachedSelection`
 *      slice).
 *   2. Ensure the chat panel is visible — if the layout is `nochat` or
 *      `focus`, switch to `three-col`.
 *   3. Pre-fill the composer textarea with the "Help me with this passage
 *      — " starter and request that the textarea take focus, via the F41
 *      composer-draft slice.
 *   4. Clear the prose selection in both the Zustand selection store and
 *      the live DOM Range, so the bubble disappears and the editor's
 *      caret is no longer extended over the passage.
 */

export interface AskAIChapter {
  id: string;
  number: number;
  title: string;
}

export interface AskAIArgs {
  selectionText: string;
  chapter: AskAIChapter;
}

export const ASK_AI_DRAFT = 'Help me with this passage — ';

export function triggerAskAI(args: AskAIArgs): void {
  // 1. Attach the selection.
  useAttachedSelectionStore.getState().setAttachedSelection({
    text: args.selectionText,
    chapter: args.chapter,
  });

  // 2. Ensure chat panel is visible.
  const ui = useUiStore.getState();
  if (ui.layout !== 'three-col') {
    ui.setLayout('three-col');
  }

  // 3. Pre-fill the composer + request focus.
  const draftStore = useComposerDraftStore.getState();
  draftStore.setDraft(ASK_AI_DRAFT);
  draftStore.requestFocus();

  // 4. Clear the prose selection (store + DOM range).
  useSelectionStore.getState().clear();
  if (typeof window !== 'undefined') {
    window.getSelection()?.removeAllRanges();
  }
}
