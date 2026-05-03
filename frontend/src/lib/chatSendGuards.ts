import type { AppError } from '@/store/errors';

/**
 * Pure guard for the chat-send flow. Returns null when the send may
 * proceed; otherwise returns the AppError shape that EditorPage should
 * publish to useErrorStore. Extracted from EditorPage.handleChatSend so
 * each guard branch is unit-testable without mounting the full page.
 */
export function checkChatSendGuards(input: {
  activeChapterId: string | null;
  selectedModelId: string | null;
}): Omit<AppError, 'id' | 'at'> | null {
  if (!input.activeChapterId) {
    return {
      severity: 'warn',
      source: 'chat.send',
      code: 'no_chapter',
      message: 'Open a chapter before sending a message.',
    };
  }
  if (input.selectedModelId === null) {
    return {
      severity: 'warn',
      source: 'chat.send',
      code: 'no_model',
      message: 'Pick a model in the chat panel first.',
    };
  }
  return null;
}
