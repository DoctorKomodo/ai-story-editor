import { describe, expect, it } from 'vitest';
import { checkChatSendGuards } from '@/lib/chatSendGuards';

describe('checkChatSendGuards', () => {
  it('returns no_chapter when activeChapterId is null', () => {
    const result = checkChatSendGuards({ activeChapterId: null, selectedModelId: 'm1' });
    expect(result).not.toBeNull();
    expect(result?.code).toBe('no_chapter');
    expect(result?.severity).toBe('warn');
    expect(result?.source).toBe('chat.send');
  });

  it('returns no_model when activeChapterId set but selectedModelId is null', () => {
    const result = checkChatSendGuards({ activeChapterId: 'ch1', selectedModelId: null });
    expect(result?.code).toBe('no_model');
    expect(result?.severity).toBe('warn');
    expect(result?.source).toBe('chat.send');
  });

  it('returns no_model when selectedModelId is empty string (defensive)', () => {
    const result = checkChatSendGuards({ activeChapterId: 'ch1', selectedModelId: '' });
    expect(result?.code).toBe('no_model');
  });

  it('returns null when both inputs are present (send may proceed)', () => {
    expect(checkChatSendGuards({ activeChapterId: 'ch1', selectedModelId: 'm1' })).toBeNull();
  });

  it('prioritises chapter check over model check', () => {
    const result = checkChatSendGuards({ activeChapterId: null, selectedModelId: null });
    expect(result?.code).toBe('no_chapter');
  });
});
