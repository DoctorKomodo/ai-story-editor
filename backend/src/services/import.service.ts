import type { PrismaClient } from '@prisma/client';
import type { Request } from 'express';
import type {
  ImportFile,
  ImportPlanRequest,
  ImportPlanResponse,
  ImportResult,
} from 'story-editor-shared';
import { prisma } from '../lib/prisma';
import { createChapterRepo } from '../repos/chapter.repo';
import { createCharacterRepo } from '../repos/character.repo';
import { createChatRepo } from '../repos/chat.repo';
import { createMessageRepo } from '../repos/message.repo';
import { createOutlineRepo } from '../repos/outline.repo';
import { createStoryRepo } from '../repos/story.repo';
import { computeWordCount } from './tiptap-text';

/**
 * Preflight: bucket each file-story id against the caller's live stories
 * without mutating anything. `findById` is owner-scoped and returns `null`
 * for both an unknown id and one owned by another user — so a story that
 * isn't live-and-owned always reports `new`, never leaking its existence.
 */
export async function planImport(
  req: Request,
  plan: ImportPlanRequest,
): Promise<ImportPlanResponse> {
  const storyRepo = createStoryRepo(req);
  const stories = await Promise.all(
    plan.stories.map(async ({ id, snapshotUpdatedAt }) => {
      const live = await storyRepo.findById(id);
      if (!live) return { id, status: 'new' as const };
      const liveMax = await storyRepo.contentUpdatedAtMax(id);
      const status: ImportPlanResponse['stories'][number]['status'] =
        liveMax.getTime() <= new Date(snapshotUpdatedAt).getTime() ? 'unchanged' : 'conflict';
      return { id, status };
    }),
  );
  return { stories };
}

export async function runImport(req: Request, file: ImportFile): Promise<ImportResult> {
  const userId = req.user!.id;
  const counts = { stories: 0, chapters: 0, characters: 0, outlineItems: 0, chats: 0, messages: 0 };

  await prisma.$transaction(
    async (tx) => {
      // Structural wipe (no narrative columns); cascade removes the whole subtree.
      await tx.story.deleteMany({ where: { userId } });

      // The repo create() methods do not open their own $transaction, so the tx
      // client substitutes for PrismaClient at runtime. Messages use createWithin()
      // because their create() does self-transact and cannot nest. One cast:
      const txc = tx as unknown as PrismaClient;
      const storyRepo = createStoryRepo(req, txc);
      const chapterRepo = createChapterRepo(req, txc);
      const characterRepo = createCharacterRepo(req, txc);
      const outlineRepo = createOutlineRepo(req, txc);
      const chatRepo = createChatRepo(req, txc);
      // No txc: messages go through createWithin(tx, …), which takes the tx client
      // explicitly (create() self-transacts and must not be used inside the outer tx).
      const messageRepo = createMessageRepo(req);

      for (const s of file.stories) {
        const story = await storyRepo.create({
          title: s.title,
          synopsis: s.synopsis ?? null,
          genre: s.genre ?? null,
          worldNotes: s.worldNotes ?? null,
          targetWords: s.targetWords ?? null,
        });
        counts.stories++;

        // storyRepo.create() does not write includePreviousChaptersInPrompt — the
        // column has @default(true) and create() ignores the field. Set it via
        // update() so the flag round-trips faithfully (a false would re-import as true).
        if (typeof s.includePreviousChaptersInPrompt === 'boolean') {
          await storyRepo.update(story.id, {
            includePreviousChaptersInPrompt: s.includePreviousChaptersInPrompt,
          });
        }

        const chapters = [...s.chapters].sort((a, b) => a.orderIndex - b.orderIndex);
        for (let i = 0; i < chapters.length; i++) {
          const ch = chapters[i]!;
          const created = await chapterRepo.create({
            storyId: story.id,
            title: ch.title,
            bodyJson: ch.bodyJson,
            status: ch.status,
            orderIndex: i,
            wordCount: computeWordCount(ch.bodyJson),
          });
          counts.chapters++;

          if (ch.summary) {
            await chapterRepo.update(created.id, { summaryJson: ch.summary });
          }

          for (const c of ch.chats) {
            const chat = await chatRepo.create({
              chapterId: created.id,
              title: c.title ?? null,
              kind: c.kind,
            });
            counts.chats++;

            for (const m of c.messages) {
              await messageRepo.createWithin(tx, {
                chatId: chat.id,
                role: m.role,
                content: m.content,
                attachmentJson: m.attachmentJson,
                citationsJson: m.citationsJson,
                model: m.model,
                tokens: m.tokens,
                latencyMs: m.latencyMs,
              });
              counts.messages++;
            }
          }
        }

        const chars = [...s.characters].sort((a, b) => a.orderIndex - b.orderIndex);
        for (let i = 0; i < chars.length; i++) {
          const c = chars[i]!;
          await characterRepo.create({
            storyId: story.id,
            orderIndex: i,
            name: c.name,
            role: c.role,
            age: c.age,
            appearance: c.appearance,
            personality: c.personality,
            voice: c.voice,
            backstory: c.backstory,
            arc: c.arc,
            relationships: c.relationships,
            color: c.color,
            initial: c.initial,
          });
          counts.characters++;
        }

        const items = [...s.outlineItems].sort((a, b) => a.order - b.order);
        for (let i = 0; i < items.length; i++) {
          const it = items[i]!;
          await outlineRepo.create({
            storyId: story.id,
            order: i,
            title: it.title,
            sub: it.sub ?? null,
            status: it.status,
          });
          counts.outlineItems++;
        }
      }
    },
    { maxWait: 5_000, timeout: 120_000 },
  );

  return { imported: counts };
}
