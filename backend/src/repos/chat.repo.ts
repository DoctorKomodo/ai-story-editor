import type { PrismaClient } from '@prisma/client';
import type { Request } from 'express';
import { CHAT_ENCRYPTED_FIELD_KEYS, type ChatKind } from 'story-editor-shared';
import { prisma as defaultPrisma } from '../lib/prisma';
import { projectDecrypted, writeEncrypted } from './_narrative';

const ENCRYPTED_FIELDS = CHAT_ENCRYPTED_FIELD_KEYS;

// Repo-local input shapes. The shared chatCreateSchema can't cover these
// directly because `chapterId` comes from the URL (not the request body).
export interface ChatCreateInput {
  chapterId: string;
  title?: string | null;
  kind?: ChatKind;
}

export interface ChatUpdateInput {
  title?: string | null;
}

// Repo-layer shape. Dates arrive as `Date` from Prisma; serialize converts to ISO.
// Plaintext-only at this boundary — `titleCiphertext` etc. have been projected
// out by chat.repo.ts via `projectDecrypted<RepoChat>`.
// Defined as a `type` alias (not `interface`) so it satisfies the
// `Record<string, unknown>` constraint on `projectDecrypted<T>`.
export type RepoChat = {
  id: string;
  chapterId: string;
  title: string | null;
  kind: 'ask' | 'scene';
  createdAt: Date;
  updatedAt: Date;
  lastActivityAt: Date;
};

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
    // [9wk.3] Dual-write during the chat contract transition: resolve the
    // chapter's active draft and write BOTH FKs. Task 5's contract migration
    // makes draftId NOT NULL and drops chapterId; until then both columns
    // exist. A null activeDraftId is an invariant violation (chapter-create
    // mints the draft since 9wk.3) — fail loudly, never insert a NULL draftId.
    const chapter = await client.chapter.findUniqueOrThrow({
      where: { id: input.chapterId },
      select: { activeDraftId: true },
    });
    if (chapter.activeDraftId === null) {
      throw new Error('chat.repo: chapter has no active draft (invariant violation)');
    }
    const row = await client.chat.create({
      data: {
        chapterId: input.chapterId,
        draftId: chapter.activeDraftId,
        kind: input.kind ?? 'ask',
        // Post-[E11]: `title` is ciphertext-only.
        ...writeEncrypted(req, 'title', input.title ?? null),
      },
    });
    return projectDecrypted<RepoChat>(req, row, ENCRYPTED_FIELDS);
  }

  async function findById(id: string) {
    const userId = resolveUserId(req);
    const row = await client.chat.findFirst({
      where: { id, chapter: { story: { userId } } },
    });
    if (!row) return null;
    return projectDecrypted<RepoChat>(req, row, ENCRYPTED_FIELDS);
  }

  async function findManyForChapter(chapterId: string, opts?: { kind?: ChatKind }) {
    const userId = resolveUserId(req);
    await ensureChapterOwned(client, chapterId, userId);
    const rows = await client.chat.findMany({
      where: {
        chapterId,
        chapter: { story: { userId } },
        ...(opts?.kind !== undefined ? { kind: opts.kind } : {}),
      },
      // story-editor-loj: order by most-recent-activity desc, with createdAt
      // desc as the tie-breaker for dormant chats whose lastActivityAt equals
      // createdAt. Chat.lastActivityAt is bumped on every child-message create
      // (see messageRepo.create), so this surfaces "the chat the user was
      // most-recently in" at index 0. Tie-breaker is deterministic + matches
      // intuition: dormant-newer-created beats dormant-older-created.
      orderBy: [{ lastActivityAt: 'desc' }, { createdAt: 'desc' }],
    });
    return rows.map((r) => projectDecrypted<RepoChat>(req, r, ENCRYPTED_FIELDS));
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
    const row = await client.chat.findFirst({
      where: { id, chapter: { story: { userId } } },
    });
    if (!row) return null;
    return projectDecrypted<RepoChat>(req, row, ENCRYPTED_FIELDS);
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
