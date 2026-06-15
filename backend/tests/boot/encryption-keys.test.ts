import { describe, expect, it, vi } from 'vitest';
import { validateEncryptionEnv } from '../../src/boot/env-validation';

describe('validateEncryptionEnv() — no required encryption env secret', () => {
  it('does not throw when no encryption env vars are set', () => {
    expect(() => validateEncryptionEnv({ env: {} as NodeJS.ProcessEnv })).not.toThrow();
  });

  it('warns (does not throw) if a stale APP_ENCRYPTION_KEY lingers', () => {
    const warn = vi.fn();
    validateEncryptionEnv({ env: { APP_ENCRYPTION_KEY: 'leftover' } as NodeJS.ProcessEnv, warn });
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/APP_ENCRYPTION_KEY/));
  });

  it('warns if a stale CONTENT_ENCRYPTION_KEY lingers', () => {
    const warn = vi.fn();
    validateEncryptionEnv({
      env: { CONTENT_ENCRYPTION_KEY: 'leftover' } as NodeJS.ProcessEnv,
      warn,
    });
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/CONTENT_ENCRYPTION_KEY/));
  });
});
