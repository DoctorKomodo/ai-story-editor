import type { Prisma, PrismaClient } from '@prisma/client';
import type { Request } from 'express';
import { type ChapterSummary, chapterSummarySchema } from 'story-editor-shared';
import { prisma as defaultPrisma } from '../lib/prisma';
import { projectDecrypted, writeEncrypted } from './_narrative';

const DRAFT_ENCRYPTED_FIELD_KEYS = ['body', 'summaryJson', 'label'] as const;

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

function resolveUserId(req: Request): string {
  const id = req.user?.id;
  if (!id) throw new Error('draft.repo: req.user.id is not set');
  return id;
}

async function ensureChapterOwned(
  client: PrismaClient,
  chapterId: string,
  userId: string,
): Promise<void> {
  const ok = await client.chapter.findFirst({ where: { id: chapterId, story: { userId } } });
  if (!ok) throw new Error('draft.repo: chapter not owned by caller');
}

export function createDraftRepo(req: Request, client: PrismaClient = defaultPrisma) {
  async function create(input: RepoDraftCreateInput) {
    const userId = resolveUserId(req);
    await ensureChapterOwned(client, input.chapterId, userId);

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
      } as Prisma.DraftUncheckedCreateInput,
    });
    return shape(row, req);
  }

  async function findById(id: string) {
    const userId = resolveUserId(req);
    const row = await client.draft.findFirst({ where: { id, chapter: { story: { userId } } } });
    if (!row) return null;
    return shape(row, req);
  }

  async function findManyForChapter(chapterId: string): Promise<RepoDraft[]> {
    const userId = resolveUserId(req);
    await ensureChapterOwned(client, chapterId, userId);
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

  let bodyJson: unknown = null;
  if (typeof projected.body === 'string' && projected.body.length > 0) {
    try {
      bodyJson = JSON.parse(projected.body as string);
    } catch {
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
      console.warn(`[draft.repo] summary_parse_failed draft=${projected.id as string}`);
      summary = null;
    }
  }
  delete projected.summaryJson;
  projected.summary = summary;

  const rawRow = row as { summaryJsonUpdatedAt: Date | null };
  projected.summaryUpdatedAt = rawRow.summaryJsonUpdatedAt;

  return projected as RepoDraft;
}
