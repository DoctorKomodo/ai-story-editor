import { beforeEach, describe, expect, it } from 'vitest';
import { useSceneTranscriptStore } from '@/store/sceneTranscript';

describe('sceneTranscript store', () => {
  beforeEach(() => {
    useSceneTranscriptStore.setState({
      chatId: null,
      messages: [],
      streamState: 'idle',
      abortController: null,
      errorMessage: null,
    });
  });

  it('pushUser appends a done user message', () => {
    useSceneTranscriptStore.getState().pushUser('hello');
    const { messages } = useSceneTranscriptStore.getState();
    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({ role: 'user', content: 'hello', state: 'done' });
  });

  it('begin/append/finish drives a streaming assistant', () => {
    const s = useSceneTranscriptStore.getState();
    s.beginStreamingAssistant('m1');
    s.appendDelta('hello');
    s.appendDelta(' world');
    expect(useSceneTranscriptStore.getState().streamState).toBe('streaming');
    s.finishAssistant('real-id');
    const m = useSceneTranscriptStore.getState().messages.at(-1)!;
    expect(m).toMatchObject({
      role: 'assistant',
      content: 'hello world',
      state: 'done',
      id: 'real-id',
    });
    expect(useSceneTranscriptStore.getState().streamState).toBe('idle');
  });

  it('failAssistant removes the streaming row and surfaces the error', () => {
    const s = useSceneTranscriptStore.getState();
    s.beginStreamingAssistant('m1');
    s.appendDelta('partial');
    s.failAssistant('boom');
    const state = useSceneTranscriptStore.getState();
    expect(state.messages.find((m) => m.role === 'assistant')).toBeUndefined();
    expect(state.streamState).toBe('error');
    expect(state.errorMessage).toBe('boom');
  });

  it('removeLastAssistantIfPending cleans up after abort', () => {
    const s = useSceneTranscriptStore.getState();
    s.beginStreamingAssistant('m1');
    s.appendDelta('half');
    s.removeLastAssistantIfPending();
    expect(
      useSceneTranscriptStore.getState().messages.find((m) => m.role === 'assistant'),
    ).toBeUndefined();
  });
});
