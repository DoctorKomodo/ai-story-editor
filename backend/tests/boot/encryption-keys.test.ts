import { describe, expect, it, vi } from 'vitest';
import { validateEncryptionEnv } from '../../src/boot/env-validation';

describe('validateEncryptionEnv() — no required encryption env secret', () => {
  it('does not throw and emits no warnings when no stale vars are set', () => {
    const warn = vi.fn();
    expect(() => validateEncryptionEnv({ env: {} as NodeJS.ProcessEnv, warn })).not.toThrow();
    expect(warn).not.toHaveBeenCalled();
  });

  it('warns (does not throw) if a stale APP_ENCRYPTION_KEY lingers', () => {
    const warn = vi.fn();
    validateEncryptionEnv({ env: { APP_ENCRYPTION_KEY: 'leftover' } as NodeJS.ProcessEnv, warn });
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/APP_ENCRYPTION_KEY/));
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('warns if a stale CONTENT_ENCRYPTION_KEY lingers', () => {
    const warn = vi.fn();
    validateEncryptionEnv({
      env: { CONTENT_ENCRYPTION_KEY: 'leftover' } as NodeJS.ProcessEnv,
      warn,
    });
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/CONTENT_ENCRYPTION_KEY/));
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('warns if a stale JWT_SECRET lingers', () => {
    const warn = vi.fn();
    validateEncryptionEnv({ env: { JWT_SECRET: 'x' } as NodeJS.ProcessEnv, warn });
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/JWT_SECRET/));
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('warns if a stale REFRESH_TOKEN_SECRET lingers', () => {
    const warn = vi.fn();
    validateEncryptionEnv({ env: { REFRESH_TOKEN_SECRET: 'x' } as NodeJS.ProcessEnv, warn });
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/REFRESH_TOKEN_SECRET/));
    expect(warn).toHaveBeenCalledTimes(1);
  });
});
