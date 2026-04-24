// [V11] Unit tests for parseRetryAfter helper.
// [V24] Unit tests for the 402 INSUFFICIENT_BALANCE branch.
// Covers delta-seconds form, HTTP-date form, and edge cases.

import type { Response } from 'express';
import { APIError } from 'openai';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mapVeniceError, mapVeniceErrorToSse, parseRetryAfter } from '../../src/lib/venice-errors';

describe('parseRetryAfter', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('delta-seconds "60" → 60', () => {
    expect(parseRetryAfter({ 'retry-after': '60' })).toBe(60);
  });

  it('delta-seconds "0" → 0', () => {
    expect(parseRetryAfter({ 'retry-after': '0' })).toBe(0);
  });

  it('non-numeric string "abc" → null', () => {
    expect(parseRetryAfter({ 'retry-after': 'abc' })).toBeNull();
  });

  it('missing header (undefined value) → null', () => {
    expect(parseRetryAfter({ 'retry-after': undefined })).toBeNull();
  });

  it('missing header (null value) → null', () => {
    expect(parseRetryAfter({ 'retry-after': null })).toBeNull();
  });

  it('null headers object → null', () => {
    expect(parseRetryAfter(null)).toBeNull();
  });

  it('undefined headers object → null', () => {
    expect(parseRetryAfter(undefined)).toBeNull();
  });

  it('HTTP-date 90 seconds in the future → 90', () => {
    // Mock now to 2026-05-01T12:00:00Z
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-01T12:00:00Z'));

    // retry-after is 90 s in the future
    const result = parseRetryAfter({ 'retry-after': 'Fri, 01 May 2026 12:01:30 GMT' });
    expect(result).toBe(90);
  });

  it('HTTP-date in the past → 0', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-01T12:00:00Z'));

    // retry-after is 60 s in the past
    const result = parseRetryAfter({ 'retry-after': 'Fri, 01 May 2026 11:59:00 GMT' });
    expect(result).toBe(0);
  });

  // [V27] Fallback to x-ratelimit-reset-* headers when Retry-After is absent.
  describe('[V27] x-ratelimit-reset-* fallback', () => {
    it('(a) only Retry-After set (delta-seconds) → Retry-After wins', () => {
      expect(parseRetryAfter({ 'retry-after': '42' })).toBe(42);
    });

    it('(a) only Retry-After set (HTTP-date) → Retry-After wins', () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-05-01T12:00:00Z'));
      const result = parseRetryAfter({
        'retry-after': 'Fri, 01 May 2026 12:00:30 GMT',
      });
      expect(result).toBe(30);
    });

    it('(b) only x-ratelimit-reset-tokens set (delta-seconds "15") → 15', () => {
      expect(parseRetryAfter({ 'x-ratelimit-reset-tokens': '15' })).toBe(15);
    });

    it('(b) only x-ratelimit-reset-tokens set (unix-ts) → delta from now', () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-05-01T12:00:00Z'));
      // unix seconds for 2026-05-01T12:00:45Z = 45 s in the future
      const futureTs = Math.floor(new Date('2026-05-01T12:00:45Z').getTime() / 1000);
      expect(
        parseRetryAfter({
          'x-ratelimit-reset-tokens': String(futureTs),
        }),
      ).toBe(45);
    });

    it('(b) only x-ratelimit-reset-requests set (delta-seconds "25") → 25', () => {
      expect(parseRetryAfter({ 'x-ratelimit-reset-requests': '25' })).toBe(25);
    });

    it('(c) both reset-requests and reset-tokens set — soonest (smaller) wins', () => {
      expect(
        parseRetryAfter({
          'x-ratelimit-reset-requests': '60',
          'x-ratelimit-reset-tokens': '10',
        }),
      ).toBe(10);
    });

    it('(c) both reset-* set, reverse order — soonest still wins', () => {
      expect(
        parseRetryAfter({
          'x-ratelimit-reset-requests': '5',
          'x-ratelimit-reset-tokens': '90',
        }),
      ).toBe(5);
    });

    it('(d) none of the three headers set → null', () => {
      expect(parseRetryAfter({})).toBeNull();
    });

    it('(d) all three headers null-valued → null', () => {
      expect(
        parseRetryAfter({
          'retry-after': null,
          'x-ratelimit-reset-requests': null,
          'x-ratelimit-reset-tokens': null,
        }),
      ).toBeNull();
    });

    it('(e) Retry-After takes precedence over reset-* when both present', () => {
      expect(
        parseRetryAfter({
          'retry-after': '7',
          'x-ratelimit-reset-requests': '100',
          'x-ratelimit-reset-tokens': '200',
        }),
      ).toBe(7);
    });

    it('(f) all three set but reset-* numerically smaller → Retry-After still wins', () => {
      // Precedence beats magnitude: the spec says "try Retry-After first".
      expect(
        parseRetryAfter({
          'retry-after': '120',
          'x-ratelimit-reset-requests': '10',
          'x-ratelimit-reset-tokens': '5',
        }),
      ).toBe(120);
    });

    it('reset-tokens as ISO-8601 date string → delta from now', () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-05-01T12:00:00Z'));
      expect(
        parseRetryAfter({
          'x-ratelimit-reset-tokens': '2026-05-01T12:00:20Z',
        }),
      ).toBe(20);
    });

    it('reset-* unix-ts in the past → clamped to 0', () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-05-01T12:00:00Z'));
      const pastTs = Math.floor(new Date('2026-05-01T11:59:00Z').getTime() / 1000);
      expect(
        parseRetryAfter({
          'x-ratelimit-reset-tokens': String(pastTs),
        }),
      ).toBe(0);
    });

    it('reset-* unparseable garbage → null (when no other header parses)', () => {
      expect(
        parseRetryAfter({
          'x-ratelimit-reset-requests': 'not-a-time',
          'x-ratelimit-reset-tokens': 'also-garbage',
        }),
      ).toBeNull();
    });

    it('Retry-After unparseable but reset-* present → fall through to reset-*', () => {
      // When Retry-After is present but garbage, we fall through to the
      // reset-* fallback rather than returning null immediately.
      expect(
        parseRetryAfter({
          'retry-after': 'garbage',
          'x-ratelimit-reset-tokens': '20',
        }),
      ).toBe(20);
    });

    it('only one reset-* parses, the other is garbage → returns the parsed one', () => {
      expect(
        parseRetryAfter({
          'x-ratelimit-reset-requests': 'garbage',
          'x-ratelimit-reset-tokens': '12',
        }),
      ).toBe(12);
    });
  });
});

// [V24] 402 INSUFFICIENT_BALANCE mapping.
describe('mapVeniceError — 402 INSUFFICIENT_BALANCE', () => {
  // Sentinel used to prove the decrypted Venice key never appears in the
  // response body or SSE frame. It's placed into the faked APIError body and
  // message so we can assert on its absence post-mapping.
  const KEY_SENTINEL = 'sk-venice-DO-NOT-LEAK-123456789';

  function makeFakeApiError(): APIError {
    // openai APIError constructor: (status, error, message, headers)
    // We deliberately stash the sentinel into the body and message to confirm
    // the mapper does not echo Venice's raw body back to the client.
    return new APIError(
      402,
      {
        error: {
          code: 'INSUFFICIENT_BALANCE',
          message: `Account out of credits; key=${KEY_SENTINEL}`,
        },
      },
      `Venice rejected call using key=${KEY_SENTINEL}`,
      {},
    );
  }

  function makeResStub() {
    const state: { statusCode?: number; body?: unknown } = {};
    const res = {
      status(code: number) {
        state.statusCode = code;
        return this;
      },
      json(body: unknown) {
        state.body = body;
        return this;
      },
    } as unknown as Response;
    return { res, state };
  }

  it('JSON path → HTTP 402, venice_insufficient_balance, hint URL, retryAfterSeconds=null', () => {
    const { res, state } = makeResStub();
    const handled = mapVeniceError(makeFakeApiError(), res, 'user-123');

    expect(handled).toBe(true);
    expect(state.statusCode).toBe(402);
    expect(state.body).toEqual({
      error: {
        code: 'venice_insufficient_balance',
        message:
          'Your Venice account is out of credits. Top up at https://venice.ai/settings/api to continue.',
        retryAfterSeconds: null,
      },
    });

    // No key leakage in the response body.
    expect(JSON.stringify(state.body)).not.toContain(KEY_SENTINEL);
  });

  it('SSE path → venice_insufficient_balance frame then [DONE]', () => {
    const frames: string[] = [];
    const handled = mapVeniceErrorToSse(
      makeFakeApiError(),
      (data) => frames.push(data),
      'user-123',
    );

    expect(handled).toBe(true);
    expect(frames).toHaveLength(2);

    // First frame: JSON payload with our code + hint URL.
    const first = frames[0];
    expect(first.startsWith('data: ')).toBe(true);
    expect(first.endsWith('\n\n')).toBe(true);
    const parsed = JSON.parse(first.slice('data: '.length).trimEnd()) as {
      error: string;
      retryAfterSeconds: number | null;
      message: string;
    };
    expect(parsed.error).toBe('venice_insufficient_balance');
    expect(parsed.retryAfterSeconds).toBeNull();
    expect(parsed.message).toContain('venice.ai/settings/api');

    // Terminal frame.
    expect(frames[1]).toBe('data: [DONE]\n\n');

    // No key leakage in any SSE frame.
    for (const frame of frames) {
      expect(frame).not.toContain(KEY_SENTINEL);
    }
  });
});
