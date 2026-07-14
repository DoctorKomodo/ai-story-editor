import type { PrismaClient } from '@prisma/client';
import type { Request } from 'express';
import type {
  Character,
  CharacterUpdateInput,
  CharacterCreateInput as SharedCharacterCreateInput,
} from 'story-editor-shared';
import { NARRATIVE_FIELD_KEYS } from 'story-editor-shared';
import { prisma as defaultPrisma } from '../lib/prisma';
import { ensureStoryOwned, projectDecrypted, resolveUserId, writeEncrypted } from './_narrative';

export class CharacterNotOwnedError extends Error {
  constructor() {
    super('character.repo: one or more characters not owned by caller');
    this.name = 'CharacterNotOwnedError';
  }
}

// Repo-layer shape: narrative fields are plaintext strings (decrypted by the
// repo), but timestamps are Date objects (Prisma's raw output). Distinct from
// the wire `Character` type (story-editor-shared), which has ISO string
// timestamps. serialize.ts converts between the two at the handler boundary.
export type RepoCharacter = Omit<Character, 'createdAt' | 'updatedAt'> & {
  createdAt: Date;
  updatedAt: Date;
};

// Keep the ENCRYPTED_FIELDS name as a local invariant — what gets encrypted
// today equals the narrative-field roster, but the two concepts could diverge
// if a non-encrypted narrative field is added in future.
const ENCRYPTED_FIELDS = NARRATIVE_FIELD_KEYS;

// The repo's create input extends the shared narrative-only type with the
// structural fields (storyId, orderIndex) that the route passes in separately.
export interface CharacterCreateInput extends SharedCharacterCreateInput {
  storyId: string;
  orderIndex: number;
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
    const userId = resolveUserId(req, 'character.repo');
    await ensureStoryOwned(client, input.storyId, userId, 'character.repo');
    const row = await client.character.create({
      data: {
        storyId: input.storyId,
        orderIndex: input.orderIndex,
        userId,
        color: input.color ?? null,
        initial: input.initial ?? null,
        // Post-[E11]: all narrative fields (name, role, age, appearance,
        // voice, arc, personality, backstory, relationships)
        // are ciphertext-only. Plaintext siblings were dropped.
        ...encryptedDataFrom(req, input),
      },
    });
    return projectDecrypted<RepoCharacter>(
      req,
      row as unknown as Record<string, unknown>,
      ENCRYPTED_FIELDS,
    );
  }

  async function findById(id: string) {
    const userId = resolveUserId(req, 'character.repo');
    const row = await client.character.findFirst({ where: { id, userId } });
    if (!row) return null;
    return projectDecrypted<RepoCharacter>(
      req,
      row as unknown as Record<string, unknown>,
      ENCRYPTED_FIELDS,
    );
  }

  async function findManyForStory(storyId: string) {
    const userId = resolveUserId(req, 'character.repo');
    await ensureStoryOwned(client, storyId, userId, 'character.repo');
    const rows = await client.character.findMany({
      where: { storyId, userId },
      orderBy: [{ orderIndex: 'asc' }, { createdAt: 'asc' }],
    });
    return rows.map((r) =>
      projectDecrypted<RepoCharacter>(
        req,
        r as unknown as Record<string, unknown>,
        ENCRYPTED_FIELDS,
      ),
    );
  }

  async function update(id: string, input: CharacterUpdateInput) {
    const userId = resolveUserId(req, 'character.repo');
    const data = encryptedDataFrom(req, input);
    if (input.color !== undefined) data.color = input.color;
    if (input.initial !== undefined) data.initial = input.initial;
    const updated = await client.character.updateMany({
      where: { id, userId },
      data,
    });
    if (updated.count === 0) return null;
    const row = await client.character.findFirst({
      where: { id, userId },
    });
    if (!row) return null;
    return projectDecrypted<RepoCharacter>(
      req,
      row as unknown as Record<string, unknown>,
      ENCRYPTED_FIELDS,
    );
  }

  async function remove(id: string) {
    const userId = resolveUserId(req, 'character.repo');
    return client.$transaction(async (tx) => {
      const target = await tx.character.findFirst({
        where: { id, userId },
        select: { id: true, storyId: true },
      });
      if (!target) return false;

      await tx.character.delete({ where: { id: target.id } });

      // Re-pack remaining characters into sequential orderIndex 0..N-1, ordered
      // by their existing (orderIndex, createdAt) — same key as findManyForStory.
      // Mirrors the [D16] two-phase swap (negative parking values dodge the
      // @@unique([storyId, orderIndex]) constraint mid-transaction).
      const remaining = await tx.character.findMany({
        where: { storyId: target.storyId },
        orderBy: [{ orderIndex: 'asc' }, { createdAt: 'asc' }],
        select: { id: true },
      });
      for (let i = 0; i < remaining.length; i++) {
        await tx.character.update({
          where: { id: remaining[i]!.id },
          data: { orderIndex: -(i + 1) },
        });
      }
      for (let i = 0; i < remaining.length; i++) {
        await tx.character.update({
          where: { id: remaining[i]!.id },
          data: { orderIndex: i },
        });
      }
      return true;
    });
  }

  async function reorder(
    storyId: string,
    items: Array<{ id: string; orderIndex: number }>,
  ): Promise<void> {
    const userId = resolveUserId(req, 'character.repo');
    const ids = items.map((i) => i.id);
    const found = await client.character.findMany({
      where: { id: { in: ids }, storyId, userId },
      select: { id: true },
    });
    if (found.length !== ids.length) {
      throw new CharacterNotOwnedError();
    }

    // [D16] Two-phase swap. Phase 1 parks every targeted row at a NEGATIVE
    // temp value (cannot collide with real data; orderIndex >= 0 is enforced
    // at the route layer). Phase 2 writes the final values; the unique
    // constraint sees each target slot vacated. Both phases inside one
    // interactive transaction so the intermediate negative state is never
    // visible to readers.
    await client.$transaction(async (tx) => {
      for (let i = 0; i < items.length; i++) {
        await tx.character.update({
          where: { id: items[i]!.id },
          data: { orderIndex: -(i + 1) },
        });
      }
      for (const item of items) {
        await tx.character.update({
          where: { id: item.id },
          data: { orderIndex: item.orderIndex },
        });
      }
    });
  }

  async function maxOrderIndex(storyId: string): Promise<number | null> {
    const userId = resolveUserId(req, 'character.repo');
    const agg = await client.character.aggregate({
      where: { storyId, userId },
      _max: { orderIndex: true },
    });
    return agg._max.orderIndex ?? null;
  }

  return { create, findById, findManyForStory, update, remove, reorder, maxOrderIndex };
}
