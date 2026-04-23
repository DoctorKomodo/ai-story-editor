import type { Request } from 'express';
import type { PrismaClient } from '@prisma/client';
import { prisma as defaultPrisma } from '../lib/prisma';
import { projectDecrypted, writeEncrypted } from './_narrative';

const ENCRYPTED_FIELDS = ['title', 'synopsis', 'worldNotes', 'systemPrompt'] as const;

export interface StoryCreateInput {
  title: string;
  synopsis?: string | null;
  genre?: string | null;
  worldNotes?: string | null;
  targetWords?: number | null;
  systemPrompt?: string | null;
}

export interface StoryUpdateInput {
  title?: string;
  synopsis?: string | null;
  genre?: string | null;
  worldNotes?: string | null;
  targetWords?: number | null;
  systemPrompt?: string | null;
}

function resolveUserId(req: Request): string {
  const id = req.user?.id;
  if (!id) throw new Error('story.repo: req.user.id is not set (auth middleware missing?)');
  return id;
}

export function createStoryRepo(req: Request, client: PrismaClient = defaultPrisma) {
  async function create(input: StoryCreateInput) {
    const userId = resolveUserId(req);
    const encCols = {
      ...writeEncrypted(req, 'title', input.title),
      ...writeEncrypted(req, 'synopsis', input.synopsis ?? null),
      ...writeEncrypted(req, 'worldNotes', input.worldNotes ?? null),
      ...writeEncrypted(req, 'systemPrompt', input.systemPrompt ?? null),
    };
    const row = await client.story.create({
      data: {
        userId,
        genre: input.genre ?? null,
        targetWords: input.targetWords ?? null,
        // Post-[E11]: only the ciphertext triple persists. `title`,
        // `synopsis`, `worldNotes`, `systemPrompt` are encrypted-only.
        ...encCols,
      },
    });
    return projectDecrypted(req, row as unknown as Record<string, unknown>, ENCRYPTED_FIELDS);
  }

  async function findById(id: string) {
    const userId = resolveUserId(req);
    const row = await client.story.findFirst({ where: { id, userId } });
    if (!row) return null;
    return projectDecrypted(req, row as unknown as Record<string, unknown>, ENCRYPTED_FIELDS);
  }

  async function findManyForUser() {
    const userId = resolveUserId(req);
    const rows = await client.story.findMany({
      where: { userId },
      orderBy: { updatedAt: 'desc' },
    });
    return rows.map((r) =>
      projectDecrypted(req, r as unknown as Record<string, unknown>, ENCRYPTED_FIELDS),
    );
  }

  async function update(id: string, input: StoryUpdateInput) {
    const userId = resolveUserId(req);
    // Scope by userId: updateMany returns { count } and doesn't throw on
    // miss, so unauthorised / unknown ids 404 cleanly without error.
    const data: Record<string, unknown> = {};
    if (input.title !== undefined) {
      Object.assign(data, writeEncrypted(req, 'title', input.title));
    }
    if (input.synopsis !== undefined) {
      Object.assign(data, writeEncrypted(req, 'synopsis', input.synopsis));
    }
    if (input.worldNotes !== undefined) {
      Object.assign(data, writeEncrypted(req, 'worldNotes', input.worldNotes));
    }
    if (input.systemPrompt !== undefined) {
      Object.assign(data, writeEncrypted(req, 'systemPrompt', input.systemPrompt));
    }
    if (input.genre !== undefined) data.genre = input.genre;
    if (input.targetWords !== undefined) data.targetWords = input.targetWords;

    const updated = await client.story.updateMany({
      where: { id, userId },
      data,
    });
    if (updated.count === 0) return null;
    const row = await client.story.findFirst({ where: { id, userId } });
    if (!row) return null;
    return projectDecrypted(req, row as unknown as Record<string, unknown>, ENCRYPTED_FIELDS);
  }

  async function remove(id: string) {
    const userId = resolveUserId(req);
    const deleted = await client.story.deleteMany({ where: { id, userId } });
    return deleted.count > 0;
  }

  return { create, findById, findManyForUser, update, remove };
}
