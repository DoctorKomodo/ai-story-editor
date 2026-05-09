import { beforeEach, describe, expect, it } from 'vitest';
import { useChatDraftStore } from '@/store/chatDraft';

beforeEach(() => {
  useChatDraftStore.setState({ drafts: {} });
});

describe('useChatDraftStore', () => {
  it('starts in the empty state', () => {
    expect(useChatDraftStore.getState().drafts).toEqual({});
  });

  it('start() seeds a thinking-state draft with userContent + attachment', () => {
    useChatDraftStore.getState().start({
      chatId: 'c1',
      userContent: 'hello',
      attachment: { selectionText: 'sel', chapterId: 'ch1' },
    });
    const d = useChatDraftStore.getState().drafts['c1'];
    expect(d).not.toBeUndefined();
    expect(d?.chatId).toBe('c1');
    expect(d?.userContent).toBe('hello');
    expect(d?.attachment).toEqual({ selectionText: 'sel', chapterId: 'ch1' });
    expect(d?.assistantText).toBe('');
    expect(d?.status).toBe('thinking');
    expect(d?.error).toBeNull();
  });

  it('start() accepts attachment: null', () => {
    useChatDraftStore.getState().start({ chatId: 'c1', userContent: 'hi', attachment: null });
    expect(useChatDraftStore.getState().drafts['c1']?.attachment).toBeNull();
  });

  it('appendDelta() concatenates onto assistantText', () => {
    useChatDraftStore.getState().start({ chatId: 'c1', userContent: 'q', attachment: null });
    useChatDraftStore.getState().appendDelta('c1', 'Hel');
    useChatDraftStore.getState().appendDelta('c1', 'lo');
    expect(useChatDraftStore.getState().drafts['c1']?.assistantText).toBe('Hello');
  });

  it('appendDelta() is a no-op when no draft is active for that chatId', () => {
    useChatDraftStore.getState().appendDelta('orphan', 'text');
    expect(useChatDraftStore.getState().drafts['orphan']).toBeUndefined();
  });

  it('markStreaming() flips status from thinking to streaming', () => {
    useChatDraftStore.getState().start({ chatId: 'c1', userContent: 'q', attachment: null });
    useChatDraftStore.getState().markStreaming('c1');
    expect(useChatDraftStore.getState().drafts['c1']?.status).toBe('streaming');
  });

  it('markDone() flips status to done', () => {
    useChatDraftStore.getState().start({ chatId: 'c1', userContent: 'q', attachment: null });
    useChatDraftStore.getState().markStreaming('c1');
    useChatDraftStore.getState().markDone('c1');
    expect(useChatDraftStore.getState().drafts['c1']?.status).toBe('done');
  });

  it('markError() flips status to error and stores the error payload', () => {
    useChatDraftStore.getState().start({ chatId: 'c1', userContent: 'q', attachment: null });
    useChatDraftStore
      .getState()
      .markError('c1', { code: 'rate_limited', message: 'Too many requests' });
    const d = useChatDraftStore.getState().drafts['c1'];
    expect(d?.status).toBe('error');
    expect(d?.error).toEqual({ code: 'rate_limited', message: 'Too many requests' });
  });

  it('clear() removes that chatId slot', () => {
    useChatDraftStore.getState().start({ chatId: 'c1', userContent: 'q', attachment: null });
    useChatDraftStore.getState().clear('c1');
    expect(useChatDraftStore.getState().drafts['c1']).toBeUndefined();
  });
});
