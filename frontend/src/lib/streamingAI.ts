import { ApiError, apiStream } from '@/lib/api';
import type { Citation } from '@/lib/citations';
import { parseAiSseStream } from '@/lib/sse';

export interface StreamingAIOptions {
  endpoint: string;
  body: object;
  signal: AbortSignal;
  onChunk: (delta: string) => void;
  onCitations?: (citations: Citation[]) => void;
  onResponseHeaders?: (res: Response) => void;
}

/**
 * Run an SSE-streaming AI request. Stateless; consumers own AbortController,
 * state machine, error publication, and re-entrancy. The utility owns wire-
 * protocol heavy lifting only: open, read, dispatch events, throw on error.
 *
 * Error contract: SSE error frames throw `ApiError(502, message, code)`;
 * consumers extract `code` from `(err as ApiError).code` in their catch.
 */
export async function runStreamingAI(opts: StreamingAIOptions): Promise<void> {
  const res = await apiStream(opts.endpoint, {
    method: 'POST',
    body: opts.body,
    signal: opts.signal,
  });
  if (!res.body) {
    throw new ApiError(502, 'Empty response body');
  }
  if (opts.onResponseHeaders) opts.onResponseHeaders(res);
  for await (const event of parseAiSseStream(res.body, opts.signal)) {
    if (event.type === 'chunk') {
      const delta = event.chunk.choices?.[0]?.delta?.content;
      if (typeof delta === 'string' && delta.length > 0) {
        opts.onChunk(delta);
      }
    } else if (event.type === 'citations') {
      if (opts.onCitations) opts.onCitations(event.citations);
    } else if (event.type === 'error') {
      throw new ApiError(
        502,
        event.error.error || 'Stream failed',
        event.error.code ?? 'stream_error',
      );
    } else if (event.type === 'done') {
      return;
    }
  }
  // Stream exhausted without [DONE] — treat as completion.
}
