// Per-user DEK + content-crypto primitives. See docs/encryption.md.
//
// Model (summary):
//   - Every user has a random 32-byte DEK, stored wrapped twice on User:
//       * password wrap:  argon2id(password,      salt_p, ARGON2_PARAMS) → key_p
//                         AES-256-GCM(key_p, iv_p, dek)
//       * recovery wrap:  argon2id(recoveryCode,  salt_r, ARGON2_PARAMS) → key_r
//                         AES-256-GCM(key_r, iv_r, dek)
//   - The plaintext DEK NEVER persists. Only:
//       * in the Option-B session store (src/services/session-store.ts)
//       * in a request-scoped WeakMap (populated by auth middleware), which is
//         the ONLY channel content-crypto reads from.
//
// Exports split into three layers:
//   1. Low-level: generateDek, wrap/unwrapDek, encryptWithDek, decryptWithDek.
//   2. Lifecycle: generateDekAndWraps, unwrapDekWithPassword,
//      unwrapDekWithRecoveryCode, rewrapPasswordWrap, rewrapRecoveryWrap.
//   3. Per-request: attachDekToRequest, getDekFromRequest, encryptForRequest,
//      decryptForRequest.

import crypto from 'node:crypto';
import type { PrismaClient } from '@prisma/client';
import * as argon2 from 'argon2';
import { ARGON2_PARAMS, DEK_WRAP_SALT_BYTES } from './argon2.config';

export const DEK_BYTES = 32;
export const AES_IV_BYTES = 12;
export const AES_AUTH_TAG_BYTES = 16;

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export class DekNotAvailableError extends Error {
  constructor() {
    super('Content DEK is not available for this request');
    this.name = 'DekNotAvailableError';
  }
}

export class InvalidPasswordError extends Error {
  constructor() {
    super('Invalid password');
    this.name = 'InvalidPasswordError';
  }
}

export class InvalidRecoveryCodeError extends Error {
  constructor() {
    super('Invalid recovery code');
    this.name = 'InvalidRecoveryCodeError';
  }
}

export class DekWrapMissingError extends Error {
  constructor(kind: 'password' | 'recovery') {
    super(`User is missing the ${kind} DEK wrap`);
    this.name = 'DekWrapMissingError';
  }
}

// ---------------------------------------------------------------------------
// Recovery-code format (base32 Crockford, 160 bits of entropy, grouped).
// ---------------------------------------------------------------------------

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

export const RECOVERY_CODE_BYTES = 20; // 160 bits
export const RECOVERY_CODE_GROUPS = 4; // 4×8 chars, joined with '-'
export const RECOVERY_CODE_GROUP_LEN = 8;

function encodeBase32Crockford(buf: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      out += CROCKFORD[(value >>> bits) & 0x1f];
    }
  }
  if (bits > 0) out += CROCKFORD[(value << (5 - bits)) & 0x1f];
  return out;
}

export function generateRecoveryCode(): string {
  const raw = crypto.randomBytes(RECOVERY_CODE_BYTES);
  const encoded = encodeBase32Crockford(raw); // 32 chars (20 bytes × 8 / 5)
  const groups: string[] = [];
  for (let i = 0; i < RECOVERY_CODE_GROUPS; i += 1) {
    groups.push(encoded.slice(i * RECOVERY_CODE_GROUP_LEN, (i + 1) * RECOVERY_CODE_GROUP_LEN));
  }
  return groups.join('-');
}

export function normaliseRecoveryCode(raw: string): string {
  // Strip whitespace, hyphens, and all Unicode control/format characters (\p{C}).
  // Clipboard / autofill / mobile keyboards sometimes inject invisible chars
  // (zero-width space, BOM, soft hyphen, word joiner, …) that would otherwise
  // cause a correctly-typed code to fail unwrap.
  return raw.replace(/[\p{C}\s-]/gu, '').toUpperCase();
}

// ---------------------------------------------------------------------------
// Low-level AES-GCM helpers, parameterised by a caller-supplied key.
// ---------------------------------------------------------------------------

export interface WrapFields {
  ciphertext: string;
  iv: string;
  authTag: string;
  salt: string;
}

export interface EncPayload {
  ciphertext: string;
  iv: string;
  authTag: string;
}

function encryptWithKey(key: Buffer, plaintext: Buffer): EncPayload {
  if (key.length !== DEK_BYTES) {
    throw new Error(`encryption key must be ${DEK_BYTES} bytes`);
  }
  const iv = crypto.randomBytes(AES_IV_BYTES);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return {
    ciphertext: ct.toString('base64'),
    iv: iv.toString('base64'),
    authTag: cipher.getAuthTag().toString('base64'),
  };
}

function decryptWithKey(key: Buffer, payload: EncPayload): Buffer {
  if (key.length !== DEK_BYTES) {
    throw new Error(`encryption key must be ${DEK_BYTES} bytes`);
  }
  const iv = Buffer.from(payload.iv, 'base64');
  const authTag = Buffer.from(payload.authTag, 'base64');
  const ciphertext = Buffer.from(payload.ciphertext, 'base64');
  if (iv.length !== AES_IV_BYTES) throw new Error('iv must be 12 bytes');
  if (authTag.length !== AES_AUTH_TAG_BYTES) throw new Error('authTag must be 16 bytes');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}

// Public: encrypt a user's plaintext with their DEK.
export function encryptWithDek(dek: Buffer, plaintext: string | Buffer): EncPayload {
  const buf = typeof plaintext === 'string' ? Buffer.from(plaintext, 'utf8') : plaintext;
  return encryptWithKey(dek, buf);
}

// Public: decrypt with their DEK → UTF-8 string.
export function decryptWithDek(dek: Buffer, payload: EncPayload): string {
  return decryptWithKey(dek, payload).toString('utf8');
}

// ---------------------------------------------------------------------------
// Wrap/unwrap the DEK under an argon2id-derived key.
// ---------------------------------------------------------------------------

async function deriveWrapKey(secret: string, salt: Buffer): Promise<Buffer> {
  const raw = await argon2.hash(secret, {
    ...ARGON2_PARAMS,
    salt,
    raw: true,
    hashLength: DEK_BYTES,
  });
  return raw as unknown as Buffer;
}

export async function wrapDek(dek: Buffer, secret: string): Promise<WrapFields> {
  if (dek.length !== DEK_BYTES) throw new Error('DEK must be 32 bytes');
  const salt = crypto.randomBytes(DEK_WRAP_SALT_BYTES);
  const key = await deriveWrapKey(secret, salt);
  const { ciphertext, iv, authTag } = encryptWithKey(key, dek);
  return {
    ciphertext,
    iv,
    authTag,
    salt: salt.toString('base64'),
  };
}

export async function unwrapDek(wrap: WrapFields, secret: string): Promise<Buffer> {
  const salt = Buffer.from(wrap.salt, 'base64');
  if (salt.length !== DEK_WRAP_SALT_BYTES) {
    throw new Error(`wrap salt must be ${DEK_WRAP_SALT_BYTES} bytes`);
  }
  const key = await deriveWrapKey(secret, salt);
  return decryptWithKey(key, wrap);
}

// ---------------------------------------------------------------------------
// High-level lifecycle helpers.
// ---------------------------------------------------------------------------

export interface DekAndWraps {
  dek: Buffer;
  recoveryCode: string;
  passwordWrap: WrapFields;
  recoveryWrap: WrapFields;
}

// Generate a fresh random DEK, wrap it under `password` and a newly-generated
// recovery code. Caller persists the wraps and surfaces the recovery code
// exactly once.
export async function generateDekAndWraps(password: string): Promise<DekAndWraps> {
  const dek = crypto.randomBytes(DEK_BYTES);
  const recoveryCode = generateRecoveryCode();
  const [passwordWrap, recoveryWrap] = await Promise.all([
    wrapDek(dek, password),
    wrapDek(dek, normaliseRecoveryCode(recoveryCode)),
  ]);
  return { dek, recoveryCode, passwordWrap, recoveryWrap };
}

export interface UserDekColumns {
  contentDekPasswordEnc: string | null;
  contentDekPasswordIv: string | null;
  contentDekPasswordAuthTag: string | null;
  contentDekPasswordSalt: string | null;
  contentDekRecoveryEnc: string | null;
  contentDekRecoveryIv: string | null;
  contentDekRecoveryAuthTag: string | null;
  contentDekRecoverySalt: string | null;
}

function requirePasswordWrap(u: UserDekColumns): WrapFields {
  if (
    !u.contentDekPasswordEnc ||
    !u.contentDekPasswordIv ||
    !u.contentDekPasswordAuthTag ||
    !u.contentDekPasswordSalt
  ) {
    throw new DekWrapMissingError('password');
  }
  return {
    ciphertext: u.contentDekPasswordEnc,
    iv: u.contentDekPasswordIv,
    authTag: u.contentDekPasswordAuthTag,
    salt: u.contentDekPasswordSalt,
  };
}

function requireRecoveryWrap(u: UserDekColumns): WrapFields {
  if (
    !u.contentDekRecoveryEnc ||
    !u.contentDekRecoveryIv ||
    !u.contentDekRecoveryAuthTag ||
    !u.contentDekRecoverySalt
  ) {
    throw new DekWrapMissingError('recovery');
  }
  return {
    ciphertext: u.contentDekRecoveryEnc,
    iv: u.contentDekRecoveryIv,
    authTag: u.contentDekRecoveryAuthTag,
    salt: u.contentDekRecoverySalt,
  };
}

export async function unwrapDekWithPassword(
  user: UserDekColumns,
  password: string,
): Promise<Buffer> {
  const wrap = requirePasswordWrap(user);
  try {
    return await unwrapDek(wrap, password);
  } catch {
    throw new InvalidPasswordError();
  }
}

export async function unwrapDekWithRecoveryCode(
  user: UserDekColumns,
  recoveryCode: string,
): Promise<Buffer> {
  const wrap = requireRecoveryWrap(user);
  try {
    return await unwrapDek(wrap, normaliseRecoveryCode(recoveryCode));
  } catch {
    throw new InvalidRecoveryCodeError();
  }
}

export async function rewrapPasswordWrap(
  client: PrismaClient,
  userId: string,
  dek: Buffer,
  newPassword: string,
): Promise<void> {
  const wrap = await wrapDek(dek, newPassword);
  await client.user.update({
    where: { id: userId },
    data: {
      contentDekPasswordEnc: wrap.ciphertext,
      contentDekPasswordIv: wrap.iv,
      contentDekPasswordAuthTag: wrap.authTag,
      contentDekPasswordSalt: wrap.salt,
    },
  });
}

export async function rewrapRecoveryWrap(
  client: PrismaClient,
  userId: string,
  dek: Buffer,
): Promise<string> {
  const recoveryCode = generateRecoveryCode();
  const wrap = await wrapDek(dek, normaliseRecoveryCode(recoveryCode));
  await client.user.update({
    where: { id: userId },
    data: {
      contentDekRecoveryEnc: wrap.ciphertext,
      contentDekRecoveryIv: wrap.iv,
      contentDekRecoveryAuthTag: wrap.authTag,
      contentDekRecoverySalt: wrap.salt,
    },
  });
  return recoveryCode;
}

// ---------------------------------------------------------------------------
// Request-scoped DEK cache.
// ---------------------------------------------------------------------------
//
// Keyed on the Express `req` object. The WeakMap entry is GC-eligible as
// soon as the request finishes and the framework stops holding req.
// No other code path should read or write this map — content-crypto is the
// only owner, and the auth middleware is the only writer.

const dekByRequest = new WeakMap<object, Buffer>();

export function attachDekToRequest(req: object, dek: Buffer): void {
  dekByRequest.set(req, dek);
}

export function hasDekForRequest(req: object): boolean {
  return dekByRequest.has(req);
}

export function getDekFromRequest(req: object): Buffer {
  const dek = dekByRequest.get(req);
  if (!dek) throw new DekNotAvailableError();
  return dek;
}

// High-level per-request encrypt/decrypt used by repo layer ([E9]).
export function encryptForRequest(req: object, plaintext: string | Buffer): EncPayload {
  return encryptWithDek(getDekFromRequest(req), plaintext);
}

export function decryptForRequest(req: object, payload: EncPayload): string {
  return decryptWithDek(getDekFromRequest(req), payload);
}
