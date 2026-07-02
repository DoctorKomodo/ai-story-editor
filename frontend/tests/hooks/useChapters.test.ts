import { describe, expect, it } from 'vitest';
import { isChapterConflictError } from '@/hooks/useChapters';
import { ApiError } from '@/lib/api';

describe('isChapterConflictError', () => {
  it('returns true for a 409 ApiError with code "conflict"', () => {
    expect(
      isChapterConflictError(new ApiError(409, 'Chapter was modified elsewhere', 'conflict')),
    ).toBe(true);
  });

  it('returns false for a 409 ApiError with a different code', () => {
    expect(
      isChapterConflictError(new ApiError(409, 'Venice key required', 'venice_key_required')),
    ).toBe(false);
  });

  it('returns false for a non-409 ApiError', () => {
    expect(isChapterConflictError(new ApiError(400, 'Bad request', 'validation_error'))).toBe(
      false,
    );
  });

  it('returns false for a plain Error', () => {
    expect(isChapterConflictError(new Error('boom'))).toBe(false);
  });

  it('returns false for a non-error value', () => {
    expect(isChapterConflictError(null)).toBe(false);
    expect(isChapterConflictError(undefined)).toBe(false);
    expect(isChapterConflictError('conflict')).toBe(false);
  });
});
