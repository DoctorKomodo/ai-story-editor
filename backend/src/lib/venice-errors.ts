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

// In openai v6 the SDK's `APIError.headers` is the WHATWG `Headers` class
// (from `fetch`). Access via `.get(name)`. We accept either that shape or a
// plain lowercase-keyed record so tests can still pass literal objects.
type SdkHeaders = Headers | Record<string, string | null | undefined>;

function readHeader(headers: SdkHeaders | null | undefined, name: string): string | null {
  if (!headers) return null;
  if (typeof (headers as Headers).get === 'function') {
    return (headers as Headers).get(name);
  }
  return (headers as Record<string, string | null | undefined>)[name] ?? null;
}

// [V27] Threshold (in seconds) used to disambiguate a delta-seconds value from
// a unix timestamp on `x-ratelimit-reset-*` headers. 10_000_000 s ≈ 116 days,
// which is far larger than any plausible rate-limit window but far smaller
// than any unix timestamp after 1970-04-26. Values above the threshold are
// treated as unix seconds since epoch; values at-or-below are treated as a
// delta-seconds countdown.
const UNIX_TS_THRESHOLD_SECONDS = 10_000_000;

/**
 * Parse one of the `x-ratelimit-reset-*` header forms to a delta in seconds
 * from now. Returns null when the value is missing / unparseable.
 *
 * Accepted forms (in order):
 *   1. integer delta-seconds (e.g. "30")
 *   2. integer unix timestamp in seconds (e.g. "1714000000") — disambiguated
 *      from delta-seconds by UNIX_TS_THRESHOLD_SECONDS.
 *   3. ISO-8601 / RFC 2822 date string — parsed via Date.parse.
 */
function parseResetHeader(raw: string | null | undefined): number | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;

  // Integer form — either delta-seconds or unix timestamp.
  const asInt = parseInt(trimmed, 10);
  if (!Number.isNaN(asInt) && String(asInt) === trimmed) {
    if (asInt > UNIX_TS_THRESHOLD_SECONDS) {
      // Treat as unix seconds since epoch.
      const diffSeconds = Math.ceil((asInt * 1000 - Date.now()) / 1000);
      return diffSeconds > 0 ? diffSeconds : 0;
    }
    // Treat as delta-seconds countdown; clamp negatives to 0.
    return asInt > 0 ? asInt : 0;
  }

  // Last resort: try ISO-8601 / RFC 2822.
  const date = Date.parse(trimmed);
  if (!Number.isNaN(date)) {
    const diffSeconds = Math.ceil((date - Date.now()) / 1000);
    return diffSeconds > 0 ? diffSeconds : 0;
  }

  return null;
}

/**
 * Parse the `retry-after` response header to a number of seconds.
 * Handles both the delta-seconds form ("60") and the HTTP-date form.
 *
 * [V27] When `retry-after` is absent or unparseable, falls back to
 * `x-ratelimit-reset-requests` / `x-ratelimit-reset-tokens` (Venice may
 * populate only these on chat-completion 429s per the V22 audit). Takes the
 * minimum (soonest) of whichever reset-* values parse to a non-negative
 * number. `retry-after` always wins when it parses — precedence beats
 * magnitude.
 *
 * Returns null when none of the three headers are present / parseable.
 */
export function parseRetryAfter(headers: SdkHeaders | null | undefined): number | null {
  const raw = readHeader(headers, 'retry-after');
  if (raw) {
    // Delta-seconds form: "60"
    const asInt = parseInt(raw, 10);
    if (!Number.isNaN(asInt) && String(asInt) === raw.trim()) return asInt;

    // HTTP-date form: "Thu, 23 Apr 2026 12:00:00 GMT"
    const date = Date.parse(raw);
    if (!Number.isNaN(date)) {
      const diffSeconds = Math.ceil((date - Date.now()) / 1000);
      return diffSeconds > 0 ? diffSeconds : 0;
    }
    // Retry-After was present but unparseable — fall through to reset-* fallback.
  }

  // [V27] Fallback to x-ratelimit-reset-* headers.
  const resetRequests = parseResetHeader(readHeader(headers, 'x-ratelimit-reset-requests'));
  const resetTokens = parseResetHeader(readHeader(headers, 'x-ratelimit-reset-tokens'));

  const candidates: number[] = [];
  if (resetRequests !== null) candidates.push(resetRequests);
  if (resetTokens !== null) candidates.push(resetTokens);

  if (candidates.length === 0) return null;
  return Math.min(...candidates);
}

// Scrub any sk-prefixed token (defensive — Venice doesn't intentionally
// echo keys but error formatting upstream can include the bearer fragment).
// 16+ char alphanumeric body matches all current Venice + OpenAI key shapes.
const SK_KEY_RE = /sk-[A-Za-z0-9_-]{16,}/g;

function sanitiseVeniceMessage(raw: string): string {
  return raw.replace(SK_KEY_RE, '[redacted]');
}

/**
 * Extract a human-readable message string from an APIError.
 * Returns the text from `err.error.error.message` when present; undefined otherwise.
 *
 * The double-nesting (`err.error.error.message`) is the SDK shape: the openai SDK
 * sets `err.error` to the raw parsed response body, which Venice wraps in its own
 * `{ error: { message } }` envelope.
 */
function extractVeniceMessage(err: APIError): string | undefined {
  const body = err.error as unknown;
  if (
    body !== null &&
    typeof body === 'object' &&
    'error' in body &&
    body.error !== null &&
    typeof body.error === 'object' &&
    'message' in body.error &&
    typeof (body.error as { message: unknown }).message === 'string'
  ) {
    return (body.error as { message: string }).message;
  }
  return undefined;
}

export interface VeniceErrorBody {
  error: {
    code: string;
    message: string;
    retryAfterSeconds?: number | null;
    details?: { veniceMessage?: string };
  };
}

export interface VeniceErrorContext {
  userId: string | undefined;
  route: 'ai-models' | 'ai-complete' | 'chat';
}

interface MappedError {
  httpStatus: number;
  code: string;
  message: string;
  retryAfterSeconds: number | null;
}

function classify(err: APIError): MappedError {
  if (err instanceof AuthenticationError) {
    return {
      httpStatus: 400,
      code: 'venice_key_invalid',
      message: 'Your Venice API key was rejected. Please update it in Settings.',
      retryAfterSeconds: null,
    };
  }
  if (err instanceof RateLimitError) {
    return {
      httpStatus: 429,
      code: 'venice_rate_limited',
      message: 'Venice is rate limiting this request. Try again shortly.',
      retryAfterSeconds: parseRetryAfter(err.headers),
    };
  }
  if (err.status === 402) {
    return {
      httpStatus: 402,
      code: 'venice_insufficient_balance',
      message:
        'Your Venice account is out of credits. Top up at https://venice.ai/settings/api to continue.',
      retryAfterSeconds: null,
    };
  }
  if (err.status === 502 || err.status === 503 || err.status === 504) {
    return {
      httpStatus: 502,
      code: 'venice_unavailable',
      message: 'Venice is temporarily unavailable. Try again shortly.',
      retryAfterSeconds: null,
    };
  }
  if (err.status === 400 || err.status === 404 || err.status === 422) {
    return {
      httpStatus: err.status,
      code: 'venice_error',
      message: 'Venice rejected the request.',
      retryAfterSeconds: null,
    };
  }
  return {
    httpStatus: 502,
    code: 'venice_error',
    message: 'Venice returned an unexpected error.',
    retryAfterSeconds: null,
  };
}

function logVeniceError(
  ctx: VeniceErrorContext,
  classified: MappedError,
  upstreamStatus: number,
  veniceMessage: string | undefined,
  streaming: boolean,
): void {
  console.error(
    '[venice.error]',
    JSON.stringify({
      route: ctx.route,
      userId: ctx.userId ?? null,
      code: classified.code,
      upstreamStatus,
      retryAfterSeconds: classified.retryAfterSeconds,
      veniceMessage: veniceMessage ?? null,
      streaming,
    }),
  );
}

/**
 * Try to map `err` to a user-friendly HTTP response.
 *
 * @param err   The caught error.
 * @param res   Express Response — written when this function returns true.
 * @param ctx   Context for structured logging: userId and route name.
 * @returns true  when the error was handled (response written).
 *          false when `err` is not a Venice APIError — caller should next(err).
 */
export function mapVeniceError(err: unknown, res: Response, ctx: VeniceErrorContext): boolean {
  if (!(err instanceof APIError)) return false;

  const classified = classify(err);
  const rawMessage = extractVeniceMessage(err);
  const veniceMessage = rawMessage ? sanitiseVeniceMessage(rawMessage) : undefined;

  const includeRetryAfter =
    classified.code === 'venice_rate_limited' || classified.code === 'venice_insufficient_balance';

  const body: VeniceErrorBody = {
    error: {
      code: classified.code,
      message: classified.message,
      ...(includeRetryAfter ? { retryAfterSeconds: classified.retryAfterSeconds } : {}),
      ...(veniceMessage ? { details: { veniceMessage } } : {}),
    },
  };

  logVeniceError(ctx, classified, err.status, veniceMessage, false);
  res.status(classified.httpStatus).json(body);
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
  ctx: VeniceErrorContext,
): boolean {
  if (!(err instanceof APIError)) return false;

  const classified = classify(err);
  const rawMessage = extractVeniceMessage(err);
  const veniceMessage = rawMessage ? sanitiseVeniceMessage(rawMessage) : undefined;

  const includeRetryAfter =
    classified.code === 'venice_rate_limited' || classified.code === 'venice_insufficient_balance';

  const payload: Record<string, unknown> = {
    error: classified.message,
    code: classified.code,
    message: classified.message,
  };
  if (includeRetryAfter) payload.retryAfterSeconds = classified.retryAfterSeconds;
  if (veniceMessage) payload.details = { veniceMessage };

  logVeniceError(ctx, classified, err.status, veniceMessage, true);
  write(`data: ${JSON.stringify(payload)}\n\n`);
  write('data: [DONE]\n\n');
  return true;
}
