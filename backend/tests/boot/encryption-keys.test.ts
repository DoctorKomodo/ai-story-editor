import { describe, expect, it, vi } from 'vitest';
import {
  APP_ENCRYPTION_KEY_BYTES,
  BootValidationError,
  validateEncryptionEnv,
} from '../../src/boot/env-validation';

const VALID_KEY = Buffer.alloc(APP_ENCRYPTION_KEY_BYTES, 0xab).toString('base64');

function envWith(overrides: Record<string, string | undefined>): NodeJS.ProcessEnv {
  const base: Record<string, string | undefined> = {
    APP_ENCRYPTION_KEY: VALID_KEY,
  };
  return { ...base, ...overrides } as NodeJS.ProcessEnv;
}

describe('[E2] validateEncryptionEnv()', () => {
  it('accepts a valid 32-byte base64 APP_ENCRYPTION_KEY', () => {
    expect(() => validateEncryptionEnv({ env: envWith({}) })).not.toThrow();
  });

  it('throws BootValidationError when APP_ENCRYPTION_KEY is missing', () => {
    expect(() =>
      validateEncryptionEnv({ env: envWith({ APP_ENCRYPTION_KEY: undefined }) }),
    ).toThrowError(BootValidationError);
  });

  it('throws BootValidationError when APP_ENCRYPTION_KEY is empty', () => {
    expect(() => validateEncryptionEnv({ env: envWith({ APP_ENCRYPTION_KEY: '' }) })).toThrowError(
      BootValidationError,
    );
  });

  it('throws BootValidationError when APP_ENCRYPTION_KEY decodes to the wrong length', () => {
    const tooShort = Buffer.alloc(16, 0xab).toString('base64');
    expect(() =>
      validateEncryptionEnv({ env: envWith({ APP_ENCRYPTION_KEY: tooShort }) }),
    ).toThrowError(/32 bytes/);
  });

  it('error message includes the generation one-liner so the operator can copy-paste', () => {
    try {
      validateEncryptionEnv({ env: envWith({ APP_ENCRYPTION_KEY: undefined }) });
    } catch (err) {
      expect(err).toBeInstanceOf(BootValidationError);
      expect((err as Error).message).toContain("randomBytes(32).toString('base64')");
      return;
    }
    expect.fail('expected validateEncryptionEnv to throw');
  });

  it('does NOT require CONTENT_ENCRYPTION_KEY — validation passes with it unset', () => {
    expect(() =>
      validateEncryptionEnv({ env: envWith({ CONTENT_ENCRYPTION_KEY: undefined }) }),
    ).not.toThrow();
  });

  it('warns (does not throw) if CONTENT_ENCRYPTION_KEY is accidentally set — guards against reintroduction', () => {
    const warn = vi.fn();
    expect(() =>
      validateEncryptionEnv({
        env: envWith({ CONTENT_ENCRYPTION_KEY: 'legacy-value' }),
        warn,
      }),
    ).not.toThrow();
    expect(warn).toHaveBeenCalledTimes(1);
    const msg = warn.mock.calls[0]![0] as string;
    expect(msg).toMatch(/CONTENT_ENCRYPTION_KEY/);
    expect(msg).toMatch(/unused/i);
  });
});
