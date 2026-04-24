import type { Request } from 'express';
import type { PrismaClient } from '@prisma/client';
import { prisma as defaultPrisma } from '../lib/prisma';
import { projectDecrypted, writeCiphertextOnly, writeEncrypted } from './_narrative';

const ENCRYPTED_FIELDS = ['title', 'body'] as const;

export interface ChapterCreateInput {
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

export interface ChapterUpdateInput {
  title?: string;
  bodyJson?: unknown;
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
  async function create(input: ChapterCreateInput) {
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
      // `null` clears the body (all-null ciphertext triple); an object tree
      // is serialised + encrypted. The literal string "null" must never land
      // in ciphertext.
      const plaintext = input.bodyJson === null ? null : JSON.stringify(input.bodyJson);
      Object.assign(data, writeCiphertextOnly(req, 'body', plaintext));
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
    const deleted = await client.chapter.deleteMany({ where: { id, story: { userId } } });
    return deleted.count > 0;
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

  return { create, findById, findManyForStory, update, remove, reorder };
}

function shape(row: unknown, req: Request) {
  const projected = projectDecrypted(req, row as Record<string, unknown>, ENCRYPTED_FIELDS);
  // Surface `body` as parsed JSON when it's present; callers expect the tree,
  // not the serialised string.
  if (typeof projected.body === 'string' && projected.body.length > 0) {
    try {
      projected.body = JSON.parse(projected.body);
    } catch {
      // Non-JSON plaintext — shouldn't happen post-[E11]; leave as string
      // so the caller can see something went wrong rather than crash.
    }
  }
  return projected;
}
