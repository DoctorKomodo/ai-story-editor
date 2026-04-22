import type { Request } from 'express';
import { Prisma, type PrismaClient } from '@prisma/client';
import { prisma as defaultPrisma } from '../lib/prisma';
import { projectDecrypted, writeCiphertextOnly, writeEncrypted } from './_narrative';

const ENCRYPTED_FIELDS = ['title', 'body'] as const;

export interface ChapterCreateInput {
  storyId: string;
  title: string;
  // Body is stored encrypted as a serialised JSON string. Caller passes the
  // TipTap JSON tree; the repo serialises + encrypts it.
  bodyJson?: unknown;
  // Plaintext text derived from bodyJson by the caller ([B10]), used only
  // for the wordCount derivation since we can't count over ciphertext.
  content?: string;
  status?: string;
  orderIndex: number;
  wordCount?: number;
}

export interface ChapterUpdateInput {
  title?: string;
  bodyJson?: unknown;
  content?: string;
  status?: string;
  orderIndex?: number;
  wordCount?: number;
}

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

export function createChapterRepo(req: Request, client: PrismaClient = defaultPrisma) {
  async function create(input: ChapterCreateInput) {
    const userId = resolveUserId(req);
    await ensureStoryOwned(client, input.storyId, userId);

    const bodyPlaintext = input.bodyJson === undefined ? null : JSON.stringify(input.bodyJson);
    const row = await client.chapter.create({
      data: {
        storyId: input.storyId,
        orderIndex: input.orderIndex,
        status: input.status ?? 'draft',
        wordCount: input.wordCount ?? 0,
        // Plaintext dual-writes during rollout; dropped in [E11].
        title: input.title,
        content: input.content ?? '',
        bodyJson:
          input.bodyJson === undefined
            ? Prisma.DbNull
            : (input.bodyJson as Prisma.InputJsonValue),
        ...writeEncrypted(req, 'title', input.title),
        // body plaintext lives in bodyJson + content (dropped in [E11]); the
        // ciphertext triple is bodyCiphertext/Iv/AuthTag with no plain `body`
        // column in the schema.
        ...writeCiphertextOnly(req, 'body', bodyPlaintext),
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

  async function findManyForStory(storyId: string) {
    const userId = resolveUserId(req);
    await ensureStoryOwned(client, storyId, userId);
    const rows = await client.chapter.findMany({
      where: { storyId, story: { userId } },
      orderBy: [{ orderIndex: 'asc' }, { createdAt: 'asc' }],
    });
    return rows.map((r) => shape(r, req));
  }

  async function update(id: string, input: ChapterUpdateInput) {
    const userId = resolveUserId(req);
    const data: Record<string, unknown> = {};
    if (input.title !== undefined) {
      Object.assign(data, writeEncrypted(req, 'title', input.title));
    }
    if (input.bodyJson !== undefined) {
      const plaintext = JSON.stringify(input.bodyJson);
      Object.assign(data, writeCiphertextOnly(req, 'body', plaintext));
      data.bodyJson = input.bodyJson as Prisma.InputJsonValue;
    }
    if (input.content !== undefined) data.content = input.content;
    if (input.status !== undefined) data.status = input.status;
    if (input.orderIndex !== undefined) data.orderIndex = input.orderIndex;
    if (input.wordCount !== undefined) data.wordCount = input.wordCount;

    const updated = await client.chapter.updateMany({
      where: { id, story: { userId } },
      data,
    });
    if (updated.count === 0) return null;
    const row = await client.chapter.findFirstOrThrow({
      where: { id, story: { userId } },
    });
    return shape(row, req);
  }

  async function remove(id: string) {
    const userId = resolveUserId(req);
    const deleted = await client.chapter.deleteMany({ where: { id, story: { userId } } });
    return deleted.count > 0;
  }

  return { create, findById, findManyForStory, update, remove };
}

function shape(row: unknown, req: Request) {
  const projected = projectDecrypted(req, row as Record<string, unknown>, ENCRYPTED_FIELDS);
  // Surface `body` as parsed JSON when it's present; callers expect the tree,
  // not the serialised string.
  if (typeof projected.body === 'string' && projected.body.length > 0) {
    try {
      projected.body = JSON.parse(projected.body);
    } catch {
      // Non-JSON plaintext from the pre-[E10] rollout window — leave as-is.
    }
  }
  return projected;
}
