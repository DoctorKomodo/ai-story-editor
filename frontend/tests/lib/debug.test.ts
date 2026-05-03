import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { isDebugMode, setDebugMode } from '@/lib/debug';

const STORAGE_KEY = 'inkwell:debug';

describe('isDebugMode / setDebugMode', () => {
  beforeEach(() => {
    localStorage.removeItem(STORAGE_KEY);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    localStorage.removeItem(STORAGE_KEY);
  });

  it('returns true when import.meta.env.DEV is true', () => {
    vi.stubEnv('DEV', true);
    // Re-import not needed — debug.ts reads the env on call, not at import.
    expect(isDebugMode()).toBe(true);
  });

  it('returns true when localStorage opt-in is set, even if DEV is false', () => {
    vi.stubEnv('DEV', false);
    setDebugMode(true);
    expect(isDebugMode()).toBe(true);
  });

  it('returns false when DEV is false and no opt-in', () => {
    vi.stubEnv('DEV', false);
    expect(isDebugMode()).toBe(false);
  });

  it('setDebugMode(false) clears the localStorage opt-in', () => {
    vi.stubEnv('DEV', false);
    setDebugMode(true);
    setDebugMode(false);
    expect(isDebugMode()).toBe(false);
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
  });
});
