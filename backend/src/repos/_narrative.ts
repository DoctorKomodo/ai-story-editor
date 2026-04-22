// Shared helpers used by every narrative repo ([E9]).
//
// Post-[E11]: plaintext narrative columns have been dropped. For each
// encrypted field `foo` only the ciphertext triple remains —
// `fooCiphertext` / `fooIv` / `fooAuthTag`. These helpers translate between
// the repo's Public shape (plaintext strings only, in-memory) and the Prisma
// column shape (ciphertext triple only). No dual-write, no plaintext
// fallback — ciphertext is the sole source of truth for narrative content.

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

// Thrown when a row is read but its ciphertext triple is missing / incomplete.
// Post-[E11] there is no plaintext column to fall back to — an incomplete
// triple means the row is corrupted (or was written outside the repo layer,
// which is a bug). Fail loud rather than returning null or plaintext.
export class CiphertextMissingError extends Error {
  constructor(field: string) {
    super(`Missing ciphertext for field ${field}`);
    this.name = 'CiphertextMissingError';
  }
}

// Given a plaintext value, produce the ciphertext-triple Prisma columns.
// Returns `null` triples when the value is null/undefined so Prisma stores
// SQL NULL across the board (no 0-byte ciphertext rows).
//
// Post-[E11] this no longer dual-writes a plaintext `[field]` column — the
// plaintext column has been dropped from the schema.
export function writeEncrypted(
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

// Alias kept for callers that used to distinguish "dual-write" from
// "ciphertext-only" during the [E9]–[E10] dual-write window. Post-[E11] both
// helpers behave identically — only the ciphertext triple is ever written.
// Use this alias (or `writeEncrypted`) interchangeably; prefer this name
// when the caller separately writes a different plaintext column that is NOT
// the encrypted field's sibling (e.g. Chapter writes `wordCount` plaintext
// alongside `bodyCiphertext`).
export const writeCiphertextOnly = writeEncrypted;

// Read the ciphertext triple for `field` and decrypt it.
// Post-[E11] there is no plaintext fallback — if the triple is null across
// the board, the field was stored as null and we return null. If the triple
// is partially populated, that's a corrupted row and we throw.
export function readEncrypted<T extends Record<string, unknown>>(
  req: Request,
  row: T,
  field: string,
): string | null {
  const ct = row[`${field}Ciphertext`] as string | null | undefined;
  const iv = row[`${field}Iv`] as string | null | undefined;
  const tag = row[`${field}AuthTag`] as string | null | undefined;
  // Full-null triple means "the caller stored null for this field" — valid.
  if (ct == null && iv == null && tag == null) return null;
  // Partial population is a corruption / bug signal, not a legacy case.
  if (!ct || !iv || !tag) throw new CiphertextMissingError(field);
  // A ciphertext row MUST be decrypted through the DEK. Fail loud if the
  // middleware didn't attach one (see the E9 security review — silently
  // falling back to anything here would be a BLOCK finding).
  if (!hasDekForRequest(req)) throw new DekNotAvailableError();
  const payload: EncPayload = { ciphertext: ct, iv, authTag: tag };
  return decryptForRequest(req, payload);
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
