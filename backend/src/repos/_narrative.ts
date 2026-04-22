// Shared helpers used by every narrative repo ([E9]).
//
// The pattern: each encrypted field `foo` corresponds to four columns —
// plaintext `foo` (during dual-write, dropped in [E11]) and ciphertext triple
// `fooCiphertext` / `fooIv` / `fooAuthTag`. These helpers translate between
// the repo's Public shape (plaintext strings only) and the Prisma column
// shape (plaintext + ciphertext triple).

import type { Request } from 'express';
import {
  DekNotAvailableError,
  decryptForRequest,
  encryptForRequest,
  hasDekForRequest,
  type EncPayload,
} from '../services/content-crypto.service';

export interface Ciphered {
  ciphertext: string | null;
  iv: string | null;
  authTag: string | null;
}

// Given a plaintext value, produce the four Prisma columns it writes to.
// Returns `null` triples when the value is null/undefined so Prisma stores
// SQL NULL across the board (no 0-byte ciphertext rows).
export function writeEncrypted(
  req: Request,
  field: string,
  value: string | null | undefined,
): Record<string, string | null> {
  if (value === null || value === undefined) {
    return {
      [field]: null,
      [`${field}Ciphertext`]: null,
      [`${field}Iv`]: null,
      [`${field}AuthTag`]: null,
    };
  }
  const enc = encryptForRequest(req, value);
  return {
    [field]: value, // plaintext dual-write (dropped in [E11])
    [`${field}Ciphertext`]: enc.ciphertext,
    [`${field}Iv`]: enc.iv,
    [`${field}AuthTag`]: enc.authTag,
  };
}

// Variant for fields where the "plaintext" lives in a differently-named
// column (e.g. Chapter's body → plaintext is in `bodyJson` + `content`, while
// the ciphertext triple is `bodyCiphertext/Iv/AuthTag`). Emits only the
// ciphertext triple; the caller writes the plaintext column separately.
export function writeCiphertextOnly(
  req: Request,
  field: string,
  value: string | null | undefined,
): Record<string, string | null> {
  if (value === null || value === undefined) {
    return {
      [`${field}Ciphertext`]: null,
      [`${field}Iv`]: null,
      [`${field}AuthTag`]: null,
    };
  }
  const enc = encryptForRequest(req, value);
  return {
    [`${field}Ciphertext`]: enc.ciphertext,
    [`${field}Iv`]: enc.iv,
    [`${field}AuthTag`]: enc.authTag,
  };
}

// Read the ciphertext triple for `field` and decrypt it. If the triple is
// incomplete (pre-[E10] backfill rows), fall back to the plaintext `field`
// value so reads keep working during the rollout window.
export function readEncrypted<T extends Record<string, unknown>>(
  req: Request,
  row: T,
  field: string,
): string | null {
  const ct = row[`${field}Ciphertext`] as string | null | undefined;
  const iv = row[`${field}Iv`] as string | null | undefined;
  const tag = row[`${field}AuthTag`] as string | null | undefined;
  if (ct && iv && tag) {
    // A ciphertext row MUST be decrypted through the DEK. Silently falling
    // back to plaintext here would let a valid-signature JWT without a
    // `sessionId` claim (which the middleware therefore cannot resolve to a
    // session-store entry) read plaintext — a documented BLOCK from the E9
    // security review. Fail loud so the auth layer's oversight surfaces.
    if (!hasDekForRequest(req)) throw new DekNotAvailableError();
    const payload: EncPayload = { ciphertext: ct, iv, authTag: tag };
    return decryptForRequest(req, payload);
  }
  return (row[field] as string | null | undefined) ?? null;
}

// Strip every `*Ciphertext / *Iv / *AuthTag` column from a row before
// returning it from the repo. The caller never sees the ciphertext.
export function stripCiphertextFields<T extends Record<string, unknown>>(row: T): Partial<T> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) {
    if (k.endsWith('Ciphertext') || k.endsWith('Iv') || k.endsWith('AuthTag')) continue;
    out[k] = v;
  }
  return out as Partial<T>;
}

// Combine readEncrypted + stripCiphertext for a set of narrative fields,
// returning a plaintext-only object the caller can safely serialise.
export function projectDecrypted<T extends Record<string, unknown>>(
  req: Request,
  row: T,
  fields: readonly string[],
): Record<string, unknown> {
  const projected: Record<string, unknown> = { ...stripCiphertextFields(row) };
  for (const f of fields) {
    projected[f] = readEncrypted(req, row, f);
  }
  return projected;
}
