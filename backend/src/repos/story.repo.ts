import type { PrismaClient } from '@prisma/client';
import type { Request } from 'express';
import type { Story, StoryCreateInput, StoryUpdateInput } from 'story-editor-shared';
import { STORY_ENCRYPTED_FIELD_KEYS } from 'story-editor-shared';
import { prisma as defaultPrisma } from '../lib/prisma';
import { projectDecrypted, resolveUserId, writeEncrypted } from './_narrative';

// Keep the local ENCRYPTED_FIELDS name as the repo-local invariant (same as
// character.repo.ts) — sourced from the shared tuple.
const ENCRYPTED_FIELDS = STORY_ENCRYPTED_FIELD_KEYS;

// Repo-layer shape: narrative fields are plaintext strings (decrypted by the
// repo), timestamps are Date objects (Prisma's raw output). Distinct from the
// wire `Story` type (story-editor-shared), which has ISO string timestamps.
// serialize.ts converts between the two at the handler boundary.
export type RepoStory = Omit<Story, 'createdAt' | 'updatedAt'> & {
  createdAt: Date;
  updatedAt: Date;
};

export function createStoryRepo(req: Request, client: PrismaClient = defaultPrisma) {
  // `opts.id` is repo-internal (not on any wire schema): the import-replace
  // path reuses the id of the owned story it just deleted in the same
  // transaction, so a replaced story keeps its identity — open editors, URLs,
  // and history stay valid ([story-editor-f1t]; the e2i no-dead-end
  // guarantee). Callers must never pass a client-supplied id.
  async function create(input: StoryCreateInput, opts?: { id?: string }) {
    const userId = resolveUserId(req, 'story.repo');
    const encCols = {
      ...writeEncrypted(req, 'title', input.title),
      ...writeEncrypted(req, 'synopsis', input.synopsis ?? null),
      ...writeEncrypted(req, 'worldNotes', input.worldNotes ?? null),
    };
    const row = await client.story.create({
      data: {
        ...(opts?.id ? { id: opts.id } : {}),
        userId,
        genre: input.genre ?? null,
        targetWords: input.targetWords ?? null,
        // Post-[E11]: only the ciphertext triple persists. `title`,
        // `synopsis`, `worldNotes` are encrypted-only.
        // `genre`, `targetWords`, `userId`, timestamps remain plaintext.
        ...encCols,
      },
    });
    return projectDecrypted<RepoStory>(
      req,
      row as unknown as Record<string, unknown>,
      ENCRYPTED_FIELDS,
    );
  }

  async function findById(id: string) {
    const userId = resolveUserId(req, 'story.repo');
    const row = await client.story.findFirst({ where: { id, userId } });
    if (!row) return null;
    return projectDecrypted<RepoStory>(
      req,
      row as unknown as Record<string, unknown>,
      ENCRYPTED_FIELDS,
    );
  }

  async function findManyForUser() {
    const userId = resolveUserId(req, 'story.repo');
    const rows = await client.story.findMany({
      where: { userId },
      orderBy: { updatedAt: 'desc' },
    });
    return rows.map((r) =>
      projectDecrypted<RepoStory>(req, r as unknown as Record<string, unknown>, ENCRYPTED_FIELDS),
    );
  }

  async function update(id: string, input: StoryUpdateInput) {
    const userId = resolveUserId(req, 'story.repo');
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
    if (input.genre !== undefined) data.genre = input.genre;
    if (input.targetWords !== undefined) data.targetWords = input.targetWords;
    if (input.includePreviousChaptersInPrompt !== undefined) {
      data.includePreviousChaptersInPrompt = input.includePreviousChaptersInPrompt;
    }

    const updated = await client.story.updateMany({
      where: { id, userId },
      data,
    });
    if (updated.count === 0) return null;
    const row = await client.story.findFirst({ where: { id, userId } });
    if (!row) return null;
    return projectDecrypted<RepoStory>(
      req,
      row as unknown as Record<string, unknown>,
      ENCRYPTED_FIELDS,
    );
  }

  async function remove(id: string) {
    const userId = resolveUserId(req, 'story.repo');
    const deleted = await client.story.deleteMany({ where: { id, userId } });
    return deleted.count > 0;
  }

  // Max `updatedAt` across the story row and its entire subtree (chapters,
  // drafts, characters, outline items, chats, messages) — "the last time
  // anything in this story changed." Timestamps only, no narrative column is read or
  // decrypted. Messages use `createdAt` (append time) plus `updatedAt` when
  // the edit path has set it (null = never edited).
  async function contentUpdatedAtMax(storyId: string): Promise<Date> {
    const userId = resolveUserId(req, 'story.repo');
    const story = await client.story.findFirst({ where: { id: storyId, userId } });
    if (!story) throw new Error('story.repo: story not owned by caller');

    const [chapterMax, draftMax, characterMax, outlineMax, chatMax, messageMax] = await Promise.all(
      [
        client.chapter.aggregate({
          where: { storyId, story: { userId } },
          _max: { updatedAt: true },
        }),
        // [story-editor-wkw] Body/summary edits land on Draft.updatedAt only —
        // without this candidate a draft-only edit leaves the max unmoved and
        // import/plan under-reports a conflict as "unchanged".
        client.draft.aggregate({
          where: { chapter: { storyId, story: { userId } } },
          _max: { updatedAt: true },
        }),
        client.character.aggregate({
          where: { storyId, story: { userId } },
          _max: { updatedAt: true },
        }),
        client.outlineItem.aggregate({
          where: { storyId, story: { userId } },
          _max: { updatedAt: true },
        }),
        client.chat.aggregate({
          where: { draft: { chapter: { storyId, story: { userId } } } },
          _max: { updatedAt: true },
        }),
        client.message.aggregate({
          where: { chat: { draft: { chapter: { storyId, story: { userId } } } } },
          _max: { createdAt: true, updatedAt: true },
        }),
      ],
    );

    const candidates = [
      story.updatedAt,
      chapterMax._max.updatedAt,
      draftMax._max.updatedAt,
      characterMax._max.updatedAt,
      outlineMax._max.updatedAt,
      chatMax._max.updatedAt,
      messageMax._max.createdAt,
      messageMax._max.updatedAt,
    ].filter((d): d is Date => d != null);

    return candidates.reduce((max, d) => (d > max ? d : max));
  }

  return { create, findById, findManyForUser, update, remove, contentUpdatedAtMax };
}
