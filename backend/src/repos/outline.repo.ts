import type { Request } from 'express';
import type { PrismaClient } from '@prisma/client';
import { prisma as defaultPrisma } from '../lib/prisma';
import { projectDecrypted, writeEncrypted } from './_narrative';

const ENCRYPTED_FIELDS = ['title', 'sub'] as const;

export interface OutlineCreateInput {
  storyId: string;
  order: number;
  title: string;
  sub?: string | null;
  status: string;
}

export type OutlineUpdateInput = Partial<Omit<OutlineCreateInput, 'storyId'>>;

function resolveUserId(req: Request): string {
  const id = req.user?.id;
  if (!id) throw new Error('outline.repo: req.user.id is not set');
  return id;
}

async function ensureStoryOwned(
  client: PrismaClient,
  storyId: string,
  userId: string,
): Promise<void> {
  const ok = await client.story.findFirst({ where: { id: storyId, userId } });
  if (!ok) throw new Error('outline.repo: story not owned by caller');
}

export function createOutlineRepo(req: Request, client: PrismaClient = defaultPrisma) {
  async function create(input: OutlineCreateInput) {
    const userId = resolveUserId(req);
    await ensureStoryOwned(client, input.storyId, userId);
    const row = await client.outlineItem.create({
      data: {
        storyId: input.storyId,
        order: input.order,
        status: input.status,
        // Post-[E11]: `title` and `sub` are ciphertext-only.
        ...writeEncrypted(req, 'title', input.title),
        ...writeEncrypted(req, 'sub', input.sub ?? null),
      },
    });
    return projectDecrypted(req, row as unknown as Record<string, unknown>, ENCRYPTED_FIELDS);
  }

  async function findById(id: string) {
    const userId = resolveUserId(req);
    const row = await client.outlineItem.findFirst({ where: { id, story: { userId } } });
    if (!row) return null;
    return projectDecrypted(req, row as unknown as Record<string, unknown>, ENCRYPTED_FIELDS);
  }

  async function findManyForStory(storyId: string) {
    const userId = resolveUserId(req);
    await ensureStoryOwned(client, storyId, userId);
    const rows = await client.outlineItem.findMany({
      where: { storyId, story: { userId } },
      orderBy: { order: 'asc' },
    });
    return rows.map((r) =>
      projectDecrypted(req, r as unknown as Record<string, unknown>, ENCRYPTED_FIELDS),
    );
  }

  async function update(id: string, input: OutlineUpdateInput) {
    const userId = resolveUserId(req);
    const data: Record<string, unknown> = {};
    if (input.title !== undefined) Object.assign(data, writeEncrypted(req, 'title', input.title));
    if (input.sub !== undefined) Object.assign(data, writeEncrypted(req, 'sub', input.sub));
    if (input.order !== undefined) data.order = input.order;
    if (input.status !== undefined) data.status = input.status;
    const updated = await client.outlineItem.updateMany({
      where: { id, story: { userId } },
      data,
    });
    if (updated.count === 0) return null;
    const row = await client.outlineItem.findFirstOrThrow({
      where: { id, story: { userId } },
    });
    return projectDecrypted(req, row as unknown as Record<string, unknown>, ENCRYPTED_FIELDS);
  }

  async function remove(id: string) {
    const userId = resolveUserId(req);
    const deleted = await client.outlineItem.deleteMany({ where: { id, story: { userId } } });
    return deleted.count > 0;
  }

  return { create, findById, findManyForStory, update, remove };
}
