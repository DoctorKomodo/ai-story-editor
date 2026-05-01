import type { PrismaClient } from '@prisma/client';
import type { Request } from 'express';
import { prisma as defaultPrisma } from '../lib/prisma';
import { projectDecrypted, writeEncrypted } from './_narrative';

const ENCRYPTED_FIELDS = [
  'name',
  'role',
  'age',
  'appearance',
  'voice',
  'arc',
  'physicalDescription',
  'personality',
  'backstory',
  'notes',
] as const;

export interface CharacterCreateInput {
  storyId: string;
  name: string;
  orderIndex: number;
  role?: string | null;
  age?: string | null;
  appearance?: string | null;
  voice?: string | null;
  arc?: string | null;
  color?: string | null;
  initial?: string | null;
  physicalDescription?: string | null;
  personality?: string | null;
  backstory?: string | null;
  notes?: string | null;
}

export type CharacterUpdateInput = Partial<Omit<CharacterCreateInput, 'storyId'>>;

function resolveUserId(req: Request): string {
  const id = req.user?.id;
  if (!id) throw new Error('character.repo: req.user.id is not set');
  return id;
}

async function ensureStoryOwned(
  client: PrismaClient,
  storyId: string,
  userId: string,
): Promise<void> {
  const ok = await client.story.findFirst({ where: { id: storyId, userId } });
  if (!ok) throw new Error('character.repo: story not owned by caller');
}

function encryptedDataFrom(req: Request, input: CharacterCreateInput | CharacterUpdateInput) {
  const data: Record<string, unknown> = {};
  for (const f of ENCRYPTED_FIELDS) {
    const v = (input as Record<string, unknown>)[f];
    if (v === undefined) continue;
    Object.assign(data, writeEncrypted(req, f, v as string | null));
  }
  return data;
}

export function createCharacterRepo(req: Request, client: PrismaClient = defaultPrisma) {
  async function create(input: CharacterCreateInput) {
    const userId = resolveUserId(req);
    await ensureStoryOwned(client, input.storyId, userId);
    const row = await client.character.create({
      data: {
        storyId: input.storyId,
        orderIndex: input.orderIndex,
        color: input.color ?? null,
        initial: input.initial ?? null,
        // Post-[E11]: all narrative fields (name, role, age, appearance,
        // voice, arc, physicalDescription, personality, backstory, notes)
        // are ciphertext-only. Plaintext siblings were dropped.
        ...encryptedDataFrom(req, input),
      },
    });
    return projectDecrypted(req, row as unknown as Record<string, unknown>, ENCRYPTED_FIELDS);
  }

  async function findById(id: string) {
    const userId = resolveUserId(req);
    const row = await client.character.findFirst({ where: { id, story: { userId } } });
    if (!row) return null;
    return projectDecrypted(req, row as unknown as Record<string, unknown>, ENCRYPTED_FIELDS);
  }

  async function findManyForStory(storyId: string) {
    const userId = resolveUserId(req);
    await ensureStoryOwned(client, storyId, userId);
    const rows = await client.character.findMany({
      where: { storyId, story: { userId } },
      orderBy: [{ orderIndex: 'asc' }, { createdAt: 'asc' }],
    });
    return rows.map((r) =>
      projectDecrypted(req, r as unknown as Record<string, unknown>, ENCRYPTED_FIELDS),
    );
  }

  async function update(id: string, input: CharacterUpdateInput) {
    const userId = resolveUserId(req);
    const data = encryptedDataFrom(req, input);
    if (input.color !== undefined) data.color = input.color;
    if (input.initial !== undefined) data.initial = input.initial;
    const updated = await client.character.updateMany({
      where: { id, story: { userId } },
      data,
    });
    if (updated.count === 0) return null;
    const row = await client.character.findFirst({
      where: { id, story: { userId } },
    });
    if (!row) return null;
    return projectDecrypted(req, row as unknown as Record<string, unknown>, ENCRYPTED_FIELDS);
  }

  async function remove(id: string) {
    const userId = resolveUserId(req);
    const deleted = await client.character.deleteMany({ where: { id, story: { userId } } });
    return deleted.count > 0;
  }

  async function maxOrderIndex(storyId: string): Promise<number | null> {
    const userId = resolveUserId(req);
    const agg = await client.character.aggregate({
      where: { storyId, story: { userId } },
      _max: { orderIndex: true },
    });
    return agg._max.orderIndex ?? null;
  }

  return { create, findById, findManyForStory, update, remove, maxOrderIndex };
}
