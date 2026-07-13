// Shared helpers used by every narrative repo ([E9]).
//
// Post-[E11]: plaintext narrative columns have been dropped. For each
// encrypted field `foo` only the ciphertext triple remains —
// `fooCiphertext` / `fooIv` / `fooAuthTag`. These helpers translate between
// the repo's Public shape (plaintext strings only, in-memory) and the Prisma
// column shape (ciphertext triple only). No dual-write, no plaintext
// fallback — ciphertext is the sole source of truth for narrative content.

import type { Prisma, PrismaClient } from '@prisma/client';
import type { Request } from 'express';
import { type ChapterSummary, chapterSummarySchema } from 'story-editor-shared';
import { prisma as defaultPrisma } from '../lib/prisma';
import {
  DekNotAvailableError,
  decryptForRequest,
  type EncPayload,
  encryptForRequest,
  hasDekForRequest,
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
// The generic T lets callers assert the output shape at the call site; the
// internal cast is necessary because the helper builds the projected object
// dynamically and TypeScript cannot verify the shape at compile time.
export function projectDecrypted<T extends Record<string, unknown>>(
  req: Request,
  row: Record<string, unknown>,
  fields: readonly string[],
): T {
  const projected: Record<string, unknown> = { ...stripCiphertextFields(row) };
  for (const f of fields) {
    projected[f] = readEncrypted(req, row, f);
  }
  return projected as unknown as T;
}

// ─── Repo boilerplate hoists ([9wk.4]) ──────────────────────────────────────
// Every narrative repo needs the same three guards and the same two decode
// blocks. `repoTag` keeps the per-repo error/log prefixes intact (e.g.
// 'chapter.repo') so messages stay grep-stable.

export function resolveUserId(req: Request, repoTag: string): string {
  const id = req.user?.id;
  if (!id) throw new Error(`${repoTag}: req.user.id is not set`);
  return id;
}

// ─── Ownership predicates (owner-denormalization, story-editor-z7g) ────────
// One per narrative table, all flat `{ id, userId }` lookups now that every
// table carries its owner directly — no transitive chain to walk. These are
// the single source of truth for "does this row exist and belong to this
// user"; the `ensure*` guards below and the ownership middleware's dispatch
// table both delegate to them.

export async function storyExistsForUser(
  id: string,
  userId: string,
  client: PrismaClient | Prisma.TransactionClient = defaultPrisma,
): Promise<boolean> {
  return (await client.story.findFirst({ where: { id, userId }, select: { id: true } })) !== null;
}

export async function chapterExistsForUser(
  id: string,
  userId: string,
  client: PrismaClient | Prisma.TransactionClient = defaultPrisma,
): Promise<boolean> {
  return (await client.chapter.findFirst({ where: { id, userId }, select: { id: true } })) !== null;
}

export async function characterExistsForUser(
  id: string,
  userId: string,
  client: PrismaClient | Prisma.TransactionClient = defaultPrisma,
): Promise<boolean> {
  return (
    (await client.character.findFirst({ where: { id, userId }, select: { id: true } })) !== null
  );
}

export async function outlineItemExistsForUser(
  id: string,
  userId: string,
  client: PrismaClient | Prisma.TransactionClient = defaultPrisma,
): Promise<boolean> {
  return (
    (await client.outlineItem.findFirst({ where: { id, userId }, select: { id: true } })) !== null
  );
}

export async function draftExistsForUser(
  id: string,
  userId: string,
  client: PrismaClient | Prisma.TransactionClient = defaultPrisma,
): Promise<boolean> {
  return (await client.draft.findFirst({ where: { id, userId }, select: { id: true } })) !== null;
}

export async function chatExistsForUser(
  id: string,
  userId: string,
  client: PrismaClient | Prisma.TransactionClient = defaultPrisma,
): Promise<boolean> {
  return (await client.chat.findFirst({ where: { id, userId }, select: { id: true } })) !== null;
}

export async function messageExistsForUser(
  id: string,
  userId: string,
  client: PrismaClient | Prisma.TransactionClient = defaultPrisma,
): Promise<boolean> {
  return (await client.message.findFirst({ where: { id, userId }, select: { id: true } })) !== null;
}

export async function ensureStoryOwned(
  client: PrismaClient,
  storyId: string,
  userId: string,
  repoTag: string,
): Promise<void> {
  const ok = await storyExistsForUser(storyId, userId, client);
  if (!ok) throw new Error(`${repoTag}: story not owned by caller`);
}

export async function ensureChapterOwned(
  client: PrismaClient | Prisma.TransactionClient,
  chapterId: string,
  userId: string,
  repoTag: string,
): Promise<void> {
  const ok = await chapterExistsForUser(chapterId, userId, client);
  if (!ok) throw new Error(`${repoTag}: chapter not owned by caller`);
}

// Parse a decrypted JSON-string field in place: `projected[field]` (plaintext
// string | null) becomes `projected[targetField]` (parsed tree | raw string on
// parse failure | null). Mirrors the chapter/draft shape() body block.
export function decodeJsonField(
  projected: Record<string, unknown>,
  field: string,
  targetField: string,
): void {
  let parsed: unknown = null;
  if (typeof projected[field] === 'string' && (projected[field] as string).length > 0) {
    try {
      parsed = JSON.parse(projected[field] as string);
    } catch {
      parsed = projected[field];
    }
  }
  delete projected[field];
  projected[targetField] = parsed;
}

// Parse + validate a decrypted summaryJson field in place: sets
// `projected.summary` (ChapterSummary | null) and `projected.summaryUpdatedAt`
// (from the raw row), deleting the intermediate keys. Logs id-only on a
// corrupt blob — decrypted narrative content must never reach logs.
export function decodeSummaryField(
  projected: Record<string, unknown>,
  row: { summaryJsonUpdatedAt: Date | null },
  repoTag: string,
): void {
  let summary: ChapterSummary | null = null;
  if (typeof projected.summaryJson === 'string' && (projected.summaryJson as string).length > 0) {
    try {
      summary = chapterSummarySchema.parse(JSON.parse(projected.summaryJson as string));
    } catch {
      console.warn(`[${repoTag}] summary_parse_failed id=${projected.id as string}`);
      summary = null;
    }
  }
  delete projected.summaryJson;
  projected.summary = summary;
  projected.summaryUpdatedAt = row.summaryJsonUpdatedAt;
  delete projected.summaryJsonUpdatedAt;
}
