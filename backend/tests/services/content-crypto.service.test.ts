import { beforeEach, describe, expect, it } from 'vitest';
import {
  DekNotAvailableError,
  DEK_BYTES,
  InvalidPasswordError,
  InvalidRecoveryCodeError,
  RECOVERY_CODE_GROUPS,
  RECOVERY_CODE_GROUP_LEN,
  attachDekToRequest,
  decryptForRequest,
  decryptWithDek,
  encryptForRequest,
  encryptWithDek,
  generateDekAndWraps,
  generateRecoveryCode,
  hasDekForRequest,
  normaliseRecoveryCode,
  rewrapPasswordWrap,
  rewrapRecoveryWrap,
  unwrapDek,
  unwrapDekWithPassword,
  unwrapDekWithRecoveryCode,
  wrapDek,
} from '../../src/services/content-crypto.service';
import { prisma } from '../setup';

const PASSWORD = 'correct-horse-battery-staple';

async function makeUserRow() {
  return prisma.user.create({
    data: {
      username: `cc-${Math.random().toString(36).slice(2, 10)}`,
      name: 'Crypto User',
      passwordHash: 'unused-for-content-crypto-tests',
    },
  });
}

describe('content-crypto.service — recovery-code format', () => {
  it('generates codes of shape XXXXXXXX-XXXXXXXX-XXXXXXXX-XXXXXXXX (Crockford base32)', () => {
    for (let i = 0; i < 20; i += 1) {
      const code = generateRecoveryCode();
      const groups = code.split('-');
      expect(groups).toHaveLength(RECOVERY_CODE_GROUPS);
      for (const g of groups) {
        expect(g).toHaveLength(RECOVERY_CODE_GROUP_LEN);
        expect(g).toMatch(/^[0-9A-HJKMNP-TV-Z]+$/);
      }
    }
  });

  it('produces unique codes across 1000 draws (sanity check — not a rigorous entropy test)', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 1000; i += 1) seen.add(generateRecoveryCode());
    expect(seen.size).toBe(1000);
  });

  it('normalises: strips hyphens + whitespace, uppercases', () => {
    expect(normaliseRecoveryCode(' abcd-efgh ')).toBe('ABCDEFGH');
    expect(normaliseRecoveryCode('aBc\tdEf')).toBe('ABCDEF');
  });
});

describe('content-crypto.service — low-level wrap/unwrap', () => {
  it('round-trips the DEK through wrap → unwrap', async () => {
    const dek = Buffer.alloc(DEK_BYTES, 0x11);
    const wrap = await wrapDek(dek, 'secret');
    const recovered = await unwrapDek(wrap, 'secret');
    expect(recovered.equals(dek)).toBe(true);
  });

  it('rejects unwrap with the wrong secret (GCM auth tag fails)', async () => {
    const dek = Buffer.alloc(DEK_BYTES, 0x22);
    const wrap = await wrapDek(dek, 'right');
    await expect(unwrapDek(wrap, 'wrong')).rejects.toThrow();
  });

  it('produces a fresh salt + iv per wrap (same input → different ciphertext)', async () => {
    const dek = Buffer.alloc(DEK_BYTES, 0x33);
    const a = await wrapDek(dek, 'same');
    const b = await wrapDek(dek, 'same');
    expect(a.salt).not.toBe(b.salt);
    expect(a.iv).not.toBe(b.iv);
    expect(a.ciphertext).not.toBe(b.ciphertext);
  });
});

describe('content-crypto.service — encryptWithDek / decryptWithDek', () => {
  it('round-trips plaintext', () => {
    const dek = Buffer.alloc(DEK_BYTES, 0x44);
    const payload = encryptWithDek(dek, 'hello world');
    expect(decryptWithDek(dek, payload)).toBe('hello world');
  });

  it('throws when decrypted with a different DEK', () => {
    const dek1 = Buffer.alloc(DEK_BYTES, 0x55);
    const dek2 = Buffer.alloc(DEK_BYTES, 0x66);
    const payload = encryptWithDek(dek1, 'secret');
    expect(() => decryptWithDek(dek2, payload)).toThrow();
  });

  it('produces a fresh IV per encrypt call', () => {
    const dek = Buffer.alloc(DEK_BYTES, 0x77);
    const a = encryptWithDek(dek, 'x');
    const b = encryptWithDek(dek, 'x');
    expect(a.iv).not.toBe(b.iv);
    expect(a.ciphertext).not.toBe(b.ciphertext);
  });

  it('round-trips empty string', () => {
    const dek = Buffer.alloc(DEK_BYTES, 0x88);
    const payload = encryptWithDek(dek, '');
    expect(decryptWithDek(dek, payload)).toBe('');
  });
});

describe('content-crypto.service — generateDekAndWraps', () => {
  it('returns a DEK, a recovery code, and two wraps that both unwrap to the same DEK', async () => {
    const { dek, recoveryCode, passwordWrap, recoveryWrap } = await generateDekAndWraps(PASSWORD);

    expect(dek).toHaveLength(DEK_BYTES);
    expect(recoveryCode).toMatch(/^[0-9A-HJKMNP-TV-Z]{8}-[0-9A-HJKMNP-TV-Z]{8}-[0-9A-HJKMNP-TV-Z]{8}-[0-9A-HJKMNP-TV-Z]{8}$/);

    const fromPassword = await unwrapDek(passwordWrap, PASSWORD);
    const fromRecovery = await unwrapDek(recoveryWrap, normaliseRecoveryCode(recoveryCode));
    expect(fromPassword.equals(dek)).toBe(true);
    expect(fromRecovery.equals(dek)).toBe(true);
  });

  it('uses independent salts for the two wraps', async () => {
    const { passwordWrap, recoveryWrap } = await generateDekAndWraps(PASSWORD);
    expect(passwordWrap.salt).not.toBe(recoveryWrap.salt);
  });
});

describe('content-crypto.service — unwrap with DB record', () => {
  beforeEach(async () => {
    await prisma.user.deleteMany();
  });

  it('unwrapDekWithPassword returns the original DEK', async () => {
    const { dek, passwordWrap, recoveryWrap } = await generateDekAndWraps(PASSWORD);
    const user = await makeUserRow();
    await prisma.user.update({
      where: { id: user.id },
      data: {
        contentDekPasswordEnc: passwordWrap.ciphertext,
        contentDekPasswordIv: passwordWrap.iv,
        contentDekPasswordAuthTag: passwordWrap.authTag,
        contentDekPasswordSalt: passwordWrap.salt,
        contentDekRecoveryEnc: recoveryWrap.ciphertext,
        contentDekRecoveryIv: recoveryWrap.iv,
        contentDekRecoveryAuthTag: recoveryWrap.authTag,
        contentDekRecoverySalt: recoveryWrap.salt,
      },
    });
    const fresh = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    const recovered = await unwrapDekWithPassword(fresh, PASSWORD);
    expect(recovered.equals(dek)).toBe(true);
  });

  it('unwrapDekWithPassword throws InvalidPasswordError on wrong password', async () => {
    const { passwordWrap, recoveryWrap } = await generateDekAndWraps(PASSWORD);
    const user = await makeUserRow();
    await prisma.user.update({
      where: { id: user.id },
      data: {
        contentDekPasswordEnc: passwordWrap.ciphertext,
        contentDekPasswordIv: passwordWrap.iv,
        contentDekPasswordAuthTag: passwordWrap.authTag,
        contentDekPasswordSalt: passwordWrap.salt,
        contentDekRecoveryEnc: recoveryWrap.ciphertext,
        contentDekRecoveryIv: recoveryWrap.iv,
        contentDekRecoveryAuthTag: recoveryWrap.authTag,
        contentDekRecoverySalt: recoveryWrap.salt,
      },
    });
    const fresh = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    await expect(unwrapDekWithPassword(fresh, 'wrong')).rejects.toBeInstanceOf(InvalidPasswordError);
  });

  it('unwrapDekWithRecoveryCode returns the original DEK, tolerates hyphens + case', async () => {
    const { dek, recoveryCode, passwordWrap, recoveryWrap } = await generateDekAndWraps(PASSWORD);
    const user = await makeUserRow();
    await prisma.user.update({
      where: { id: user.id },
      data: {
        contentDekPasswordEnc: passwordWrap.ciphertext,
        contentDekPasswordIv: passwordWrap.iv,
        contentDekPasswordAuthTag: passwordWrap.authTag,
        contentDekPasswordSalt: passwordWrap.salt,
        contentDekRecoveryEnc: recoveryWrap.ciphertext,
        contentDekRecoveryIv: recoveryWrap.iv,
        contentDekRecoveryAuthTag: recoveryWrap.authTag,
        contentDekRecoverySalt: recoveryWrap.salt,
      },
    });
    const fresh = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });

    // As-given.
    const a = await unwrapDekWithRecoveryCode(fresh, recoveryCode);
    expect(a.equals(dek)).toBe(true);
    // Lowercased + with spaces — normalisation should recover the same DEK.
    const munged = ` ${recoveryCode.toLowerCase()} `.replace(/-/g, ' ');
    const b = await unwrapDekWithRecoveryCode(fresh, munged);
    expect(b.equals(dek)).toBe(true);
  });

  it('unwrapDekWithRecoveryCode throws InvalidRecoveryCodeError on wrong code', async () => {
    const { passwordWrap, recoveryWrap } = await generateDekAndWraps(PASSWORD);
    const user = await makeUserRow();
    await prisma.user.update({
      where: { id: user.id },
      data: {
        contentDekPasswordEnc: passwordWrap.ciphertext,
        contentDekPasswordIv: passwordWrap.iv,
        contentDekPasswordAuthTag: passwordWrap.authTag,
        contentDekPasswordSalt: passwordWrap.salt,
        contentDekRecoveryEnc: recoveryWrap.ciphertext,
        contentDekRecoveryIv: recoveryWrap.iv,
        contentDekRecoveryAuthTag: recoveryWrap.authTag,
        contentDekRecoverySalt: recoveryWrap.salt,
      },
    });
    const fresh = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    await expect(
      unwrapDekWithRecoveryCode(fresh, 'AAAAAAAA-AAAAAAAA-AAAAAAAA-AAAAAAAA'),
    ).rejects.toBeInstanceOf(InvalidRecoveryCodeError);
  });
});

describe('content-crypto.service — rewrap helpers', () => {
  beforeEach(async () => {
    await prisma.user.deleteMany();
  });

  it('rewrapPasswordWrap rewrites password columns but leaves recovery columns alone', async () => {
    const { dek, passwordWrap, recoveryWrap } = await generateDekAndWraps(PASSWORD);
    const user = await makeUserRow();
    await prisma.user.update({
      where: { id: user.id },
      data: {
        contentDekPasswordEnc: passwordWrap.ciphertext,
        contentDekPasswordIv: passwordWrap.iv,
        contentDekPasswordAuthTag: passwordWrap.authTag,
        contentDekPasswordSalt: passwordWrap.salt,
        contentDekRecoveryEnc: recoveryWrap.ciphertext,
        contentDekRecoveryIv: recoveryWrap.iv,
        contentDekRecoveryAuthTag: recoveryWrap.authTag,
        contentDekRecoverySalt: recoveryWrap.salt,
      },
    });

    await rewrapPasswordWrap(prisma, user.id, dek, 'new-password');

    const after = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(after.contentDekPasswordEnc).not.toBe(passwordWrap.ciphertext);
    expect(after.contentDekPasswordSalt).not.toBe(passwordWrap.salt);
    expect(after.contentDekRecoveryEnc).toBe(recoveryWrap.ciphertext);
    expect(after.contentDekRecoverySalt).toBe(recoveryWrap.salt);

    const recovered = await unwrapDekWithPassword(after, 'new-password');
    expect(recovered.equals(dek)).toBe(true);
  });

  it('rewrapRecoveryWrap rewrites recovery columns and returns a new one-time recovery code', async () => {
    const { dek, recoveryCode: originalCode, passwordWrap, recoveryWrap } =
      await generateDekAndWraps(PASSWORD);
    const user = await makeUserRow();
    await prisma.user.update({
      where: { id: user.id },
      data: {
        contentDekPasswordEnc: passwordWrap.ciphertext,
        contentDekPasswordIv: passwordWrap.iv,
        contentDekPasswordAuthTag: passwordWrap.authTag,
        contentDekPasswordSalt: passwordWrap.salt,
        contentDekRecoveryEnc: recoveryWrap.ciphertext,
        contentDekRecoveryIv: recoveryWrap.iv,
        contentDekRecoveryAuthTag: recoveryWrap.authTag,
        contentDekRecoverySalt: recoveryWrap.salt,
      },
    });

    const newCode = await rewrapRecoveryWrap(prisma, user.id, dek);
    expect(newCode).not.toBe(originalCode);

    const after = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    // Old recovery code no longer works.
    await expect(unwrapDekWithRecoveryCode(after, originalCode)).rejects.toBeInstanceOf(
      InvalidRecoveryCodeError,
    );
    // New recovery code unwraps the same DEK.
    const recovered = await unwrapDekWithRecoveryCode(after, newCode);
    expect(recovered.equals(dek)).toBe(true);
    // Password wrap untouched.
    expect(after.contentDekPasswordEnc).toBe(passwordWrap.ciphertext);
  });
});

describe('content-crypto.service — request-scoped DEK cache', () => {
  it('encryptForRequest / decryptForRequest round-trip when DEK is attached', () => {
    const req = {} as object;
    const dek = Buffer.alloc(DEK_BYTES, 0xaa);
    attachDekToRequest(req, dek);
    expect(hasDekForRequest(req)).toBe(true);
    const payload = encryptForRequest(req, 'room for one more');
    expect(decryptForRequest(req, payload)).toBe('room for one more');
  });

  it('encryptForRequest throws DekNotAvailableError when no DEK is attached', () => {
    const req = {} as object;
    expect(() => encryptForRequest(req, 'x')).toThrowError(DekNotAvailableError);
  });

  it('decryptForRequest throws DekNotAvailableError when no DEK is attached', () => {
    const req = {} as object;
    expect(() => decryptForRequest(req, { ciphertext: '', iv: '', authTag: '' })).toThrowError(
      DekNotAvailableError,
    );
  });

  it('keys are per-request: attaching to one object doesn\'t leak to another', () => {
    const reqA = {} as object;
    const reqB = {} as object;
    attachDekToRequest(reqA, Buffer.alloc(DEK_BYTES, 0xbb));
    expect(hasDekForRequest(reqA)).toBe(true);
    expect(hasDekForRequest(reqB)).toBe(false);
  });
});
