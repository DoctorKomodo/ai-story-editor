import type { PrismaClient } from '@prisma/client';
import type { Request } from 'express';
import { CHAPTER_META_ENCRYPTED_FIELD_KEYS, type ChapterSummary } from 'story-editor-shared';
import { prisma as defaultPrisma } from '../lib/prisma';
import {
  decodeJsonField,
  decodeSummaryField,
  ensureStoryOwned,
  projectDecrypted,
  resolveUserId,
  writeEncrypted,
} from './_narrative';
import { createDraftRepo } from './draft.repo';

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
  orderIndex: number;
  // Plaintext integer derived from bodyJson at save time (before encryption)
  // — we can't count words over ciphertext, so this stays plaintext. See
  // CLAUDE.md "Chapter.wordCount" note.
  wordCount?: number;
}

// [9wk.4] Narrowed to structural fields only — body/summary/wordCount writes
// go through draft.repo now (the active draft IS the chapter downstream).
export interface RepoChapterUpdateInput {
  title?: string;
  orderIndex?: number;
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
  createdAt: Date;
  updatedAt: Date;
  // [9wk.4] Sourced from the ACTIVE draft (the active draft IS the chapter
  // downstream): bodyJson, summary, summaryUpdatedAt, hasSummary,
  // summaryIsStale, wordCount. title/orderIndex/timestamps stay chapter-own.
  activeDraftId: string | null;
  draftCount: number;
};

/**
 * Metadata-only repo shape — same as RepoChapter minus `bodyJson`,
 * `summary`, and `summaryUpdatedAt`. `hasSummary` and `summaryIsStale` are
 * inherited from RepoChapter (they are derived without decrypting the blob).
 * Returned by `shapeMeta()`.
 */
export type RepoChapterMeta = Omit<RepoChapter, 'bodyJson' | 'summary' | 'summaryUpdatedAt'>;

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

// Standard include for a single-chapter read: joins the active draft (source
// of bodyJson/summary/wordCount) and the draft count. `findById`, `create`,
// and `update` all re-read with this same include so `shape()` can rely on
// its shape.
const CHAPTER_WITH_ACTIVE_DRAFT = {
  activeDraft: true,
  _count: { select: { drafts: true } },
} as const;

export function createChapterRepo(req: Request, client: PrismaClient = defaultPrisma) {
  async function create(input: RepoChapterCreateInput) {
    const userId = resolveUserId(req, 'chapter.repo');
    await ensureStoryOwned(client, input.storyId, userId, 'chapter.repo');

    // [9wk.5] Chapter + initial draft + active pointer in ONE transaction:
    // the "every chapter has exactly one active draft" invariant (spec §3/§6)
    // must never be observable as violated. draft.repo owns the body
    // stringify + encryption; the chapter row carries structural fields only.
    const row = await client.$transaction(async (tx) => {
      const chapterRow = await tx.chapter.create({
        data: {
          storyId: input.storyId,
          orderIndex: input.orderIndex,
          ...writeEncrypted(req, 'title', input.title),
        },
      });
      // Same tx-client cast pattern as import.service.ts. draft.repo owns
      // Draft encryption; its ensureChapterOwned re-check inside the tx is
      // one cheap SELECT against the row created above.
      const draft = await createDraftRepo(req, tx as unknown as PrismaClient).create({
        chapterId: chapterRow.id,
        bodyJson: input.bodyJson,
        wordCount: input.wordCount ?? 0,
        orderIndex: 0,
      });
      await tx.chapter.update({
        where: { id: chapterRow.id },
        data: { activeDraftId: draft.id },
      });
      // [9wk.4] Reads are draft-backed now — re-read with the same include
      // `shape()` expects rather than trusting the bare update() result.
      return tx.chapter.findFirstOrThrow({
        where: { id: chapterRow.id },
        include: CHAPTER_WITH_ACTIVE_DRAFT,
      });
    });
    return shape(row, req);
  }

  async function findById(id: string) {
    const userId = resolveUserId(req, 'chapter.repo');
    const row = await client.chapter.findFirst({
      where: { id, story: { userId } },
      include: CHAPTER_WITH_ACTIVE_DRAFT,
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
    const userId = resolveUserId(req, 'chapter.repo');
    await ensureStoryOwned(client, storyId, userId, 'chapter.repo');
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
        createdAt: true,
        updatedAt: true,
        activeDraftId: true,
        // title triple — decrypted by `shapeMeta`. Body triple deliberately
        // omitted; readers that need it must hit `findById`.
        titleCiphertext: true,
        titleIv: true,
        titleAuthTag: true,
        _count: { select: { drafts: true } },
        // wordCount / hasSummary / summaryIsStale are sourced from the
        // ACTIVE DRAFT now, not the chapter row — see chapter.repo shape().
        // Iv + AuthTag are only selected when the caller opts in to decryption.
        // Iv/AuthTag selection AND the projectDecrypted call below must move
        // together — decoupling produces CiphertextMissingError on the next read.
        activeDraft: {
          select: {
            id: true,
            wordCount: true,
            updatedAt: true,
            summaryJsonCiphertext: true,
            summaryJsonUpdatedAt: true,
            ...(opts?.includeSummary ? { summaryJsonIv: true, summaryJsonAuthTag: true } : {}),
          },
        },
      },
    });

    if (opts?.includeSummary) {
      return rows.map((r) => {
        if (r.activeDraft === null) {
          throw new Error('chapter.repo: chapter has no active draft (invariant violation)');
        }
        const meta = shapeMeta(r, req);
        const draftProjected = projectDecrypted<Record<string, unknown>>(
          req,
          r.activeDraft as Record<string, unknown>,
          ['summaryJson'] as const,
        );
        decodeSummaryField(
          draftProjected,
          r.activeDraft as { summaryJsonUpdatedAt: Date | null },
          'chapter.repo',
        );
        return {
          ...meta,
          summary: draftProjected.summary as ChapterSummary | null,
          summaryUpdatedAt: draftProjected.summaryUpdatedAt as Date | null,
        };
      });
    }

    return rows.map((r) => shapeMeta(r, req));
  }

  async function update(id: string, input: RepoChapterUpdateInput) {
    const userId = resolveUserId(req, 'chapter.repo');
    const data: Record<string, unknown> = {};
    if (input.title !== undefined) {
      Object.assign(data, writeEncrypted(req, 'title', input.title));
    }
    if (input.orderIndex !== undefined) data.orderIndex = input.orderIndex;

    const updated = await client.chapter.updateMany({
      where: { id, story: { userId } },
      data,
    });
    if (updated.count === 0) return null;

    const row = await client.chapter.findFirst({
      where: { id, story: { userId } },
      include: CHAPTER_WITH_ACTIVE_DRAFT,
    });
    if (!row) return null;

    return shape(row, req);
  }

  async function remove(id: string) {
    const userId = resolveUserId(req, 'chapter.repo');
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
    const userId = resolveUserId(req, 'chapter.repo');
    await ensureStoryOwned(client, storyId, userId, 'chapter.repo');

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
    const userId = resolveUserId(req, 'chapter.repo');
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
    const userId = resolveUserId(req, 'chapter.repo');
    // [9wk.5] Word totals follow the ACTIVE draft (Chapter.wordCount is
    // dropped by this step's contract migration). One owner-scoped query +
    // reduce; zero-chapter stories get no entry, matching the old groupBy —
    // the route's `?? 0` defaults cover them.
    const rows = await client.chapter.findMany({
      where: { storyId: { in: storyIds }, story: { userId } },
      select: { storyId: true, activeDraft: { select: { wordCount: true } } },
    });
    for (const r of rows) {
      if (r.activeDraft === null) {
        // Stricter than the old groupBy (which silently summed the dormant
        // column): consistent with shape()/shapeMeta()'s invariant throw. All
        // fixtures reaching this path mint or explicitly wire a draft
        // (verified: ownership.middleware / delete-account raw seeds build the
        // triangle), so no test relies on tolerating a draftless chapter.
        throw new Error('chapter.repo: chapter has no active draft (invariant violation)');
      }
      const agg = out.get(r.storyId) ?? { chapterCount: 0, totalWordCount: 0 };
      agg.chapterCount += 1;
      agg.totalWordCount += r.activeDraft.wordCount;
      out.set(r.storyId, agg);
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
// need the body must use `findById`. wordCount / hasSummary / summaryIsStale
// are sourced from the joined `activeDraft` sub-object, not the chapter row.
function shapeMeta(row: unknown, req: Request): RepoChapterMeta {
  const r = row as {
    id: string;
    storyId: string;
    orderIndex: number;
    createdAt: Date;
    updatedAt: Date;
    activeDraftId: string | null;
    _count: { drafts: number };
    activeDraft: {
      wordCount: number;
      updatedAt: Date;
      summaryJsonCiphertext: string | null;
      summaryJsonUpdatedAt: Date | null;
    } | null;
  };
  if (r.activeDraft === null) {
    throw new Error('chapter.repo: chapter has no active draft (invariant violation)');
  }
  const projected = projectDecrypted<{ title: string }>(
    req,
    row as Record<string, unknown>,
    CHAPTER_META_ENCRYPTED_FIELD_KEYS,
  );
  const hasSummary = r.activeDraft.summaryJsonCiphertext != null;
  const summaryIsStale =
    hasSummary &&
    r.activeDraft.summaryJsonUpdatedAt != null &&
    r.activeDraft.summaryJsonUpdatedAt < r.activeDraft.updatedAt;
  return {
    id: r.id,
    storyId: r.storyId,
    title: projected.title,
    wordCount: r.activeDraft.wordCount,
    orderIndex: r.orderIndex,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
    activeDraftId: r.activeDraftId,
    draftCount: r._count.drafts,
    hasSummary,
    summaryIsStale,
  };
}

// Two-projection split: the chapter row decrypts `title` only (its
// bodyCiphertext/summaryJson* columns are dormant post-[9wk.4] — decrypting
// them here would silently serve a stale copy); bodyJson/summary/wordCount
// are sourced from the ACTIVE DRAFT, which is the chapter downstream.
function shape(row: unknown, req: Request): RepoChapter {
  const r = row as {
    id: string;
    storyId: string;
    orderIndex: number;
    createdAt: Date;
    updatedAt: Date;
    activeDraftId: string | null;
    activeDraft: Record<string, unknown> | null;
    _count: { drafts: number };
  };
  if (r.activeDraft === null) {
    throw new Error('chapter.repo: chapter has no active draft (invariant violation)');
  }

  const projected = projectDecrypted<{ title: string }>(
    req,
    row as Record<string, unknown>,
    CHAPTER_META_ENCRYPTED_FIELD_KEYS,
  );

  const draftProjected = projectDecrypted<Record<string, unknown>>(req, r.activeDraft, [
    'body',
    'summaryJson',
  ] as const);
  // The encrypted column is named `body` (matching `bodyCiphertext/Iv/AuthTag`),
  // but the API contract surfaces the TipTap document tree as `bodyJson`.
  decodeJsonField(draftProjected, 'body', 'bodyJson');
  decodeSummaryField(
    draftProjected,
    r.activeDraft as { summaryJsonUpdatedAt: Date | null },
    'chapter.repo',
  );

  const activeDraftRaw = r.activeDraft as {
    summaryJsonCiphertext: string | null;
    summaryJsonUpdatedAt: Date | null;
    updatedAt: Date;
    wordCount: number;
  };
  const hasSummary = activeDraftRaw.summaryJsonCiphertext != null;
  const summaryIsStale =
    hasSummary &&
    activeDraftRaw.summaryJsonUpdatedAt != null &&
    activeDraftRaw.summaryJsonUpdatedAt < activeDraftRaw.updatedAt;

  return {
    id: r.id,
    storyId: r.storyId,
    title: projected.title,
    bodyJson: draftProjected.bodyJson,
    summary: draftProjected.summary as ChapterSummary | null,
    summaryUpdatedAt: draftProjected.summaryUpdatedAt as Date | null,
    hasSummary,
    summaryIsStale,
    wordCount: activeDraftRaw.wordCount,
    orderIndex: r.orderIndex,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
    activeDraftId: r.activeDraftId,
    draftCount: r._count.drafts,
  };
}
