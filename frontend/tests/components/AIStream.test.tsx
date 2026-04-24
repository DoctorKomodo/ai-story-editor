import { act, render, renderHook, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AIResult } from '@/components/AIResult';
import { useAICompletion } from '@/hooks/useAICompletion';
import { parseAiSseStream } from '@/lib/sse';
import { ApiError, resetApiClientForTests, setAccessToken } from '@/lib/api';

type FetchMock = ReturnType<typeof vi.fn>;

function streamResponse(
  chunks: string[],
  init?: ResponseInit,
  extraHeaders?: Record<string, string>,
): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(chunk));
      }
      controller.close();
    },
  });
  const headers: Record<string, string> = {
    'Content-Type': 'text/event-stream',
    ...(extraHeaders ?? {}),
  };
  return new Response(stream, {
    status: 200,
    headers,
    ...init,
  });
}

function pausedStreamResponse(): {
  response: Response;
  push: (chunk: string) => void;
  end: () => void;
  cancelled: Promise<void>;
} {
  const encoder = new TextEncoder();
  let enqueue!: (chunk: Uint8Array) => void;
  let close!: () => void;
  let cancelResolve!: () => void;
  const cancelled = new Promise<void>((resolve) => {
    cancelResolve = resolve;
  });
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      enqueue = (chunk): void => {
        try {
          controller.enqueue(chunk);
        } catch {
          /* controller already closed */
        }
      };
      close = (): void => {
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      };
    },
    cancel() {
      cancelResolve();
    },
  });
  const response = new Response(stream, {
    status: 200,
    headers: { 'Content-Type': 'text/event-stream' },
  });
  return {
    response,
    push: (chunk): void => {
      enqueue(encoder.encode(chunk));
    },
    end: (): void => {
      close();
    },
    cancelled,
  };
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('F15 · useAICompletion hook', () => {
  let fetchMock: FetchMock;

  beforeEach(() => {
    resetApiClientForTests();
    setAccessToken('tok-x');
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    resetApiClientForTests();
    vi.restoreAllMocks();
  });

  it('streams chunks into accumulated text and lands on status=done', async () => {
    fetchMock.mockResolvedValueOnce(
      streamResponse([
        'data: {"choices":[{"delta":{"content":"Hello, "}}]}\n\n',
        'data: {"choices":[{"delta":{"content":"world."}}]}\n\n',
        'data: [DONE]\n\n',
      ]),
    );

    const { result } = renderHook(() => useAICompletion());

    await act(async () => {
      await result.current.run({
        action: 'continue',
        selectedText: '',
        chapterId: 'ch1',
        storyId: 'st1',
        modelId: 'venice-small',
      });
    });

    expect(result.current.status).toBe('done');
    expect(result.current.text).toBe('Hello, world.');
    expect(result.current.error).toBeNull();
  });

  it('maps pre-stream 409 venice_key_required into status=error', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(409, {
        error: { code: 'venice_key_required', message: 'Add a key first' },
      }),
    );

    const { result } = renderHook(() => useAICompletion());

    await act(async () => {
      await result.current.run({
        action: 'continue',
        selectedText: '',
        chapterId: 'ch1',
        storyId: 'st1',
        modelId: 'venice-small',
      });
    });

    expect(result.current.status).toBe('error');
    expect(result.current.error).toBeInstanceOf(ApiError);
    expect(result.current.error?.code).toBe('venice_key_required');
    expect(result.current.text).toBe('');
  });

  it('flips to status=error with the frame code on a mid-stream error frame', async () => {
    fetchMock.mockResolvedValueOnce(
      streamResponse([
        'data: {"error":"upstream failure","code":"stream_error"}\n\n',
        'data: [DONE]\n\n',
      ]),
    );

    const { result } = renderHook(() => useAICompletion());

    await act(async () => {
      await result.current.run({
        action: 'rephrase',
        selectedText: 'the cat sat',
        chapterId: 'ch1',
        storyId: 'st1',
        modelId: 'venice-small',
      });
    });

    expect(result.current.status).toBe('error');
    expect(result.current.error?.code).toBe('stream_error');
  });

  it('cancel() aborts mid-stream and resets to idle with empty text', async () => {
    const ctrl = pausedStreamResponse();
    fetchMock.mockResolvedValueOnce(ctrl.response);

    const { result } = renderHook(() => useAICompletion());

    // Kick off the stream but do not await — we want to cancel mid-flight.
    let runPromise!: Promise<void>;
    act(() => {
      runPromise = result.current.run({
        action: 'continue',
        selectedText: '',
        chapterId: 'ch1',
        storyId: 'st1',
        modelId: 'venice-small',
      });
    });

    // Push a first chunk so the hook has something in-flight to process.
    await act(async () => {
      ctrl.push('data: {"choices":[{"delta":{"content":"partial"}}]}\n\n');
      // Let the reader pick up the chunk.
      await new Promise((r) => setTimeout(r, 10));
    });

    await waitFor(() => {
      expect(result.current.status).toBe('streaming');
    });

    await act(async () => {
      result.current.cancel();
      // Close the underlying stream so the generator can unwind.
      ctrl.end();
      await runPromise;
    });

    expect(result.current.status).toBe('idle');
    expect(result.current.text).toBe('');
  });

  it('captures x-venice-remaining-* headers into usage state after a run', async () => {
    fetchMock.mockResolvedValueOnce(
      streamResponse(
        [
          'data: {"choices":[{"delta":{"content":"hi"}}]}\n\n',
          'data: [DONE]\n\n',
        ],
        undefined,
        {
          'x-venice-remaining-requests': '482',
          'x-venice-remaining-tokens': '1200000',
        },
      ),
    );

    const { result } = renderHook(() => useAICompletion());

    expect(result.current.usage).toBeNull();

    await act(async () => {
      await result.current.run({
        action: 'continue',
        selectedText: '',
        chapterId: 'ch1',
        storyId: 'st1',
        modelId: 'venice-small',
      });
    });

    expect(result.current.status).toBe('done');
    expect(result.current.usage).toEqual({
      remainingRequests: 482,
      remainingTokens: 1_200_000,
    });
  });

  it('preserves prior usage snapshot when a subsequent response omits the headers', async () => {
    // First run: headers present → usage captured.
    fetchMock.mockResolvedValueOnce(
      streamResponse(
        [
          'data: {"choices":[{"delta":{"content":"hi"}}]}\n\n',
          'data: [DONE]\n\n',
        ],
        undefined,
        {
          'x-venice-remaining-requests': '482',
          'x-venice-remaining-tokens': '1200000',
        },
      ),
    );
    // Second run: no rate-limit headers → should NOT wipe the snapshot.
    fetchMock.mockResolvedValueOnce(
      streamResponse([
        'data: {"choices":[{"delta":{"content":"again"}}]}\n\n',
        'data: [DONE]\n\n',
      ]),
    );

    const { result } = renderHook(() => useAICompletion());

    await act(async () => {
      await result.current.run({
        action: 'continue',
        selectedText: '',
        chapterId: 'ch1',
        storyId: 'st1',
        modelId: 'venice-small',
      });
    });

    expect(result.current.usage).toEqual({
      remainingRequests: 482,
      remainingTokens: 1_200_000,
    });

    await act(async () => {
      await result.current.run({
        action: 'continue',
        selectedText: '',
        chapterId: 'ch1',
        storyId: 'st1',
        modelId: 'venice-small',
      });
    });

    // Prior snapshot preserved — nullish update must not overwrite.
    expect(result.current.usage).toEqual({
      remainingRequests: 482,
      remainingTokens: 1_200_000,
    });
  });

  it('rejects non-integer rate-limit header values (no silent truncation)', async () => {
    fetchMock.mockResolvedValueOnce(
      streamResponse(
        [
          'data: {"choices":[{"delta":{"content":"hi"}}]}\n\n',
          'data: [DONE]\n\n',
        ],
        undefined,
        {
          'x-venice-remaining-requests': '1.5',
          'x-venice-remaining-tokens': 'abc',
        },
      ),
    );

    const { result } = renderHook(() => useAICompletion());

    await act(async () => {
      await result.current.run({
        action: 'continue',
        selectedText: '',
        chapterId: 'ch1',
        storyId: 'st1',
        modelId: 'venice-small',
      });
    });

    // Both headers fail the integer-only parse, so usage must stay null —
    // not silently truncate `"1.5"` to 1 or `"abc"` to NaN.
    expect(result.current.usage).toBeNull();
  });
});

describe('F15 · AIResult component', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('Insert at cursor fires onInsertAtCursor then onDismiss', async () => {
    const onInsertAtCursor = vi.fn();
    const onDismiss = vi.fn();
    const user = userEvent.setup();
    render(
      <AIResult
        status="done"
        text="abc"
        error={null}
        onInsertAtCursor={onInsertAtCursor}
        onDismiss={onDismiss}
      />,
    );

    await user.click(screen.getByRole('button', { name: /insert at cursor/i }));
    expect(onInsertAtCursor).toHaveBeenCalledTimes(1);
    expect(onInsertAtCursor).toHaveBeenCalledWith('abc');
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('Copy writes to clipboard and shows transient "Copied ✓" feedback', async () => {
    vi.useFakeTimers();
    const writeText = vi.fn(() => Promise.resolve());
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });

    render(
      <AIResult
        status="done"
        text="hello world"
        error={null}
        onInsertAtCursor={vi.fn()}
        onDismiss={vi.fn()}
      />,
    );

    // fireEvent avoids userEvent's async pipeline, which fights fake timers.
    const copyBtn = screen.getByRole('button', { name: /^copy$/i });
    await act(async () => {
      copyBtn.click();
      // Flush the `writeText` microtask + the setState it queues.
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(writeText).toHaveBeenCalledWith('hello world');

    expect(screen.getByText(/copied/i)).toBeInTheDocument();

    await act(async () => {
      vi.advanceTimersByTime(2000);
    });

    expect(screen.queryByText(/copied/i)).toBeNull();
  });

  it('renders the friendly venice_key_required message under role=alert on error', () => {
    const error = new ApiError(409, 'missing', 'venice_key_required');
    render(
      <AIResult
        status="error"
        text=""
        error={error}
        onInsertAtCursor={vi.fn()}
        onDismiss={vi.fn()}
      />,
    );

    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent(/add a venice api key in settings/i);
  });
});

describe('F15 · parseAiSseStream parser', () => {
  it('silently skips malformed JSON frames without throwing', async () => {
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode('data: not-json\n\n'));
        controller.enqueue(
          encoder.encode('data: {"choices":[{"delta":{"content":"ok"}}]}\n\n'),
        );
        controller.enqueue(encoder.encode('data: [DONE]\n\n'));
        controller.close();
      },
    });

    const events = [];
    for await (const ev of parseAiSseStream(stream)) {
      events.push(ev);
    }

    // Malformed frame is dropped; only the valid chunk + done remain.
    expect(events).toHaveLength(2);
    expect(events[0]).toEqual({
      type: 'chunk',
      chunk: { choices: [{ delta: { content: 'ok' } }] },
    });
    expect(events[1]).toEqual({ type: 'done' });
  });
});
