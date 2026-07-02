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

describe('validateEncryptionEnv() — TEST_FAST_ARGON2 guard', () => {
  it('throws (boot refuses) when TEST_FAST_ARGON2 is set with NODE_ENV=production', () => {
    const warn = vi.fn();
    expect(() =>
      validateEncryptionEnv({
        env: { TEST_FAST_ARGON2: '1', NODE_ENV: 'production' } as NodeJS.ProcessEnv,
        warn,
      }),
    ).toThrow(/TEST_FAST_ARGON2/);
  });

  it('warns (does not throw) when set with a non-test, non-production NODE_ENV', () => {
    const warn = vi.fn();
    expect(() =>
      validateEncryptionEnv({
        env: { TEST_FAST_ARGON2: '1', NODE_ENV: 'development' } as NodeJS.ProcessEnv,
        warn,
      }),
    ).not.toThrow();
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/TEST_FAST_ARGON2/));
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('warns when set with NODE_ENV unset', () => {
    const warn = vi.fn();
    validateEncryptionEnv({ env: { TEST_FAST_ARGON2: '1' } as NodeJS.ProcessEnv, warn });
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/TEST_FAST_ARGON2/));
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('is silent when set with NODE_ENV=test', () => {
    const warn = vi.fn();
    expect(() =>
      validateEncryptionEnv({
        env: { TEST_FAST_ARGON2: '1', NODE_ENV: 'test' } as NodeJS.ProcessEnv,
        warn,
      }),
    ).not.toThrow();
    expect(warn).not.toHaveBeenCalled();
  });
});
