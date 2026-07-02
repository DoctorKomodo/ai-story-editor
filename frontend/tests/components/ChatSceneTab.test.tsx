/**
 * ChatSceneTab — regression tests for the two bugs fixed by unifying
 * ChatTab and SceneTab onto the shared shell.
 *
 * Mirrors the scaffolding of ChatTab.test.tsx / SceneTab.test.tsx: partial
 * `vi.mock('@/lib/api')` to intercept `apiStream`, a stubbed global `fetch`,
 * a seeded TanStack Query cache, and Zustand store resets in setup/teardown.
 */
import { type QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ChatTab } from '@/components/ChatTab';
import { SceneTab } from '@/components/SceneTab';
import { modelsQueryKey } from '@/hooks/useModels';
import { DEFAULT_SETTINGS, userSettingsQueryKey } from '@/hooks/useUserSettings';
import { apiStream, resetApiClientForTests, setUnauthorizedHandler } from '@/lib/api';
import { createQueryClient } from '@/lib/queryClient';
import { useAttachedSelectionStore } from '@/store/attachedSelection';
import { useChatDraftStore } from '@/store/chatDraft';
import { useErrorStore } from '@/store/errors';
import { useSessionStore } from '@/store/session';

// Partially mock @/lib/api so we can intercept `apiStream` for SSE sends
// without affecting the other exports (api, resetApiClientForTests, etc).
vi.mock('@/lib/api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api')>('@/lib/api');
  return { ...actual, apiStream: vi.fn(actual.apiStream) };
});

type FetchMock = ReturnType<typeof vi.fn>;

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function renderWithProviders(ui: ReactNode, client?: QueryClient): { client: QueryClient } {
  const qc = client ?? createQueryClient();
  render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
  return { client: qc };
}

function makeModelClient(modelId = 'venice-model-1'): QueryClient {
  const qc = createQueryClient();
  qc.setQueryData(userSettingsQueryKey, {
    ...DEFAULT_SETTINGS,
    chat: { ...DEFAULT_SETTINGS.chat, model: modelId },
  });
  qc.setQueryData(modelsQueryKey, []);
  return qc;
}

function sseResponse(): Response {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      const chunk = JSON.stringify({ choices: [{ delta: { content: 'drafted scene text' } }] });
      controller.enqueue(encoder.encode(`data: ${chunk}\n\n`));
      controller.enqueue(encoder.encode('data: [DONE]\n\n'));
      controller.close();
    },
  });
  return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } });
}

describe('ChatSceneTab — bug regressions', () => {
  let fetchMock: FetchMock;

  beforeEach(() => {
    resetApiClientForTests();
    setUnauthorizedHandler(() => {
      useSessionStore.getState().clearSession();
    });
    useSessionStore.setState({
      user: { id: 'u1', username: 'alice', name: 'Alice' },
      status: 'authenticated',
    });
    useChatDraftStore.setState({ drafts: {} });
    useAttachedSelectionStore.getState().reset();
    useErrorStore.getState().reset();
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.mocked(apiStream).mockReset();
    setUnauthorizedHandler(null);
    resetApiClientForTests();
    useSessionStore.setState({ user: null, status: 'idle' });
    useChatDraftStore.setState({ drafts: {} });
    useAttachedSelectionStore.getState().reset();
    useErrorStore.getState().reset();
  });

  it('a failed ask-chat send shows the error banner with NO unhandled promise rejection and NO auto-title', async () => {
    fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('/api/chapters/ch1/chats') && !url.includes('/messages')) {
        return jsonResponse(200, {
          chats: [
            {
              id: 'c1',
              chapterId: 'ch1',
              title: 'Existing chat',
              kind: 'ask',
              messageCount: 0,
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
              lastActivityAt: new Date().toISOString(),
            },
          ],
        });
      }
      if (url.includes('/api/chats/c1/messages')) {
        return jsonResponse(200, { messages: [] });
      }
      return jsonResponse(404, { error: 'not_mocked' });
    }) as FetchMock;
    vi.stubGlobal('fetch', fetchMock);

    vi.mocked(apiStream).mockRejectedValueOnce(new Error('Venice quota exceeded'));

    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown): void => {
      unhandled.push(reason);
    };
    process.on('unhandledRejection', onUnhandled);
    try {
      const user = userEvent.setup();
      renderWithProviders(<ChatTab chapterId="ch1" editor={null} />, makeModelClient());
      await screen.findByRole('button', { name: /Chat: Existing chat/ });

      const textarea = await screen.findByLabelText('Message');
      await user.type(textarea, 'hello world');
      await user.click(screen.getByRole('button', { name: 'Send' }));

      // Error surfaces through the shared banner path…
      await screen.findByTestId('venice-error-banner');
      // …and the first-turn auto-title must NOT fire on the failure path.
      const patchCalls = (fetchMock.mock.calls as [string, RequestInit?][]).filter(
        ([url, init]) =>
          url.includes('/chats/c1') &&
          !url.includes('/messages') &&
          init?.method?.toUpperCase() === 'PATCH',
      );
      expect(patchCalls).toHaveLength(0);

      // Give a dangling rejection time to reach the process handler.
      await new Promise((r) => setTimeout(r, 20));
      expect(unhandled).toHaveLength(0);
    } finally {
      process.off('unhandledRejection', onUnhandled);
    }
  });

  it('forwards the attached selection on a scene send', async () => {
    fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('/api/chapters/ch1/chats') && !url.includes('/messages')) {
        return jsonResponse(200, {
          chats: [
            {
              id: 'sc1',
              chapterId: 'ch1',
              title: 'Existing scene',
              kind: 'scene',
              messageCount: 1,
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
              lastActivityAt: new Date().toISOString(),
            },
          ],
        });
      }
      if (url.includes('/api/chats/sc1/messages')) {
        return jsonResponse(200, { messages: [] });
      }
      return jsonResponse(404, { error: 'not_mocked' });
    }) as FetchMock;
    vi.stubGlobal('fetch', fetchMock);

    vi.mocked(apiStream).mockResolvedValueOnce(sseResponse());

    useAttachedSelectionStore.getState().setAttachedSelection({
      text: 'Linda sat alone on the veranda.',
      chapter: { id: 'ch1', number: 3, title: 'The Veranda' },
    });

    const user = userEvent.setup();
    renderWithProviders(<SceneTab chapterId="ch1" editor={null} />, makeModelClient());
    await screen.findByRole('button', { name: /Scene session: Existing/ });

    const textarea = await screen.findByLabelText('Message');
    await user.type(textarea, 'Continue the confrontation');
    await user.keyboard('{Control>}{Enter}{/Control}');

    await waitFor(() => {
      const calls = vi.mocked(apiStream).mock.calls;
      expect(calls.length).toBeGreaterThan(0);
      const init = calls[calls.length - 1][1] as { body?: Record<string, unknown> };
      expect(init.body?.attachment).toEqual({
        selectionText: 'Linda sat alone on the veranda.',
        chapterId: 'ch1',
      });
    });
  });
});
