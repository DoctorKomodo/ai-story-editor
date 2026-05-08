import { create } from 'zustand';

export type SceneStreamState = 'idle' | 'streaming' | 'error';

export interface SceneMessage {
  id: string; // server id, or temp 'pending-<n>' while in flight
  role: 'user' | 'assistant';
  content: string;
  model?: string;
  state: 'pending' | 'streaming' | 'done' | 'error';
}

export interface SceneTranscriptState {
  chatId: string | null;
  messages: SceneMessage[];
  streamState: SceneStreamState;
  abortController: AbortController | null;
  errorMessage: string | null;

  setChat(chatId: string | null, messages: SceneMessage[]): void;
  pushUser(content: string): string;
  beginStreamingAssistant(model: string): string;
  appendDelta(delta: string): void;
  finishAssistant(realId: string): void;
  failAssistant(message: string): void;
  resetStream(): void;
  setAbort(controller: AbortController | null): void;
  removeLastAssistantIfPending(): void;
}

let tempCounter = 0;
const nextTempId = (): string => `pending-${++tempCounter}`;

/** ES2022-compatible last-index search (findLastIndex is ES2023). */
function findLastIdx(msgs: SceneMessage[], pred: (m: SceneMessage) => boolean): number {
  for (let i = msgs.length - 1; i >= 0; i--) {
    if (pred(msgs[i])) return i;
  }
  return -1;
}

export const useSceneTranscriptStore = create<SceneTranscriptState>((set) => ({
  chatId: null,
  messages: [],
  streamState: 'idle',
  abortController: null,
  errorMessage: null,

  setChat(chatId, messages) {
    set({ chatId, messages, streamState: 'idle', errorMessage: null });
  },

  pushUser(content) {
    const id = nextTempId();
    set((s) => ({
      messages: [...s.messages, { id, role: 'user', content, state: 'done' }],
    }));
    return id;
  },

  beginStreamingAssistant(model) {
    const id = nextTempId();
    set((s) => ({
      messages: [...s.messages, { id, role: 'assistant', content: '', model, state: 'streaming' }],
      streamState: 'streaming',
      errorMessage: null,
    }));
    return id;
  },

  appendDelta(delta) {
    set((s) => {
      const idx = findLastIdx(s.messages, (m) => m.role === 'assistant' && m.state === 'streaming');
      if (idx < 0) return s;
      const next = [...s.messages];
      next[idx] = { ...next[idx], content: next[idx].content + delta };
      return { messages: next };
    });
  },

  finishAssistant(realId) {
    set((s) => {
      const idx = findLastIdx(s.messages, (m) => m.role === 'assistant' && m.state === 'streaming');
      if (idx < 0) return { streamState: 'idle' as SceneStreamState };
      const next = [...s.messages];
      next[idx] = { ...next[idx], id: realId, state: 'done' };
      return {
        messages: next,
        streamState: 'idle' as SceneStreamState,
        abortController: null,
        errorMessage: null,
      };
    });
  },

  failAssistant(message) {
    set((s) => {
      const idx = findLastIdx(s.messages, (m) => m.role === 'assistant' && m.state === 'streaming');
      const next = [...s.messages];
      if (idx >= 0) next.splice(idx, 1);
      return {
        messages: next,
        streamState: 'error' as SceneStreamState,
        abortController: null,
        errorMessage: message,
      };
    });
  },

  resetStream() {
    set({ streamState: 'idle', abortController: null, errorMessage: null });
  },

  setAbort(controller) {
    set({ abortController: controller });
  },

  removeLastAssistantIfPending() {
    set((s) => {
      const idx = findLastIdx(s.messages, (m) => m.role === 'assistant' && m.state === 'streaming');
      if (idx < 0) return s;
      const next = [...s.messages];
      next.splice(idx, 1);
      return { messages: next };
    });
  },
}));
