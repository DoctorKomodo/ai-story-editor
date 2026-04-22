import type { Request } from 'express';
import type { PrismaClient } from '@prisma/client';
import { prisma as defaultPrisma } from '../lib/prisma';
import { projectDecrypted, writeEncrypted } from './_narrative';

const ENCRYPTED_FIELDS = ['title'] as const;

export interface ChatCreateInput {
  chapterId: string;
  title?: string | null;
}

export interface ChatUpdateInput {
  title?: string | null;
}

function resolveUserId(req: Request): string {
  const id = req.user?.id;
  if (!id) throw new Error('chat.repo: req.user.id is not set');
  return id;
}

async function ensureChapterOwned(
  client: PrismaClient,
  chapterId: string,
  userId: string,
): Promise<void> {
  const ok = await client.chapter.findFirst({
    where: { id: chapterId, story: { userId } },
  });
  if (!ok) throw new Error('chat.repo: chapter not owned by caller');
}

export function createChatRepo(req: Request, client: PrismaClient = defaultPrisma) {
  async function create(input: ChatCreateInput) {
    const userId = resolveUserId(req);
    await ensureChapterOwned(client, input.chapterId, userId);
    const row = await client.chat.create({
      data: {
        chapterId: input.chapterId,
        // Post-[E11]: `title` is ciphertext-only.
        ...writeEncrypted(req, 'title', input.title ?? null),
      },
    });
    return projectDecrypted(req, row as unknown as Record<string, unknown>, ENCRYPTED_FIELDS);
  }

  async function findById(id: string) {
    const userId = resolveUserId(req);
    const row = await client.chat.findFirst({
      where: { id, chapter: { story: { userId } } },
    });
    if (!row) return null;
    return projectDecrypted(req, row as unknown as Record<string, unknown>, ENCRYPTED_FIELDS);
  }

  async function findManyForChapter(chapterId: string) {
    const userId = resolveUserId(req);
    await ensureChapterOwned(client, chapterId, userId);
    const rows = await client.chat.findMany({
      where: { chapterId, chapter: { story: { userId } } },
      orderBy: { createdAt: 'asc' },
    });
    return rows.map((r) =>
      projectDecrypted(req, r as unknown as Record<string, unknown>, ENCRYPTED_FIELDS),
    );
  }

  async function update(id: string, input: ChatUpdateInput) {
    const userId = resolveUserId(req);
    const data: Record<string, unknown> = {};
    if (input.title !== undefined) Object.assign(data, writeEncrypted(req, 'title', input.title));
    const updated = await client.chat.updateMany({
      where: { id, chapter: { story: { userId } } },
      data,
    });
    if (updated.count === 0) return null;
    const row = await client.chat.findFirstOrThrow({
      where: { id, chapter: { story: { userId } } },
    });
    return projectDecrypted(req, row as unknown as Record<string, unknown>, ENCRYPTED_FIELDS);
  }

  async function remove(id: string) {
    const userId = resolveUserId(req);
    const deleted = await client.chat.deleteMany({
      where: { id, chapter: { story: { userId } } },
    });
    return deleted.count > 0;
  }

  return { create, findById, findManyForChapter, update, remove };
}
