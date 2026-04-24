/**
 * SSE parser for the Venice `/api/ai/complete` stream (F15).
 *
 * Consumes the raw ReadableStream body returned by `apiStream` and yields
 * a discriminated union of events:
 *   - `chunk`  — an OpenAI-style streaming chunk whose `choices[0].delta.content`
 *                should be appended to the accumulating assistant text.
 *   - `error`  — a mid-stream error frame (`data: {"error":"...","code":"..."}`).
 *                The caller should flip to an error state; no further chunks
 *                will be emitted.
 *   - `done`   — the `[DONE]` terminator. Iteration completes immediately after.
 *
 * Frames with unparseable JSON are silently skipped — Venice can emit odd
 * whitespace or partial frames at stream boundaries, and throwing here would
 * wedge the hook into an error state for cosmetic noise.
 *
 * F16 later consumes response headers (rate-limit counters) separately; it
 * does not change the frame shape this parser produces.
 */

export interface AiDelta {
  content?: string;
}

export interface AiChunk {
  choices?: Array<{ delta?: AiDelta; finish_reason?: string | null }>;
}

export interface AiStreamError {
  error: string;
  code?: string;
}

export type AiStreamEvent =
  | { type: 'chunk'; chunk: AiChunk }
  | { type: 'error'; error: AiStreamError }
  | { type: 'done' };

function tryParseFrame(raw: string): AiStreamEvent | null {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return null;
  if (trimmed === '[DONE]') return { type: 'done' };
  try {
    const parsed: unknown = JSON.parse(trimmed);
    if (parsed && typeof parsed === 'object') {
      const obj = parsed as Record<string, unknown>;
      if (typeof obj.error === 'string') {
        const err: AiStreamError = { error: obj.error };
        if (typeof obj.code === 'string') err.code = obj.code;
        return { type: 'error', error: err };
      }
      return { type: 'chunk', chunk: parsed as AiChunk };
    }
    return null;
  } catch {
    return null;
  }
}

export async function* parseAiSseStream(
  body: ReadableStream<Uint8Array>,
  signal?: AbortSignal,
): AsyncGenerator<AiStreamEvent> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  const onAbort = (): void => {
    // Best-effort — `cancel` rejects any pending `read()` so the for-loop below
    // terminates. Errors here are swallowed since we're already unwinding.
    reader.cancel().catch(() => {
      /* no-op */
    });
  };
  if (signal) {
    if (signal.aborted) {
      onAbort();
      return;
    }
    signal.addEventListener('abort', onAbort, { once: true });
  }

  try {
    // Split on the SSE frame delimiter. Each frame may contain one or more
    // `data: ` prefixed lines — per the Venice contract it's exactly one.
    while (true) {
      if (signal?.aborted) return;
      let chunk: ReadableStreamReadResult<Uint8Array>;
      try {
        chunk = await reader.read();
      } catch {
        // Reader cancelled (abort). Exit cleanly.
        return;
      }
      if (chunk.done) {
        // Flush any trailing partial frame if it's a complete line — Venice
        // always terminates with `\n\n` so this is belt-and-braces.
        const tail = buffer.trim();
        if (tail.startsWith('data:')) {
          const event = tryParseFrame(tail.slice(5));
          if (event) yield event;
        }
        return;
      }
      buffer += decoder.decode(chunk.value, { stream: true });

      // Split on blank lines. Keep the final (possibly partial) segment in
      // the buffer for the next read.
      let sep = buffer.indexOf('\n\n');
      while (sep !== -1) {
        const frame = buffer.slice(0, sep);
        buffer = buffer.slice(sep + 2);
        // SSE frames can have multiple `data:` lines; concatenate their values.
        const lines = frame.split('\n');
        const dataLines: string[] = [];
        for (const line of lines) {
          if (line.startsWith('data:')) {
            // Strip `data:` plus optional single leading space.
            const value = line.slice(5).startsWith(' ') ? line.slice(6) : line.slice(5);
            dataLines.push(value);
          }
        }
        if (dataLines.length > 0) {
          const payload = dataLines.join('\n');
          const event = tryParseFrame(payload);
          if (event) {
            yield event;
            if (event.type === 'done') return;
          }
        }
        sep = buffer.indexOf('\n\n');
      }
    }
  } finally {
    if (signal) signal.removeEventListener('abort', onAbort);
    try {
      reader.releaseLock();
    } catch {
      /* no-op — already released or cancelled */
    }
  }
}
