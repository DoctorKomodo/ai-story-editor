import { randomBytes } from 'node:crypto';
import * as argon2 from 'argon2';
import { describe, expect, it } from 'vitest';
import {
  ARGON2_PARAMS,
  ARGON2_PARAMS_PRODUCTION,
  ARGON2_PARAMS_TEST,
  DEK_WRAP_SALT_BYTES,
} from '../../src/services/argon2.config';

describe('argon2 parameter config', () => {
  it('production params are the frozen OWASP 2024 baseline, byte for byte', () => {
    expect(ARGON2_PARAMS_PRODUCTION).toEqual({
      type: argon2.argon2id,
      memoryCost: 19_456,
      timeCost: 2,
      parallelism: 1,
    });
    expect(Object.isFrozen(ARGON2_PARAMS_PRODUCTION)).toBe(true);
  });

  it('the suite runs on the fast params — the TEST_FAST_ARGON2 opt-in is live', () => {
    // If the opt-in silently falls out of the env plumbing the suite must
    // FAIL here, not quietly revert to paying production KDF cost everywhere.
    expect(process.env.NODE_ENV).toBe('test');
    expect(process.env.TEST_FAST_ARGON2).toBe('1');
    expect(ARGON2_PARAMS).toBe(ARGON2_PARAMS_TEST);
  });

  it('test params keep the hash format compatible with production', () => {
    expect(ARGON2_PARAMS_TEST).toMatchObject({ type: argon2.argon2id, parallelism: 1 });
  });

  // The one intentionally slow test: production-cost hash → verify plus a
  // wrap-key derivation shaped like content-crypto's deriveWrapKey, so a
  // node-argon2 major bump or a params typo can't hide behind the fast path.
  it('hash → verify and DEK-wrap key derivation round-trip at PRODUCTION params', async () => {
    const password = 'correct horse battery staple';

    const encoded = await argon2.hash(password, ARGON2_PARAMS_PRODUCTION);
    expect(encoded.startsWith('$argon2id$')).toBe(true);
    expect(encoded).toContain('m=19456,t=2,p=1');
    await expect(argon2.verify(encoded, password)).resolves.toBe(true);
    await expect(argon2.verify(encoded, 'not-the-password')).resolves.toBe(false);

    const salt = randomBytes(DEK_WRAP_SALT_BYTES);
    const derive = async () =>
      (await argon2.hash(password, {
        ...ARGON2_PARAMS_PRODUCTION,
        salt,
        raw: true,
        hashLength: 32,
      })) as unknown as Buffer;
    const key = await derive();
    const keyAgain = await derive();
    expect(key.length).toBe(32);
    expect(key.equals(keyAgain)).toBe(true);
  });
});
