import { beforeEach, describe, expect, it } from 'vitest';
import { useChatDraftStore } from '@/store/chatDraft';

describe('useChatDraftStore (keyed by chatId)', () => {
  beforeEach(() => {
    useChatDraftStore.setState({ drafts: {} });
  });

  it('start() creates a slot scoped to chatId', () => {
    useChatDraftStore.getState().start({
      chatId: 'chat-1',
      userContent: 'hello',
      attachment: null,
    });
    const drafts = useChatDraftStore.getState().drafts;
    expect(drafts['chat-1']).toMatchObject({
      chatId: 'chat-1',
      userContent: 'hello',
      status: 'thinking',
    });
    expect(drafts['chat-2']).toBeUndefined();
  });

  it('appendDelta(chatId, ...) only mutates that slot', () => {
    useChatDraftStore.getState().start({ chatId: 'chat-1', userContent: 'a', attachment: null });
    useChatDraftStore.getState().start({ chatId: 'chat-2', userContent: 'b', attachment: null });
    useChatDraftStore.getState().appendDelta('chat-1', 'Hello ');
    useChatDraftStore.getState().appendDelta('chat-1', 'world');
    const drafts = useChatDraftStore.getState().drafts;
    expect(drafts['chat-1'].assistantText).toBe('Hello world');
    expect(drafts['chat-2'].assistantText).toBe('');
  });

  it('clear(chatId) removes that slot only', () => {
    useChatDraftStore.getState().start({ chatId: 'chat-1', userContent: 'a', attachment: null });
    useChatDraftStore.getState().start({ chatId: 'chat-2', userContent: 'b', attachment: null });
    useChatDraftStore.getState().clear('chat-1');
    const drafts = useChatDraftStore.getState().drafts;
    expect(drafts['chat-1']).toBeUndefined();
    expect(drafts['chat-2']).toBeDefined();
  });

  it('start() overwrites an existing slot (no merge of stale state)', () => {
    useChatDraftStore.getState().start({ chatId: 'c1', userContent: 'first', attachment: null });
    useChatDraftStore.getState().markError('c1', { code: 'err', message: 'oops' });
    useChatDraftStore.getState().start({ chatId: 'c1', userContent: 'retry', attachment: null });
    const d = useChatDraftStore.getState().drafts['c1'];
    expect(d?.userContent).toBe('retry');
    expect(d?.status).toBe('thinking');
    expect(d?.error).toBeNull();
    expect(d?.assistantText).toBe('');
  });

  it('markError(chatId, ...) sets error on that slot only', () => {
    useChatDraftStore.getState().start({ chatId: 'chat-1', userContent: 'a', attachment: null });
    useChatDraftStore.getState().start({ chatId: 'chat-2', userContent: 'b', attachment: null });
    useChatDraftStore.getState().markError('chat-1', { code: 'rate_limited', message: 'oops' });
    const drafts = useChatDraftStore.getState().drafts;
    expect(drafts['chat-1'].status).toBe('error');
    expect(drafts['chat-1'].error).toEqual({ code: 'rate_limited', message: 'oops' });
    expect(drafts['chat-2'].status).toBe('thinking');
    expect(drafts['chat-2'].error).toBeNull();
  });
});
