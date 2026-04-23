// [V11] Venice error mapping helper.
//
// Maps openai SDK APIError subclasses to user-friendly HTTP responses.
// Never echoes Venice's raw error body or stack traces to the client.
// Never logs the plaintext Venice API key.
//
// Returns true when it handled the error (response written); false when the
// error is not a Venice APIError so the caller can propagate to next(err).

import type { Response } from 'express';
import { APIError, AuthenticationError, RateLimitError } from 'openai';

// Re-export so route files stay insulated from the `openai` package boundary.
// Keeps the SDK import surface contained to this module + lib/venice.ts.
export { AuthenticationError, RateLimitError } from 'openai';

// The openai SDK's `APIError.headers` is typed as
// `Record<string, string | null | undefined>` — a plain lowercase-keyed object,
// NOT the DOM `Headers` type. Access via bracket notation.
type SdkHeaders = Record<string, string | null | undefined>;

/**
 * Parse the `retry-after` response header to a number of seconds.
 * Handles both the delta-seconds form ("60") and the HTTP-date form.
 * Returns null when the header is absent or unparseable.
 */
export function parseRetryAfter(
  headers: SdkHeaders | null | undefined,
): number | null {
  const raw = headers?.['retry-after'] ?? null;
  if (!raw) return null;

  // Delta-seconds form: "60"
  const asInt = parseInt(raw, 10);
  if (!isNaN(asInt) && String(asInt) === raw.trim()) return asInt;

  // HTTP-date form: "Thu, 23 Apr 2026 12:00:00 GMT"
  const date = Date.parse(raw);
  if (!isNaN(date)) {
    const diffSeconds = Math.ceil((date - Date.now()) / 1000);
    return diffSeconds > 0 ? diffSeconds : 0;
  }

  return null;
}

export interface VeniceErrorBody {
  error: {
    code: string;
    message: string;
    retryAfterSeconds?: number | null;
  };
}

/**
 * Try to map `err` to a user-friendly HTTP response.
 *
 * @param err   The caught error.
 * @param res   Express Response — written when this function returns true.
 * @param userId  Optional user id for server-side logging (never the key itself).
 * @returns true  when the error was handled (response written).
 *          false when `err` is not a Venice APIError — caller should next(err).
 */
export function mapVeniceError(
  err: unknown,
  res: Response,
  userId?: string,
): boolean {
  if (!(err instanceof APIError)) return false;

  // 401 — Venice rejected the key. Log server-side only; never echo Venice's
  // body which may include key fragments in error messages.
  if (err instanceof AuthenticationError) {
    console.error('[V11] Venice rejected key for user', userId ?? '(unknown)');
    res.status(400).json({
      error: {
        code: 'venice_key_invalid',
        message: 'Your Venice API key was rejected. Please update it in Settings.',
      },
    } satisfies VeniceErrorBody);
    return true;
  }

  // 429 — rate limited
  if (err instanceof RateLimitError) {
    const retryAfterSeconds = parseRetryAfter(err.headers);
    res.status(429).json({
      error: {
        code: 'venice_rate_limited',
        message: 'Venice is rate limiting this request. Try again shortly.',
        retryAfterSeconds,
      },
    } satisfies VeniceErrorBody);
    return true;
  }

  // 502 / 503 / 504 — service unavailable
  if (err.status === 502 || err.status === 503 || err.status === 504) {
    res.status(502).json({
      error: {
        code: 'venice_unavailable',
        message: 'Venice is temporarily unavailable. Try again shortly.',
      },
    } satisfies VeniceErrorBody);
    return true;
  }

  // Any other non-2xx from Venice
  console.error('[V11] Venice returned unexpected status', err.status, 'for user', userId ?? '(unknown)');
  res.status(502).json({
    error: {
      code: 'venice_error',
      message: 'Venice returned an unexpected error.',
    },
  } satisfies VeniceErrorBody);
  return true;
}

/**
 * Write a Venice error as an SSE terminal frame.
 * Used in the streaming path after headers have been flushed.
 *
 * @returns true when `err` was a Venice APIError (SSE frame written).
 *          false otherwise — caller should write its own stream_error frame.
 */
export function mapVeniceErrorToSse(
  err: unknown,
  write: (data: string) => void,
  userId?: string,
): boolean {
  if (!(err instanceof APIError)) return false;

  let code: string;
  let retryAfterSeconds: number | null | undefined;

  if (err instanceof AuthenticationError) {
    console.error('[V11] Venice rejected key for user (SSE)', userId ?? '(unknown)');
    code = 'venice_key_invalid';
  } else if (err instanceof RateLimitError) {
    code = 'venice_rate_limited';
    retryAfterSeconds = parseRetryAfter(err.headers);
  } else if (err.status === 502 || err.status === 503 || err.status === 504) {
    code = 'venice_unavailable';
  } else {
    console.error('[V11] Venice unexpected status (SSE)', err.status, 'for user', userId ?? '(unknown)');
    code = 'venice_error';
  }

  const payload: Record<string, unknown> = { error: code };
  if (retryAfterSeconds !== undefined) payload.retryAfterSeconds = retryAfterSeconds;
  write(`data: ${JSON.stringify(payload)}\n\n`);
  write('data: [DONE]\n\n');
  return true;
}
