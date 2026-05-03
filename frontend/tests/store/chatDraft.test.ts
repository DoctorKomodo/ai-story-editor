import { beforeEach, describe, expect, it } from 'vitest';
import { useChatDraftStore } from '@/store/chatDraft';

beforeEach(() => {
  useChatDraftStore.getState().clear();
});

describe('useChatDraftStore', () => {
  it('starts in the empty state', () => {
    expect(useChatDraftStore.getState().draft).toBeNull();
  });

  it('start() seeds a thinking-state draft with userContent + attachment', () => {
    useChatDraftStore.getState().start({
      chatId: 'c1',
      userContent: 'hello',
      attachment: { selectionText: 'sel', chapterId: 'ch1' },
    });
    const d = useChatDraftStore.getState().draft;
    expect(d).not.toBeNull();
    expect(d?.chatId).toBe('c1');
    expect(d?.userContent).toBe('hello');
    expect(d?.attachment).toEqual({ selectionText: 'sel', chapterId: 'ch1' });
    expect(d?.assistantText).toBe('');
    expect(d?.status).toBe('thinking');
    expect(d?.error).toBeNull();
  });

  it('start() accepts attachment: null', () => {
    useChatDraftStore.getState().start({ chatId: 'c1', userContent: 'hi', attachment: null });
    expect(useChatDraftStore.getState().draft?.attachment).toBeNull();
  });

  it('appendDelta() concatenates onto assistantText', () => {
    useChatDraftStore.getState().start({ chatId: 'c1', userContent: 'q', attachment: null });
    useChatDraftStore.getState().appendDelta('Hel');
    useChatDraftStore.getState().appendDelta('lo');
    expect(useChatDraftStore.getState().draft?.assistantText).toBe('Hello');
  });

  it('appendDelta() is a no-op when no draft is active', () => {
    useChatDraftStore.getState().appendDelta('orphan');
    expect(useChatDraftStore.getState().draft).toBeNull();
  });

  it('markStreaming() flips status from thinking to streaming', () => {
    useChatDraftStore.getState().start({ chatId: 'c1', userContent: 'q', attachment: null });
    useChatDraftStore.getState().markStreaming();
    expect(useChatDraftStore.getState().draft?.status).toBe('streaming');
  });

  it('markDone() flips status to done', () => {
    useChatDraftStore.getState().start({ chatId: 'c1', userContent: 'q', attachment: null });
    useChatDraftStore.getState().markStreaming();
    useChatDraftStore.getState().markDone();
    expect(useChatDraftStore.getState().draft?.status).toBe('done');
  });

  it('markError() flips status to error and stores the error payload', () => {
    useChatDraftStore.getState().start({ chatId: 'c1', userContent: 'q', attachment: null });
    useChatDraftStore.getState().markError({ code: 'rate_limited', message: 'Too many requests' });
    const d = useChatDraftStore.getState().draft;
    expect(d?.status).toBe('error');
    expect(d?.error).toEqual({ code: 'rate_limited', message: 'Too many requests' });
  });

  it('clear() returns to the empty state', () => {
    useChatDraftStore.getState().start({ chatId: 'c1', userContent: 'q', attachment: null });
    useChatDraftStore.getState().clear();
    expect(useChatDraftStore.getState().draft).toBeNull();
  });
});
