import type { Request } from 'express';
import type { PrismaClient } from '@prisma/client';
import { prisma as defaultPrisma } from '../lib/prisma';
import { projectDecrypted, writeCiphertextOnly } from './_narrative';

const ENCRYPTED_FIELDS = ['contentJson', 'attachmentJson'] as const;

export interface MessageCreateInput {
  chatId: string;
  role: string;
  contentJson: unknown;
  attachmentJson?: unknown;
  model?: string | null;
  tokens?: number | null;
  latencyMs?: number | null;
}

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
    const row = await client.message.create({
      data: {
        chatId: input.chatId,
        role: input.role,
        model: input.model ?? null,
        tokens: input.tokens ?? null,
        latencyMs: input.latencyMs ?? null,
        // Post-[E11]: JSON payloads live only in the ciphertext triples —
        // serialised + encrypted. Plaintext `contentJson` / `attachmentJson`
        // columns were dropped.
        ...writeCiphertextOnly(req, 'contentJson', serialiseJsonField(input.contentJson)),
        ...writeCiphertextOnly(req, 'attachmentJson', serialiseJsonField(input.attachmentJson)),
      },
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

  // No update / delete: Message is append-only (CLAUDE.md).

  return { create, findById, findManyForChat, countForChat };
}

function shape(row: unknown, req: Request) {
  const projected = projectDecrypted(req, row as Record<string, unknown>, ENCRYPTED_FIELDS);
  for (const f of ENCRYPTED_FIELDS) {
    const v = projected[f];
    if (typeof v === 'string' && v.length > 0) {
      try {
        projected[f] = JSON.parse(v);
      } catch {
        // Non-JSON plaintext after decryption — shouldn't happen post-[E11];
        // leave as string so callers can see something went wrong.
      }
    }
  }
  return projected;
}
