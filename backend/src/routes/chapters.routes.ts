// Router uses `mergeParams: true` so :storyId from the parent mount is
// visible on `req.params` inside handlers.

import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth.middleware';
import { requireOwnership } from '../middleware/ownership.middleware';
import { prisma } from '../lib/prisma';
import { createChapterRepo, type ChapterUpdateInput } from '../repos/chapter.repo';
import { tipTapJsonToText } from '../services/tiptap-text';

const ChapterStatus = z.enum(['draft', 'revision', 'final']);

const CreateChapterBody = z
  .object({
    title: z.string().min(1).max(500),
    bodyJson: z.unknown().optional(),
    status: ChapterStatus.optional(),
  })
  .strict();

const UpdateChapterBody = z
  .object({
    title: z.string().min(1).max(500).optional(),
    bodyJson: z.unknown().optional(),
    status: ChapterStatus.optional(),
    orderIndex: z.number().int().min(0).optional(),
  })
  .strict();

function computeWordCount(bodyJson: unknown): number {
  const text = tipTapJsonToText(bodyJson).trim();
  if (text.length === 0) return 0;
  return text.split(/\s+/).filter(Boolean).length;
}

export function createChaptersRouter() {
  const router = Router({ mergeParams: true });
  router.use(requireAuth);

  const ownStory = requireOwnership('story', { idParam: 'storyId' });
  const ownChapter = requireOwnership('chapter', { idParam: 'chapterId' });

  router.get('/', ownStory, async (req: Request, res: Response, next: NextFunction) => {
    const storyId = req.params.storyId as string;
    try {
      const chapters = await createChapterRepo(req).findManyForStory(storyId);
      res.status(200).json({ chapters });
    } catch (err) {
      next(err);
    }
  });

  router.post('/', ownStory, async (req: Request, res: Response, next: NextFunction) => {
    const storyId = req.params.storyId as string;

    const parsed = CreateChapterBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: {
          message: 'Invalid request',
          code: 'invalid_request',
          details: parsed.error.flatten(),
        },
      });
      return;
    }
    const body = parsed.data;

    try {
      // TODO(B4): aggregate+insert is not transactionally safe; concurrent POSTs
      // to the same story can produce duplicate orderIndex rows. Schema-level
      // @@unique([storyId, orderIndex]) is deferred until B4's reorder design
      // (requires migration + schema-change approval per CLAUDE.md).
      const userId = req.user!.id;
      const agg = await prisma.chapter.aggregate({
        where: { storyId, story: { userId } },
        _max: { orderIndex: true },
      });
      const nextOrderIndex =
        agg._max.orderIndex === null || agg._max.orderIndex === undefined
          ? 0
          : agg._max.orderIndex + 1;

      const wordCount = body.bodyJson === undefined ? 0 : computeWordCount(body.bodyJson);

      const chapter = await createChapterRepo(req).create({
        storyId,
        title: body.title,
        bodyJson: body.bodyJson,
        status: body.status,
        orderIndex: nextOrderIndex,
        wordCount,
      });

      res.status(201).json({ chapter });
    } catch (err) {
      next(err);
    }
  });

  // Ownership middleware confirms the caller owns the chapter but not that
  // the chapter lives under :storyId — each per-chapter handler 404s a
  // chapter.storyId/URL mismatch.
  router.get(
    '/:chapterId',
    ownStory,
    ownChapter,
    async (req: Request, res: Response, next: NextFunction) => {
      const storyId = req.params.storyId as string;
      const chapterId = req.params.chapterId as string;
      try {
        const chapter = await createChapterRepo(req).findById(chapterId);
        if (!chapter || chapter.storyId !== storyId) {
          res.status(404).json({ error: { message: 'Not found', code: 'not_found' } });
          return;
        }
        res.status(200).json({ chapter });
      } catch (err) {
        next(err);
      }
    },
  );

  router.patch(
    '/:chapterId',
    ownStory,
    ownChapter,
    async (req: Request, res: Response, next: NextFunction) => {
      const storyId = req.params.storyId as string;
      const chapterId = req.params.chapterId as string;

      const parsed = UpdateChapterBody.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({
          error: {
            message: 'Invalid request',
            code: 'invalid_request',
            details: parsed.error.flatten(),
          },
        });
        return;
      }
      const body = parsed.data;

      try {
        const existing = await createChapterRepo(req).findById(chapterId);
        if (!existing || existing.storyId !== storyId) {
          res.status(404).json({ error: { message: 'Not found', code: 'not_found' } });
          return;
        }

        const input: ChapterUpdateInput = {};
        if (body.title !== undefined) input.title = body.title;
        if (body.status !== undefined) input.status = body.status;
        if (body.orderIndex !== undefined) input.orderIndex = body.orderIndex;
        if (body.bodyJson !== undefined) {
          input.bodyJson = body.bodyJson;
          input.wordCount = computeWordCount(body.bodyJson);
        }

        const chapter = await createChapterRepo(req).update(chapterId, input);
        if (!chapter) {
          res.status(404).json({ error: { message: 'Not found', code: 'not_found' } });
          return;
        }
        res.status(200).json({ chapter });
      } catch (err) {
        next(err);
      }
    },
  );

  router.delete(
    '/:chapterId',
    ownStory,
    ownChapter,
    async (req: Request, res: Response, next: NextFunction) => {
      const storyId = req.params.storyId as string;
      const chapterId = req.params.chapterId as string;
      try {
        const existing = await createChapterRepo(req).findById(chapterId);
        if (!existing || existing.storyId !== storyId) {
          res.status(404).json({ error: { message: 'Not found', code: 'not_found' } });
          return;
        }
        const ok = await createChapterRepo(req).remove(chapterId);
        if (!ok) {
          res.status(404).json({ error: { message: 'Not found', code: 'not_found' } });
          return;
        }
        res.status(204).send();
      } catch (err) {
        next(err);
      }
    },
  );

  return router;
}
