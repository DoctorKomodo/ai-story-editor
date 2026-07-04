import type { PrismaClient } from '@prisma/client';
import type { Request } from 'express';
import { type ChapterSummary, DRAFT_ENCRYPTED_FIELD_KEYS } from 'story-editor-shared';
import { prisma as defaultPrisma } from '../lib/prisma';
import { computeWordCount } from '../services/tiptap-text';
import {
  decodeJsonField,
  decodeSummaryField,
  ensureChapterOwned,
  projectDecrypted,
  resolveUserId,
  writeEncrypted,
} from './_narrative';

export interface RepoDraftCreateInput {
  chapterId: string;
  bodyJson?: unknown;
  summaryJson?: ChapterSummary | null;
  label?: string | null;
  wordCount?: number;
  orderIndex: number;
}

export interface RepoDraftUpdateInput {
  bodyJson?: unknown;
  wordCount?: number;
  label?: string | null;
  summaryJson?: ChapterSummary | null;
}

export type RepoDraft = {
  id: string;
  chapterId: string;
  bodyJson: unknown;
  summary: ChapterSummary | null;
  summaryUpdatedAt: Date | null;
  label: string | null;
  wordCount: number;
  orderIndex: number;
  createdAt: Date;
  updatedAt: Date;
};

export type RepoDraftMeta = {
  id: string;
  chapterId: string;
  label: string | null;
  wordCount: number;
  orderIndex: number;
  isActive: boolean;
  hasSummary: boolean;
  summaryIsStale: boolean;
  createdAt: Date;
  updatedAt: Date;
};

/**
 * Thrown by `update` when `opts.expectedUpdatedAt` was supplied and no
 * longer matches the row's current `updatedAt`. The route maps this to 409
 * `conflict`. Distinguished from a plain not-found `null` return (404).
 */
export class DraftVersionConflictError extends Error {
  constructor(message = 'draft.repo: expectedUpdatedAt no longer matches the current row') {
    super(message);
    this.name = 'DraftVersionConflictError';
  }
}

/** Delete refused: draft is the chapter's active draft — route maps to 409. */
export class DraftDeleteActiveError extends Error {
  constructor(message = 'draft.repo: cannot delete the active draft') {
    super(message);
    this.name = 'DraftDeleteActiveError';
  }
}

/** Delete refused: draft is the chapter's last draft — route maps to 409. */
export class DraftDeleteLastError extends Error {
  constructor(message = 'draft.repo: cannot delete the last draft') {
    super(message);
    this.name = 'DraftDeleteLastError';
  }
}

export function createDraftRepo(req: Request, client: PrismaClient = defaultPrisma) {
  async function create(input: RepoDraftCreateInput) {
    const userId = resolveUserId(req, 'draft.repo');
    await ensureChapterOwned(client, input.chapterId, userId, 'draft.repo');

    const bodyPlaintext =
      input.bodyJson === undefined || input.bodyJson === null
        ? null
        : JSON.stringify(input.bodyJson);
    const summaryPlaintext =
      input.summaryJson === undefined || input.summaryJson === null
        ? null
        : JSON.stringify(input.summaryJson);
    const labelPlaintext = input.label === undefined ? null : input.label;

    const row = await client.draft.create({
      data: {
        chapterId: input.chapterId,
        orderIndex: input.orderIndex,
        wordCount: input.wordCount ?? 0,
        ...(summaryPlaintext !== null ? { summaryJsonUpdatedAt: new Date() } : {}),
        ...writeEncrypted(req, 'body', bodyPlaintext),
        ...writeEncrypted(req, 'summaryJson', summaryPlaintext),
        ...writeEncrypted(req, 'label', labelPlaintext),
      },
    });
    return shape(row, req);
  }

  async function findById(id: string) {
    const userId = resolveUserId(req, 'draft.repo');
    const row = await client.draft.findFirst({ where: { id, chapter: { story: { userId } } } });
    if (!row) return null;
    return shape(row, req);
  }

  async function findManyForChapter(chapterId: string): Promise<RepoDraft[]> {
    const userId = resolveUserId(req, 'draft.repo');
    await ensureChapterOwned(client, chapterId, userId, 'draft.repo');
    const rows = await client.draft.findMany({
      where: { chapterId, chapter: { story: { userId } } },
      orderBy: [{ orderIndex: 'asc' }, { createdAt: 'asc' }],
    });
    return rows.map((r) => shape(r, req));
  }

  async function update(
    id: string,
    input: RepoDraftUpdateInput,
    opts?: { expectedUpdatedAt?: Date },
  ) {
    const userId = resolveUserId(req, 'draft.repo');
    const data: Record<string, unknown> = {};
    if (input.bodyJson !== undefined) {
      const plaintext = input.bodyJson === null ? null : JSON.stringify(input.bodyJson);
      Object.assign(data, writeEncrypted(req, 'body', plaintext));
    }
    if (input.wordCount !== undefined) data.wordCount = input.wordCount;
    if (input.label !== undefined) {
      Object.assign(data, writeEncrypted(req, 'label', input.label));
    }
    if (input.summaryJson !== undefined) {
      const plaintext = input.summaryJson === null ? null : JSON.stringify(input.summaryJson);
      Object.assign(data, writeEncrypted(req, 'summaryJson', plaintext));
      if (input.summaryJson === null) {
        data.summaryJsonUpdatedAt = null;
      } else {
        const now = new Date();
        data.summaryJsonUpdatedAt = now;
        // Same instant as @updatedAt so a fresh summary isn't immediately
        // stale (this write bumps updatedAt otherwise). Ported from
        // chapter.repo's summary write path.
        data.updatedAt = now;
      }
    }

    if (Object.keys(data).length === 0) {
      // Nothing to write — skip the query entirely so an empty PATCH doesn't
      // bump Prisma's `@updatedAt` and spuriously stale a fresh summary. A
      // stale precondition must still 409 even though there's no write.
      const row = await client.draft.findFirst({ where: { id, chapter: { story: { userId } } } });
      if (!row) return null;
      if (
        opts?.expectedUpdatedAt !== undefined &&
        row.updatedAt.getTime() !== opts.expectedUpdatedAt.getTime()
      ) {
        throw new DraftVersionConflictError();
      }
      return shape(row, req);
    }

    const updated = await client.draft.updateMany({
      where: {
        id,
        chapter: { story: { userId } },
        ...(opts?.expectedUpdatedAt !== undefined ? { updatedAt: opts.expectedUpdatedAt } : {}),
      },
      data,
    });
    if (updated.count === 0) {
      if (opts?.expectedUpdatedAt !== undefined) {
        // Disambiguate: precondition failed (row moved — 409) vs row gone /
        // not owned (plain null → 404). Same pattern as chapter.repo had.
        const exists = await client.draft.findFirst({
          where: { id, chapter: { story: { userId } } },
          select: { id: true },
        });
        if (exists) throw new DraftVersionConflictError();
      }
      return null;
    }
    const row = await client.draft.findFirst({ where: { id, chapter: { story: { userId } } } });
    if (!row) return null;
    return shape(row, req);
  }

  // Cheap owner-scoped check of whether `draftId` is its chapter's active
  // draft — no ciphertext columns selected, no decrypt. Routes that only
  // need this boolean (list/create/patch responses) must not go through
  // `findById`, which decrypts the full row just to read a plaintext column.
  async function isActive(draftId: string): Promise<boolean> {
    const userId = resolveUserId(req, 'draft.repo');
    const row = await client.draft.findFirst({
      where: { id: draftId, chapter: { story: { userId } } },
      select: { id: true, chapter: { select: { activeDraftId: true } } },
    });
    return row !== null && row.chapter.activeDraftId === row.id;
  }

  async function setActive(chapterId: string, draftId: string): Promise<boolean> {
    const userId = resolveUserId(req, 'draft.repo');
    // One owner-scoped guard covering both: the draft must exist under THIS
    // chapter and the chapter under this user. Mismatch and not-found are
    // indistinguishable (no enumeration oracle).
    const draft = await client.draft.findFirst({
      where: { id: draftId, chapterId, chapter: { story: { userId } } },
      select: { id: true },
    });
    if (!draft) return false;
    await client.chapter.update({
      where: { id: chapterId },
      data: { activeDraftId: draftId },
    });
    return true;
  }

  async function remove(id: string): Promise<boolean> {
    const userId = resolveUserId(req, 'draft.repo');
    return client.$transaction(async (tx) => {
      const target = await tx.draft.findFirst({
        where: { id, chapter: { story: { userId } } },
        select: { id: true, chapterId: true, chapter: { select: { activeDraftId: true } } },
      });
      if (!target) return false;
      // Guard order matters for the sole-draft case: a chapter's only draft
      // is always its active draft, so the active guard fires first there.
      if (target.chapter.activeDraftId === target.id) throw new DraftDeleteActiveError();
      const siblingCount = await tx.draft.count({ where: { chapterId: target.chapterId } });
      if (siblingCount <= 1) throw new DraftDeleteLastError();

      await tx.draft.delete({ where: { id: target.id } });

      // Re-pack survivors into 0..N-1 with the [D16] two-phase negative
      // parking (dodges @@unique([chapterId, orderIndex]) mid-transaction).
      const remaining = await tx.draft.findMany({
        where: { chapterId: target.chapterId },
        orderBy: [{ orderIndex: 'asc' }, { createdAt: 'asc' }],
        select: { id: true },
      });
      for (let i = 0; i < remaining.length; i++) {
        await tx.draft.update({ where: { id: remaining[i]!.id }, data: { orderIndex: -(i + 1) } });
      }
      for (let i = 0; i < remaining.length; i++) {
        await tx.draft.update({ where: { id: remaining[i]!.id }, data: { orderIndex: i } });
      }
      return true;
    });
  }

  async function findManyMetaForChapter(chapterId: string): Promise<RepoDraftMeta[]> {
    const userId = resolveUserId(req, 'draft.repo');
    const chapter = await client.chapter.findFirst({
      where: { id: chapterId, story: { userId } },
      select: { activeDraftId: true },
    });
    if (!chapter) throw new Error('draft.repo: chapter not owned by caller');
    const rows = await client.draft.findMany({
      where: { chapterId, chapter: { story: { userId } } },
      orderBy: [{ orderIndex: 'asc' }, { createdAt: 'asc' }],
      select: {
        id: true,
        chapterId: true,
        wordCount: true,
        orderIndex: true,
        createdAt: true,
        updatedAt: true,
        labelCiphertext: true,
        labelIv: true,
        labelAuthTag: true,
        summaryJsonCiphertext: true,
        summaryJsonUpdatedAt: true,
      },
    });
    return rows.map((r) => {
      const projected = projectDecrypted<Record<string, unknown>>(
        req,
        r as Record<string, unknown>,
        ['label'] as const,
      );
      const hasSummary = r.summaryJsonCiphertext != null;
      const summaryIsStale =
        hasSummary && r.summaryJsonUpdatedAt != null && r.summaryJsonUpdatedAt < r.updatedAt;
      delete projected.summaryJsonUpdatedAt;
      return {
        ...projected,
        isActive: r.id === chapter.activeDraftId,
        hasSummary,
        summaryIsStale,
      } as RepoDraftMeta;
    });
  }

  async function nextOrderIndex(chapterId: string): Promise<number> {
    const agg = await client.draft.aggregate({
      where: { chapterId },
      _max: { orderIndex: true },
    });
    return (agg._max.orderIndex ?? -1) + 1;
  }

  async function createFork(chapterId: string, label?: string) {
    const userId = resolveUserId(req, 'draft.repo');
    const chapter = await client.chapter.findFirst({
      where: { id: chapterId, story: { userId } },
      select: { activeDraftId: true },
    });
    if (!chapter) throw new Error('draft.repo: chapter not owned by caller');
    if (chapter.activeDraftId === null) {
      throw new Error('draft.repo: chapter has no active draft (invariant violation)');
    }
    const source = await findById(chapter.activeDraftId);
    if (!source) throw new Error('draft.repo: active draft not resolvable (invariant violation)');
    // Fork copies prose only: body plaintext re-encrypted (fresh IV),
    // wordCount RECOMPUTED from the forked plaintext (never copied — the
    // wordCount-from-plaintext rule), summary NULL, no chats.
    return create({
      chapterId,
      bodyJson: source.bodyJson,
      wordCount: computeWordCount(source.bodyJson),
      label: label ?? null,
      orderIndex: await nextOrderIndex(chapterId),
    });
  }

  async function createBlank(chapterId: string, label?: string) {
    const userId = resolveUserId(req, 'draft.repo');
    await ensureChapterOwned(client, chapterId, userId, 'draft.repo');
    return create({
      chapterId,
      label: label ?? null,
      wordCount: 0,
      orderIndex: await nextOrderIndex(chapterId),
    });
  }

  return {
    create,
    createFork,
    createBlank,
    findById,
    findManyForChapter,
    findManyMetaForChapter,
    update,
    isActive,
    setActive,
    remove,
  };
}

function shape(row: unknown, req: Request): RepoDraft {
  const projected = projectDecrypted(
    req,
    row as Record<string, unknown>,
    DRAFT_ENCRYPTED_FIELD_KEYS,
  );

  decodeJsonField(projected, 'body', 'bodyJson');
  decodeSummaryField(projected, row as { summaryJsonUpdatedAt: Date | null }, 'draft.repo');

  return projected as RepoDraft;
}
