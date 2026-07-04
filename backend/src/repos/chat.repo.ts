import type { PrismaClient } from '@prisma/client';
import type { Request } from 'express';
import { CHAT_ENCRYPTED_FIELD_KEYS, type ChatKind } from 'story-editor-shared';
import { prisma as defaultPrisma } from '../lib/prisma';
import { projectDecrypted, resolveUserId, writeEncrypted } from './_narrative';

const ENCRYPTED_FIELDS = CHAT_ENCRYPTED_FIELD_KEYS;

// Repo-local input shapes. The shared chatCreateSchema can't cover these
// directly because `draftId` comes from the URL-resolved draft (not the body).
export interface ChatCreateInput {
  draftId: string;
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
  draftId: string;
  title: string | null;
  kind: 'ask' | 'scene';
  createdAt: Date;
  updatedAt: Date;
  lastActivityAt: Date;
};

async function ensureDraftOwned(
  client: PrismaClient,
  draftId: string,
  userId: string,
): Promise<void> {
  const ok = await client.draft.findFirst({
    where: { id: draftId, chapter: { story: { userId } } },
  });
  if (!ok) throw new Error('chat.repo: draft not owned by caller');
}

export function createChatRepo(req: Request, client: PrismaClient = defaultPrisma) {
  async function create(input: ChatCreateInput) {
    const userId = resolveUserId(req, 'chat.repo');
    await ensureDraftOwned(client, input.draftId, userId);
    const row = await client.chat.create({
      data: {
        draftId: input.draftId,
        kind: input.kind ?? 'ask',
        // Post-[E11]: `title` is ciphertext-only.
        ...writeEncrypted(req, 'title', input.title ?? null),
      },
    });
    return projectDecrypted<RepoChat>(req, row, ENCRYPTED_FIELDS);
  }

  async function findById(id: string) {
    const userId = resolveUserId(req, 'chat.repo');
    const row = await client.chat.findFirst({
      where: { id, draft: { chapter: { story: { userId } } } },
    });
    if (!row) return null;
    return projectDecrypted<RepoChat>(req, row, ENCRYPTED_FIELDS);
  }

  async function findManyForDraft(draftId: string, opts?: { kind?: ChatKind }) {
    const userId = resolveUserId(req, 'chat.repo');
    await ensureDraftOwned(client, draftId, userId);
    const rows = await client.chat.findMany({
      where: {
        draftId,
        draft: { chapter: { story: { userId } } },
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
    const userId = resolveUserId(req, 'chat.repo');
    const data: Record<string, unknown> = {};
    if (input.title !== undefined) Object.assign(data, writeEncrypted(req, 'title', input.title));
    const updated = await client.chat.updateMany({
      where: { id, draft: { chapter: { story: { userId } } } },
      data,
    });
    if (updated.count === 0) return null;
    const row = await client.chat.findFirst({
      where: { id, draft: { chapter: { story: { userId } } } },
    });
    if (!row) return null;
    return projectDecrypted<RepoChat>(req, row, ENCRYPTED_FIELDS);
  }

  async function remove(id: string) {
    const userId = resolveUserId(req, 'chat.repo');
    const deleted = await client.chat.deleteMany({
      where: { id, draft: { chapter: { story: { userId } } } },
    });
    return deleted.count > 0;
  }

  return { create, findById, findManyForDraft, update, remove };
}
