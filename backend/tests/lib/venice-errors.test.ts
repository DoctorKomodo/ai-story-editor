// [V11] Unit tests for parseRetryAfter helper.
// Covers delta-seconds form, HTTP-date form, and edge cases.

import { describe, expect, it, vi, afterEach } from 'vitest';
import { parseRetryAfter } from '../../src/lib/venice-errors';

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
});
