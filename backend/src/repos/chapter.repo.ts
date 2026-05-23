import type { PrismaClient } from '@prisma/client';
import type { Request } from 'express';
import {
  CHAPTER_ENCRYPTED_FIELD_KEYS,
  CHAPTER_META_ENCRYPTED_FIELD_KEYS,
  type ChapterStatus,
  type ChapterSummary,
  chapterSummarySchema,
} from 'story-editor-shared';
import { prisma as defaultPrisma } from '../lib/prisma';
import { projectDecrypted, writeEncrypted } from './_narrative';

// `findManyForStory` is metadata-only — no body fetched, no body decrypted.
// Sidebar / list consumers don't need the body, and skipping it saves a full
// AES-GCM decrypt + JSON.parse per chapter on every list refresh. The single-
// chapter `findById` is the sole authority for `bodyJson`.

export interface RepoChapterCreateInput {
  storyId: string;
  title: string;
  // Body is stored encrypted as a serialised JSON string. Caller passes the
  // TipTap JSON tree; the repo serialises + encrypts it.
  bodyJson?: unknown;
  status?: string;
  orderIndex: number;
  // Plaintext integer derived from bodyJson at save time (before encryption)
  // — we can't count words over ciphertext, so this stays plaintext. See
  // CLAUDE.md "Chapter.wordCount" note.
  wordCount?: number;
}

export interface RepoChapterUpdateInput {
  title?: string;
  bodyJson?: unknown;
  summaryJson?: ChapterSummary | null;
  status?: string;
  orderIndex?: number;
  wordCount?: number;
}

/**
 * Internal repo shape for a fully-decrypted chapter (post-rename of `body`
 * column to `bodyJson` parsed object — see `shape()`). Defined as a `type`
 * alias, not `interface`, so it satisfies `Record<string, unknown>` (the
 * constraint on `projectDecrypted<T>`'s generic).
 */
export type RepoChapter = {
  id: string;
  storyId: string;
  title: string;
  bodyJson: unknown;
  summary: ChapterSummary | null;
  summaryUpdatedAt: Date | null;
  hasSummary: boolean;
  summaryIsStale: boolean;
  wordCount: number;
  orderIndex: number;
  status: ChapterStatus;
  createdAt: Date;
  updatedAt: Date;
};

/**
 * Metadata-only repo shape — same as RepoChapter minus `bodyJson`,
 * `summary`, and `summaryUpdatedAt`. `hasSummary` and `summaryIsStale` are
 * inherited from RepoChapter (they are derived without decrypting the blob).
 * Returned by `shapeMeta()`.
 */
export type RepoChapterMeta = Omit<RepoChapter, 'bodyJson' | 'summary' | 'summaryUpdatedAt'>;

function resolveUserId(req: Request): string {
  const id = req.user?.id;
  if (!id) throw new Error('chapter.repo: req.user.id is not set');
  return id;
}

async function ensureStoryOwned(
  client: PrismaClient,
  storyId: string,
  userId: string,
): Promise<void> {
  const ok = await client.story.findFirst({ where: { id: storyId, userId } });
  if (!ok) throw new Error('chapter.repo: story not owned by caller');
}

/**
 * Thrown by `reorder` when one or more chapter ids in the payload do not
 * belong to the target story for the caller. The route maps this to 403 —
 * we conflate "unknown id" with "id belongs to another story/user" so the
 * endpoint is not an id-enumeration oracle.
 */
export class ChapterNotOwnedError extends Error {
  constructor(message = 'chapter.repo: one or more chapters not owned by caller under storyId') {
    super(message);
    this.name = 'ChapterNotOwnedError';
  }
}

export function createChapterRepo(req: Request, client: PrismaClient = defaultPrisma) {
  async function create(input: RepoChapterCreateInput) {
    const userId = resolveUserId(req);
    await ensureStoryOwned(client, input.storyId, userId);

    // `null` and `undefined` both mean "no body": persist all-null body
    // triples rather than encrypting the literal string "null".
    const bodyPlaintext =
      input.bodyJson === undefined || input.bodyJson === null
        ? null
        : JSON.stringify(input.bodyJson);
    const row = await client.chapter.create({
      data: {
        storyId: input.storyId,
        orderIndex: input.orderIndex,
        status: input.status ?? 'draft',
        wordCount: input.wordCount ?? 0,
        // Post-[E11]: narrative content is ciphertext-only. `title` uses the
        // standard triple; `body` is the serialised TipTap JSON tree
        // encrypted into `bodyCiphertext/Iv/AuthTag` (no plaintext sibling).
        ...writeEncrypted(req, 'title', input.title),
        ...writeEncrypted(req, 'body', bodyPlaintext),
      },
    });
    return shape(row, req);
  }

  async function findById(id: string) {
    const userId = resolveUserId(req);
    const row = await client.chapter.findFirst({
      where: { id, story: { userId } },
    });
    if (!row) return null;
    return shape(row, req);
  }

  async function findManyForStory(storyId: string): Promise<RepoChapterMeta[]>;
  async function findManyForStory(
    storyId: string,
    opts: { includeSummary: true },
  ): Promise<
    Array<RepoChapterMeta & { summary: ChapterSummary | null; summaryUpdatedAt: Date | null }>
  >;
  async function findManyForStory(
    storyId: string,
    opts?: { includeSummary?: boolean },
  ): Promise<
    Array<RepoChapterMeta & { summary?: ChapterSummary | null; summaryUpdatedAt?: Date | null }>
  > {
    const userId = resolveUserId(req);
    await ensureStoryOwned(client, storyId, userId);
    // Metadata-only: skip the body ciphertext triple at the DB layer. This
    // saves a per-chapter AES-GCM decrypt + JSON.parse on every list refresh,
    // matches the documented API contract (docs/api-contract.md:102), and
    // keeps the wire payload independent of chapter-body size. The single-
    // chapter `findById` is the sole authority for `bodyJson`.
    const rows = await client.chapter.findMany({
      where: { storyId, story: { userId } },
      orderBy: [{ orderIndex: 'asc' }, { createdAt: 'asc' }],
      select: {
        id: true,
        storyId: true,
        orderIndex: true,
        status: true,
        wordCount: true,
        createdAt: true,
        updatedAt: true,
        // title triple — decrypted by `shapeMeta`. Body triple deliberately
        // omitted; readers that need it must hit `findById`.
        titleCiphertext: true,
        titleIv: true,
        titleAuthTag: true,
        // summaryJsonCiphertext + summaryJsonUpdatedAt are needed for the
        // hasSummary / summaryIsStale derived flags on every list response.
        // Iv + AuthTag are only selected when the caller opts in to decryption.
        // Iv/AuthTag selection AND the projectDecrypted call below must move together —
        // decoupling produces CiphertextMissingError on the next read, not a silent leak.
        summaryJsonCiphertext: true,
        summaryJsonUpdatedAt: true,
        ...(opts?.includeSummary ? { summaryJsonIv: true, summaryJsonAuthTag: true } : {}),
      },
    });

    if (opts?.includeSummary) {
      return rows.map((r) => {
        const meta = shapeMeta(r, req);
        const summaryRaw = projectDecrypted<{ summaryJson?: string }>(
          req,
          r as Record<string, unknown>,
          ['summaryJson'] as const,
        );
        let summary: ChapterSummary | null = null;
        if (typeof summaryRaw.summaryJson === 'string' && summaryRaw.summaryJson.length > 0) {
          try {
            summary = chapterSummarySchema.parse(JSON.parse(summaryRaw.summaryJson));
          } catch {
            // A ZodError/SyntaxError on a decryptable-but-invalid blob can embed the
            // decrypted field values, and decrypted narrative content must never reach
            // logs — log only a static code + the chapter id.
            console.warn(`[chapter.repo] summary_parse_failed chapter=${meta.id}`);
            summary = null;
          }
        }
        const summaryUpdatedAt = (r as { summaryJsonUpdatedAt: Date | null }).summaryJsonUpdatedAt;
        return { ...meta, summary, summaryUpdatedAt };
      });
    }

    return rows.map((r) => shapeMeta(r, req));
  }

  async function update(id: string, input: RepoChapterUpdateInput) {
    const userId = resolveUserId(req);
    const data: Record<string, unknown> = {};
    if (input.title !== undefined) {
      Object.assign(data, writeEncrypted(req, 'title', input.title));
    }
    if (input.bodyJson !== undefined) {
      // `null` clears the body (all-null ciphertext triple); an object tree
      // is serialised + encrypted. The literal string "null" must never land
      // in ciphertext.
      const plaintext = input.bodyJson === null ? null : JSON.stringify(input.bodyJson);
      Object.assign(data, writeEncrypted(req, 'body', plaintext));
    }
    if (input.summaryJson !== undefined) {
      const plaintext = input.summaryJson === null ? null : JSON.stringify(input.summaryJson);
      Object.assign(data, writeEncrypted(req, 'summaryJson', plaintext));
      if (input.summaryJson === null) {
        data.summaryJsonUpdatedAt = null;
        // hasSummary=false after clear, so staleness is irrelevant regardless of updatedAt
      } else {
        const now = new Date();
        data.summaryJsonUpdatedAt = now;
        data.updatedAt = now; // same instant so a fresh summary isn't immediately stale (this write bumps @updatedAt otherwise)
      }
    }
    if (input.status !== undefined) data.status = input.status;
    if (input.orderIndex !== undefined) data.orderIndex = input.orderIndex;
    if (input.wordCount !== undefined) data.wordCount = input.wordCount;

    const updated = await client.chapter.updateMany({
      where: { id, story: { userId } },
      data,
    });
    if (updated.count === 0) return null;
    const row = await client.chapter.findFirst({
      where: { id, story: { userId } },
    });
    if (!row) return null;

    return shape(row, req);
  }

  async function remove(id: string) {
    const userId = resolveUserId(req);
    return client.$transaction(async (tx) => {
      const target = await tx.chapter.findFirst({
        where: { id, story: { userId } },
        select: { id: true, storyId: true },
      });
      if (!target) return false;

      await tx.chapter.delete({ where: { id: target.id } });

      // Re-pack remaining chapters into sequential orderIndex 0..N-1, ordered
      // by their existing (orderIndex, createdAt) — same key as findManyForStory.
      // Mirrors the [D16] two-phase swap (negative parking values dodge the
      // @@unique([storyId, orderIndex]) constraint mid-transaction).
      const remaining = await tx.chapter.findMany({
        where: { storyId: target.storyId },
        orderBy: [{ orderIndex: 'asc' }, { createdAt: 'asc' }],
        select: { id: true },
      });
      for (let i = 0; i < remaining.length; i++) {
        await tx.chapter.update({
          where: { id: remaining[i]!.id },
          data: { orderIndex: -(i + 1) },
        });
      }
      for (let i = 0; i < remaining.length; i++) {
        await tx.chapter.update({
          where: { id: remaining[i]!.id },
          data: { orderIndex: i },
        });
      }
      return true;
    });
  }

  async function reorder(
    storyId: string,
    items: Array<{ id: string; orderIndex: number }>,
  ): Promise<void> {
    const userId = resolveUserId(req);
    await ensureStoryOwned(client, storyId, userId);

    const ids = items.map((i) => i.id);
    const found = await client.chapter.findMany({
      where: { id: { in: ids }, storyId, story: { userId } },
      select: { id: true },
    });
    if (found.length !== ids.length) {
      throw new ChapterNotOwnedError();
    }

    // [D16] Two-phase swap. With @@unique([storyId, orderIndex]) enabled, a
    // simple swap (e.g. A:0->1 when B already holds 1) would raise P2002
    // mid-transaction. Phase 1 parks every targeted row at a NEGATIVE temp
    // value (which cannot collide with real data, since orderIndex >= 0 is
    // enforced by the Zod schema and every persisted value is >= 0). Phase 2
    // writes the final values; the unique constraint now sees each target
    // slot vacated. Both phases run inside a single interactive transaction
    // so the intermediate negative state is never visible to readers.
    await client.$transaction(async (tx) => {
      for (let i = 0; i < items.length; i++) {
        await tx.chapter.update({
          where: { id: items[i]!.id },
          data: { orderIndex: -(i + 1) },
        });
      }
      for (const item of items) {
        await tx.chapter.update({
          where: { id: item.id },
          data: { orderIndex: item.orderIndex },
        });
      }
    });
  }

  // Aggregate over plaintext, non-narrative columns only. Ciphertext is never
  // touched; this stays inside the repo so routes don't need to reach past it
  // for "scalar" lookups either (CLAUDE.md Database rule).
  async function maxOrderIndex(storyId: string): Promise<number | null> {
    const userId = resolveUserId(req);
    const agg = await client.chapter.aggregate({
      where: { storyId, story: { userId } },
      _max: { orderIndex: true },
    });
    return agg._max.orderIndex ?? null;
  }

  async function aggregateForStories(
    storyIds: string[],
  ): Promise<Map<string, { chapterCount: number; totalWordCount: number }>> {
    const out = new Map<string, { chapterCount: number; totalWordCount: number }>();
    if (storyIds.length === 0) return out;
    const userId = resolveUserId(req);
    const rows = await client.chapter.groupBy({
      by: ['storyId'],
      where: { storyId: { in: storyIds }, story: { userId } },
      _count: { _all: true },
      _sum: { wordCount: true },
    });
    for (const r of rows) {
      out.set(r.storyId, {
        chapterCount: r._count._all,
        totalWordCount: r._sum.wordCount ?? 0,
      });
    }
    return out;
  }

  return {
    create,
    findById,
    findManyForStory,
    update,
    remove,
    reorder,
    maxOrderIndex,
    aggregateForStories,
  };
}

// Metadata-only projection used by `findManyForStory`. Decrypts the title
// triple only — body ciphertext columns are not selected at the DB layer, so
// `bodyJson` is intentionally absent from the projected output. Callers that
// need the body must use `findById`. `summaryJsonCiphertext` and
// `summaryJsonUpdatedAt` are always selected so we can derive the staleness
// flags here without decrypting the summary blob.
function shapeMeta(row: unknown, req: Request): RepoChapterMeta {
  const projected = projectDecrypted<RepoChapterMeta>(
    req,
    row as Record<string, unknown>,
    CHAPTER_META_ENCRYPTED_FIELD_KEYS,
  );
  const r = row as {
    summaryJsonCiphertext: string | null;
    summaryJsonUpdatedAt: Date | null;
    updatedAt: Date;
  };
  const hasSummary = r.summaryJsonCiphertext != null;
  const summaryIsStale =
    hasSummary && r.summaryJsonUpdatedAt != null && r.summaryJsonUpdatedAt < r.updatedAt;
  return { ...projected, hasSummary, summaryIsStale } as RepoChapterMeta;
}

function shape(row: unknown, req: Request): RepoChapter {
  const projected = projectDecrypted(
    req,
    row as Record<string, unknown>,
    CHAPTER_ENCRYPTED_FIELD_KEYS,
  );
  // The encrypted column is named `body` (matching `bodyCiphertext/Iv/AuthTag`),
  // but the API contract surfaces the TipTap document tree as `bodyJson`. Parse
  // the serialised JSON and rename the field on the way out.
  let bodyJson: unknown = null;
  if (typeof projected.body === 'string' && projected.body.length > 0) {
    try {
      bodyJson = JSON.parse(projected.body as string);
    } catch {
      // Non-JSON plaintext — shouldn't happen post-[E11]; surface as-is so
      // the caller can see something went wrong rather than crash.
      bodyJson = projected.body;
    }
  }
  delete projected.body;
  projected.bodyJson = bodyJson;

  let summary: ChapterSummary | null = null;
  if (typeof projected.summaryJson === 'string' && projected.summaryJson.length > 0) {
    try {
      summary = chapterSummarySchema.parse(JSON.parse(projected.summaryJson as string));
    } catch {
      // A ZodError/SyntaxError on a decryptable-but-invalid blob can embed the
      // decrypted field values, and decrypted narrative content must never reach
      // logs — log only a static code + the chapter id.
      console.warn(`[chapter.repo] summary_parse_failed chapter=${projected.id as string}`);
      summary = null;
    }
  }
  delete projected.summaryJson;
  projected.summary = summary;
  // Derive hasSummary/summaryIsStale from the raw ciphertext column + timestamps,
  // identical to shapeMeta(). A corrupt-but-present blob must still report
  // hasSummary=true so the frontend can surface the corrupted state
  // (hasSummary === true && summary === null).
  const rawRow = row as {
    summaryJsonCiphertext: string | null;
    summaryJsonUpdatedAt: Date | null;
    updatedAt: Date;
  };
  projected.summaryUpdatedAt = rawRow.summaryJsonUpdatedAt;
  projected.hasSummary = rawRow.summaryJsonCiphertext != null;
  projected.summaryIsStale =
    projected.hasSummary &&
    rawRow.summaryJsonUpdatedAt != null &&
    rawRow.summaryJsonUpdatedAt < rawRow.updatedAt;

  return projected as RepoChapter;
}
