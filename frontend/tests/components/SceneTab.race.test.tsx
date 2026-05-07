/**
 * Bug fix regression test: streaming state must survive the post-create render cycle.
 *
 * When the user clicks Generate with no active session:
 *  1. createChat() resolves → chatId is known.
 *  2. The store is primed (setChat(chatId, [])) and hydratedChatIdRef is set.
 *  3. setActiveId(chatId) schedules a re-render.
 *  4. generate() pushes the user message + streaming assistant row onto the store.
 *  5. React re-renders. The hydration effect fires but sees hydratedChatIdRef ===
 *     activeId so it skips the round-trip → streaming row survives.
 *
 * Before the fix the hydration effect would fire and call setChat(chatId, []),
 * wiping the streaming row. Subsequent deltas and finishAssistant were no-ops
 * because findLastIdx returned -1.
 */
import { type QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SceneTab } from '@/components/SceneTab';
import { modelsQueryKey } from '@/hooks/useModels';
import { DEFAULT_SETTINGS, userSettingsQueryKey } from '@/hooks/useUserSettings';
import * as api from '@/lib/api';
import { createQueryClient } from '@/lib/queryClient';
import { useSceneTranscriptStore } from '@/store/sceneTranscript';
import { useSessionStore } from '@/store/session';

// Module-level mock: replace only the functions we need to control.
// resetApiClientForTests / setAccessToken / setUnauthorizedHandler are kept real
// so the auth wiring still works.
vi.mock('@/lib/api', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/lib/api')>();
  return {
    ...real,
    listChats: vi.fn(),
    listMessagesForChat: vi.fn(),
    createChat: vi.fn(),
    streamMessage: vi.fn(),
    patchChat: vi.fn(),
  };
});

function renderWithProviders(ui: ReactNode, client?: QueryClient): { client: QueryClient } {
  const qc = client ?? createQueryClient();
  render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
  return { client: qc };
}

function makeClient(): QueryClient {
  const qc = createQueryClient();
  qc.setQueryData(userSettingsQueryKey, {
    ...DEFAULT_SETTINGS,
    chat: { ...DEFAULT_SETTINGS.chat, model: 'model-id-1' },
  });
  qc.setQueryData(modelsQueryKey, [{ id: 'model-id-1', name: 'Test Model' }]);
  return qc;
}

const CHAT_ROW: api.ChatRow = {
  id: 'chat-new',
  kind: 'scene',
  title: null,
  chapterId: 'c1',
  createdAt: '2024-01-01T00:00:00Z',
  updatedAt: '2024-01-01T00:00:00Z',
};

describe('SceneTab — first-generate race (Bug 1)', () => {
  beforeEach(() => {
    api.resetApiClientForTests();
    api.setAccessToken('test-token');
    api.setUnauthorizedHandler(() => {
      useSessionStore.getState().clearSession();
    });
    useSessionStore.setState({
      user: { id: 'u1', username: 'alice', name: 'Alice' },
      status: 'authenticated',
    });
    useSceneTranscriptStore.getState().setChat(null, []);

    // First listChats returns empty (no sessions yet). After createChat the
    // sessions query is invalidated and refetches — the second call returns
    // the newly created session so the sessions effect doesn't reset activeId.
    vi.mocked(api.listChats).mockResolvedValueOnce([]).mockResolvedValue([CHAT_ROW]);

    // listMessagesForChat must NOT be called in the first-generate path (the
    // hydratedChatIdRef guard should skip it). If it ever IS called, return []
    // so the test doesn't hang.
    vi.mocked(api.listMessagesForChat).mockResolvedValue([]);

    // createChat resolves immediately with a fresh chatId.
    vi.mocked(api.createChat).mockResolvedValue(CHAT_ROW);

    // patchChat (auto-title) is non-fatal; just resolve.
    vi.mocked(api.patchChat).mockResolvedValue(CHAT_ROW);

    // streamMessage: fires onDelta then onDone synchronously (still within
    // the awaited async call) so the store is updated before the promise
    // chain continues.
    vi.mocked(api.streamMessage).mockImplementation(async (_chatId, _body, opts) => {
      opts.onDelta('hello');
      opts.onDone();
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
    api.setUnauthorizedHandler(null);
    api.resetApiClientForTests();
    useSessionStore.setState({ user: null, status: 'idle' });
    useSceneTranscriptStore.getState().setChat(null, []);
  });

  it('streaming state survives the post-create render cycle', async () => {
    const user = userEvent.setup();
    renderWithProviders(<SceneTab chapterId="c1" editor={null} />, makeClient());

    // Wait for the empty state to render (no sessions).
    await waitFor(() => {
      expect(screen.getByText(/describe what happens next/i)).toBeInTheDocument();
    });

    // Find the composer textarea and Generate button.
    const textarea = screen.getByRole('textbox');
    await user.click(textarea);
    await user.type(textarea, 'Jenny approaches Linda.');

    const generateBtn = screen.getByRole('button', { name: /generate/i });
    await user.click(generateBtn);

    // After generate completes: the user message and the streamed content
    // must both be visible. If the hydration effect had wiped the store,
    // only a blank panel would appear.
    await waitFor(() => {
      expect(screen.getByText('Jenny approaches Linda.')).toBeInTheDocument();
    });

    await waitFor(() => {
      // The streamed delta "hello" must appear in the candidate text.
      expect(screen.getByTestId('scene-candidate-text')).toHaveTextContent('hello');
    });

    // listMessagesForChat must NOT have been called (the ref guard skips it).
    expect(vi.mocked(api.listMessagesForChat)).not.toHaveBeenCalled();
  });

  it('activeId stays set after first generate — optimistic update prevents auto-select reset', async () => {
    // This test targets Bug 1: when sessions is still [] at re-render time,
    // the auto-select effect fires `setActiveId(null)` because
    // `activeId && !sessions.find(s => s.id === activeId)` is true.
    // The fix adds an optimistic cache update in createMut.onSuccess so
    // `sessions` contains the new chat before the re-render — the reset branch
    // never fires.
    //
    // We verify this by checking the query cache immediately after generate
    // completes: the new chat must already be in the cache (optimistic write),
    // not just after the background refetch resolves.
    const user = userEvent.setup();
    const { client } = renderWithProviders(<SceneTab chapterId="c1" editor={null} />, makeClient());

    await waitFor(() => {
      expect(screen.getByText(/describe what happens next/i)).toBeInTheDocument();
    });

    const textarea = screen.getByRole('textbox');
    await user.click(textarea);
    await user.type(textarea, 'Direction A');

    const generateBtn = screen.getByRole('button', { name: /generate/i });
    await user.click(generateBtn);

    // After generate + streaming, the candidate text must appear. If activeId
    // had been reset to null, setChat(null,[]) would have wiped the store and
    // this element would not be present.
    await waitFor(() => {
      expect(screen.getByTestId('scene-candidate-text')).toHaveTextContent('hello');
    });

    // The optimistic update must have seeded the query cache with the new chat
    // so `sessions` included it at the time of the auto-select effect, preventing
    // the reset-to-null branch from firing.
    const cached = client.getQueryData<api.ChatRow[]>(['scenes', 'c1']);
    expect(cached).toBeDefined();
    expect(cached?.some((c) => c.id === CHAT_ROW.id)).toBe(true);
  });

  it('listMessagesForChat is called when an existing session becomes active', async () => {
    // Override the beforeEach defaults: an existing session exists from the start.
    const existingChat: api.ChatRow = {
      id: 'chat-existing',
      kind: 'scene',
      title: 'Existing session',
      chapterId: 'c1',
      createdAt: '2024-01-01T00:00:00Z',
      updatedAt: '2024-01-01T00:00:00Z',
    };
    vi.mocked(api.listChats).mockReset();
    vi.mocked(api.listChats).mockResolvedValue([existingChat]);
    vi.mocked(api.listMessagesForChat).mockReset();
    vi.mocked(api.listMessagesForChat).mockResolvedValue([]);

    renderWithProviders(<SceneTab chapterId="c1" editor={null} />, makeClient());

    // The session effect picks chat-existing as activeId → hydration effect
    // fires (hydratedChatIdRef is null for this chatId) → fetches messages.
    await waitFor(() => {
      expect(vi.mocked(api.listMessagesForChat)).toHaveBeenCalledWith('chat-existing');
    });
  });
});
