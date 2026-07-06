import { describe, expect, it } from 'vitest';
import { checkChatSendGuards } from '@/lib/chatSendGuards';

describe('checkChatSendGuards', () => {
  it('returns no_draft when draftId is null', () => {
    const result = checkChatSendGuards({ draftId: null, selectedModelId: 'm1' });
    expect(result).not.toBeNull();
    expect(result?.code).toBe('no_draft');
    expect(result?.severity).toBe('warn');
    expect(result?.source).toBe('chat.send');
  });

  it('returns no_model when draftId set but selectedModelId is null', () => {
    const result = checkChatSendGuards({ draftId: 'draft-1', selectedModelId: null });
    expect(result?.code).toBe('no_model');
    expect(result?.severity).toBe('warn');
    expect(result?.source).toBe('chat.send');
  });

  it('returns no_model when selectedModelId is empty string (defensive)', () => {
    const result = checkChatSendGuards({ draftId: 'draft-1', selectedModelId: '' });
    expect(result?.code).toBe('no_model');
  });

  it('returns null when both inputs are present (send may proceed)', () => {
    expect(checkChatSendGuards({ draftId: 'draft-1', selectedModelId: 'm1' })).toBeNull();
  });

  it('prioritises draft check over model check', () => {
    const result = checkChatSendGuards({ draftId: null, selectedModelId: null });
    expect(result?.code).toBe('no_draft');
  });
});
