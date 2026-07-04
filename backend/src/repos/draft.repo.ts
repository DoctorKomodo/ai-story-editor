import type { PrismaClient } from '@prisma/client';
import type { Request } from 'express';
import { type ChapterSummary, DRAFT_ENCRYPTED_FIELD_KEYS } from 'story-editor-shared';
import { prisma as defaultPrisma } from '../lib/prisma';
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

  return { create, findById, findManyForChapter };
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
