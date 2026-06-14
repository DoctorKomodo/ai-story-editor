import type { PrismaClient } from '@prisma/client';
import type { Request } from 'express';
import type { Citation, Message, MessageAttachment, MessageRole } from 'story-editor-shared';
import { MESSAGE_ENCRYPTED_FIELD_KEYS, MESSAGE_JSON_PAYLOAD_FIELD_KEYS } from 'story-editor-shared';
import { prisma as defaultPrisma } from '../lib/prisma';
import { projectDecrypted, writeEncrypted } from './_narrative';

const ENCRYPTED_FIELDS = MESSAGE_ENCRYPTED_FIELD_KEYS;
const JSON_PAYLOAD_FIELDS = MESSAGE_JSON_PAYLOAD_FIELD_KEYS;

export interface MessageCreateInput {
  chatId: string;
  role: MessageRole;
  content: string;
  attachmentJson?: MessageAttachment | null;
  // null when web search is disabled or produced no valid results; `[]` must not be passed.
  citationsJson?: Citation[] | null;
  model?: string | null;
  tokens?: number | null;
  latencyMs?: number | null;
}

export type RepoMessage = Omit<Message, 'createdAt' | 'updatedAt'> & {
  createdAt: Date;
  updatedAt: Date | null;
};

function resolveUserId(req: Request): string {
  const id = req.user?.id;
  if (!id) throw new Error('message.repo: req.user.id is not set');
  return id;
}

async function ensureChatOwned(
  client: PrismaClient,
  chatId: string,
  userId: string,
): Promise<void> {
  const ok = await client.chat.findFirst({
    where: { id: chatId, chapter: { story: { userId } } },
  });
  if (!ok) throw new Error('message.repo: chat not owned by caller');
}

function serialiseJsonField(v: unknown | null | undefined): string | null {
  if (v === null || v === undefined) return null;
  return JSON.stringify(v);
}

export function createMessageRepo(req: Request, client: PrismaClient = defaultPrisma) {
  async function create(input: MessageCreateInput) {
    const userId = resolveUserId(req);
    await ensureChatOwned(client, input.chatId, userId);
    // Bump Chat.lastActivityAt atomically with the insert — ordering by recency depends on it.
    const row = await client.$transaction(async (tx) => {
      const created = await tx.message.create({
        data: {
          chatId: input.chatId,
          role: input.role,
          model: input.model ?? null,
          tokens: input.tokens ?? null,
          latencyMs: input.latencyMs ?? null,
          ...writeEncrypted(req, 'content', input.content),
          ...writeEncrypted(req, 'attachmentJson', serialiseJsonField(input.attachmentJson)),
          ...writeEncrypted(req, 'citationsJson', serialiseJsonField(input.citationsJson ?? null)),
        },
      });
      await tx.chat.update({
        where: { id: input.chatId },
        data: { lastActivityAt: new Date() },
        select: { id: true },
      });
      return created;
    });
    return shape(row, req);
  }

  async function update(id: string, chatId: string, input: { content: string }) {
    const userId = resolveUserId(req);
    // Ownership + role gate: only the owner's own user messages are editable,
    // and the message must belong to the specific chat named in the URL.
    const target = await client.message.findFirst({
      where: { id, chatId, chat: { chapter: { story: { userId } } } },
      select: { id: true, role: true },
    });
    if (!target || target.role !== 'user') return null;

    const row = await client.$transaction(async (tx) => {
      const updated = await tx.message.update({
        where: { id },
        data: {
          ...writeEncrypted(req, 'content', input.content),
          updatedAt: new Date(),
        },
      });
      // An edit counts as activity — bump lastActivityAt like create does.
      await tx.chat.update({
        where: { id: chatId },
        data: { lastActivityAt: new Date() },
        select: { id: true },
      });
      return updated;
    });
    return shape(row, req);
  }

  async function findById(id: string) {
    const userId = resolveUserId(req);
    const row = await client.message.findFirst({
      where: { id, chat: { chapter: { story: { userId } } } },
    });
    if (!row) return null;
    return shape(row, req);
  }

  async function findManyForChat(chatId: string) {
    const userId = resolveUserId(req);
    await ensureChatOwned(client, chatId, userId);
    const rows = await client.message.findMany({
      where: { chatId, chat: { chapter: { story: { userId } } } },
      orderBy: { createdAt: 'asc' },
    });
    return rows.map((r) => shape(r, req));
  }

  async function countForChat(chatId: string): Promise<number> {
    const userId = resolveUserId(req);
    return client.message.count({
      where: { chatId, chat: { chapter: { story: { userId } } } },
    });
  }

  async function deleteAllAfter(
    chatId: string,
    afterMessageId: string,
  ): Promise<{ count: number }> {
    const userId = resolveUserId(req);
    await ensureChatOwned(client, chatId, userId);
    const ref = await client.message.findFirst({
      where: {
        id: afterMessageId,
        chatId,
        chat: { chapter: { story: { userId } } },
      },
      select: { id: true, createdAt: true },
    });
    if (!ref) {
      return { count: 0 };
    }
    const result = await client.message.deleteMany({
      where: {
        chatId,
        chat: { chapter: { story: { userId } } },
        OR: [
          { createdAt: { gt: ref.createdAt } },
          { AND: [{ createdAt: ref.createdAt }, { id: { not: ref.id } }] },
        ],
      },
    });
    return { count: result.count };
  }

  return { create, update, findById, findManyForChat, countForChat, deleteAllAfter };
}

// The `as unknown as RepoMessage` cast lands at end-of-function (not at the
// projectDecrypted call) because Message has heterogeneous encrypted
// payloads: `content` is plain-string and shape-correct after decrypt, but
// `attachmentJson` / `citationsJson` are still serialised JSON strings at
// that point. Only after the JSON.parse loop converges does the runtime
// shape match RepoMessage. Character's repo casts at the projectDecrypted
// call because none of its encrypted fields are JSON payloads.
function shape(row: unknown, req: Request): RepoMessage {
  const projected = projectDecrypted(req, row as Record<string, unknown>, ENCRYPTED_FIELDS);
  for (const f of JSON_PAYLOAD_FIELDS) {
    const v = projected[f];
    if (typeof v === 'string' && v.length > 0) {
      projected[f] = JSON.parse(v);
    }
  }
  return projected as unknown as RepoMessage;
}
