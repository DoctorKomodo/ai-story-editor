import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/lib/api';
import { runStreamingAI } from '@/lib/streamingAI';

// Mock apiStream to control the Response we feed in.
vi.mock('@/lib/api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api')>('@/lib/api');
  return {
    ...actual,
    apiStream: vi.fn(),
  };
});

import { apiStream } from '@/lib/api';

function makeSseResponse(events: string[], extraHeaders: Record<string, string> = {}): Response {
  const body = events.join('') + 'data: [DONE]\n\n';
  return new Response(body, {
    status: 200,
    headers: { 'content-type': 'text/event-stream', ...extraHeaders },
  });
}

describe('runStreamingAI', () => {
  beforeEach(() => {
    vi.mocked(apiStream).mockReset();
  });

  it('forwards chunk deltas via onChunk', async () => {
    const chunks: string[] = [];
    vi.mocked(apiStream).mockResolvedValue(
      makeSseResponse([
        `data: ${JSON.stringify({ choices: [{ delta: { content: 'Hello ' } }] })}\n\n`,
        `data: ${JSON.stringify({ choices: [{ delta: { content: 'world' } }] })}\n\n`,
      ]),
    );
    await runStreamingAI({
      endpoint: '/test',
      body: {},
      signal: new AbortController().signal,
      onChunk: (d) => chunks.push(d),
    });
    expect(chunks).toEqual(['Hello ', 'world']);
  });

  it('forwards citations via onCitations when provided', async () => {
    const seen: unknown[] = [];
    vi.mocked(apiStream).mockResolvedValue(
      makeSseResponse([
        `event: citations\ndata: ${JSON.stringify([{ url: 'https://x', title: 'X', snippet: 'a snippet', publishedAt: null }])}\n\n`,
        `data: ${JSON.stringify({ choices: [{ delta: { content: 'ok' } }] })}\n\n`,
      ]),
    );
    await runStreamingAI({
      endpoint: '/test',
      body: {},
      signal: new AbortController().signal,
      onChunk: () => {},
      onCitations: (c) => seen.push(c),
    });
    expect(seen).toHaveLength(1);
    expect(Array.isArray(seen[0])).toBe(true);
  });

  it('throws ApiError(502, message, code) on error event with code preserved', async () => {
    vi.mocked(apiStream).mockResolvedValue(
      makeSseResponse([
        `event: error\ndata: ${JSON.stringify({ error: 'boom', code: 'rate_limited' })}\n\n`,
      ]),
    );
    await expect(
      runStreamingAI({
        endpoint: '/test',
        body: {},
        signal: new AbortController().signal,
        onChunk: () => {},
      }),
    ).rejects.toMatchObject({
      status: 502,
      message: 'boom',
      code: 'rate_limited',
    });
  });

  it('throws ApiError(502, "Empty response body") when res.body is null', async () => {
    vi.mocked(apiStream).mockResolvedValue(
      new Response(null, { status: 200 }) as unknown as Response,
    );
    await expect(
      runStreamingAI({
        endpoint: '/test',
        body: {},
        signal: new AbortController().signal,
        onChunk: () => {},
      }),
    ).rejects.toBeInstanceOf(ApiError);
  });

  it('calls onResponseHeaders with the Response before reading body', async () => {
    let capturedHeaders: Headers | null = null;
    vi.mocked(apiStream).mockResolvedValue(makeSseResponse([], { 'x-test': 'value' }));
    await runStreamingAI({
      endpoint: '/test',
      body: {},
      signal: new AbortController().signal,
      onChunk: () => {},
      onResponseHeaders: (res) => {
        capturedHeaders = res.headers;
      },
    });
    expect(capturedHeaders?.get('x-test')).toBe('value');
  });

  it('resolves when stream exhausts without explicit [DONE]', async () => {
    vi.mocked(apiStream).mockResolvedValue(
      new Response(`data: ${JSON.stringify({ choices: [{ delta: { content: 'x' } }] })}\n\n`, {
        status: 200,
        headers: { 'content-type': 'text/event-stream' },
      }),
    );
    await expect(
      runStreamingAI({
        endpoint: '/test',
        body: {},
        signal: new AbortController().signal,
        onChunk: () => {},
      }),
    ).resolves.toBeUndefined();
  });

  it('falls back to "Stream failed" when error frame has empty message string', async () => {
    vi.mocked(apiStream).mockResolvedValue(
      makeSseResponse([`event: error\ndata: ${JSON.stringify({ error: '', code: 'oops' })}\n\n`]),
    );
    await expect(
      runStreamingAI({
        endpoint: '/test',
        body: {},
        signal: new AbortController().signal,
        onChunk: () => {},
      }),
    ).rejects.toMatchObject({ status: 502, message: 'Stream failed', code: 'oops' });
  });

  it('silently skips citations frame when onCitations is not provided', async () => {
    vi.mocked(apiStream).mockResolvedValue(
      makeSseResponse([
        `event: citations\ndata: ${JSON.stringify([{ url: 'https://x', title: 'X', snippet: 's', publishedAt: null }])}\n\n`,
        `data: ${JSON.stringify({ choices: [{ delta: { content: 'ok' } }] })}\n\n`,
      ]),
    );
    await expect(
      runStreamingAI({
        endpoint: '/test',
        body: {},
        signal: new AbortController().signal,
        onChunk: () => {},
        // onCitations omitted
      }),
    ).resolves.toBeUndefined();
  });
});
