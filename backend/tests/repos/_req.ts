import crypto from 'node:crypto';
import type { Request } from 'express';
import { attachDekToRequest, generateDekAndWraps } from '../../src/services/content-crypto.service';
import { prisma } from '../setup';

export interface TestUserContext {
  user: { id: string; username: string };
  req: Request;
  dek: Buffer;
}

/**
 * Create a real user row with DEK wraps + a fake `req` object carrying
 * `user.id` and the attached DEK, so repo calls work end-to-end without the
 * HTTP/auth plumbing.
 */
export async function makeUserContext(
  username = `repo-${Math.random().toString(36).slice(2, 10)}`,
): Promise<TestUserContext> {
  const password = 'testing-pass';
  const gen = await generateDekAndWraps(password);
  const user = await prisma.user.create({
    data: {
      username,
      name: 'Repo Test',
      passwordHash: 'unused',
      contentDekPasswordEnc: gen.passwordWrap.ciphertext,
      contentDekPasswordIv: gen.passwordWrap.iv,
      contentDekPasswordAuthTag: gen.passwordWrap.authTag,
      contentDekPasswordSalt: gen.passwordWrap.salt,
      contentDekRecoveryEnc: gen.recoveryWrap.ciphertext,
      contentDekRecoveryIv: gen.recoveryWrap.iv,
      contentDekRecoveryAuthTag: gen.recoveryWrap.authTag,
      contentDekRecoverySalt: gen.recoveryWrap.salt,
    },
  });
  const req = { user: { id: user.id, email: user.email } } as unknown as Request;
  attachDekToRequest(req, gen.dek);
  return { user: { id: user.id, username: user.username }, req, dek: gen.dek };
}

export async function resetAllTables(): Promise<void> {
  // Delete order matters: children before parents — we could also rely on
  // cascade, but explicit is faster and safer across test runs.
  await prisma.message.deleteMany();
  await prisma.chat.deleteMany();
  await prisma.outlineItem.deleteMany();
  await prisma.character.deleteMany();
  await prisma.chapter.deleteMany();
  await prisma.story.deleteMany();
  await prisma.session.deleteMany();
  await prisma.refreshToken.deleteMany();
  await prisma.user.deleteMany();
}

export function rawCiphertextMustNotEqual(value: string, plaintext: string): void {
  // Sanity check — ciphertext should not simply be the plaintext stored in
  // base64. A broken implementation that forgot to actually encrypt would
  // produce `Buffer.from(plaintext).toString('base64')` and this check catches it.
  const naive = Buffer.from(plaintext, 'utf8').toString('base64');
  if (value === naive) {
    throw new Error(`ciphertext looks like naive base64(plaintext): ${value}`);
  }
}

export { crypto };
