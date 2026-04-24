// Router uses `mergeParams: true` so :storyId from the parent mount is
// visible on `req.params` inside handlers.

import { Prisma } from '@prisma/client';
import { type NextFunction, type Request, type Response, Router } from 'express';
import { z } from 'zod';
import { badRequestFromZod } from '../lib/bad-request';
import { requireAuth } from '../middleware/auth.middleware';
import { requireOwnership } from '../middleware/ownership.middleware';
import {
  ChapterNotOwnedError,
  type ChapterUpdateInput,
  createChapterRepo,
} from '../repos/chapter.repo';
import { tipTapJsonToText } from '../services/tiptap-text';

// [D16] Number of attempts to auto-assign `orderIndex` under concurrent POSTs.
// After the @@unique([storyId, orderIndex]) constraint landed, two simultaneous
// POSTs computing the same `_max + 1` will race: the first insert wins, the
// second raises Prisma P2002. Re-running the aggregate picks up the winner's
// row, so one retry is almost always enough. 3 gives headroom for 3-way races
// without letting a bug spin forever.
const POST_ORDER_RETRY_ATTEMPTS = 3;

function isPrismaUniqueViolation(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002';
}

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

const ReorderChaptersBody = z
  .object({
    chapters: z
      .array(
        z
          .object({
            id: z.string().min(1),
            orderIndex: z.number().int().min(0),
          })
          .strict(),
      )
      .min(1)
      .max(500),
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
      badRequestFromZod(res, parsed.error);
      return;
    }
    const body = parsed.data;

    try {
      // [D16] aggregate(_max)+insert is racy: two concurrent POSTs can compute
      // the same `nextOrderIndex`. @@unique([storyId, orderIndex]) guarantees
      // the DB rejects the loser with P2002; we re-aggregate and retry. One
      // retry is almost always sufficient (the winner's row now shows up in
      // `_max`); `POST_ORDER_RETRY_ATTEMPTS` bounds the loop.
      const wordCount = body.bodyJson === undefined ? 0 : computeWordCount(body.bodyJson);
      const chapterRepo = createChapterRepo(req);

      let lastErr: unknown;
      let created: Awaited<ReturnType<ReturnType<typeof createChapterRepo>['create']>> | null =
        null;
      for (let attempt = 0; attempt < POST_ORDER_RETRY_ATTEMPTS; attempt++) {
        const currentMax = await chapterRepo.maxOrderIndex(storyId);
        const nextOrderIndex = currentMax === null ? 0 : currentMax + 1;

        try {
          created = await chapterRepo.create({
            storyId,
            title: body.title,
            bodyJson: body.bodyJson,
            status: body.status,
            orderIndex: nextOrderIndex,
            wordCount,
          });
          break;
        } catch (err) {
          if (!isPrismaUniqueViolation(err)) throw err;
          lastErr = err;
          // loop — re-aggregate picks up the winning row.
        }
      }

      if (created === null) {
        throw lastErr ?? new Error('chapters POST: failed to allocate orderIndex');
      }

      res.status(201).json({ chapter: created });
    } catch (err) {
      next(err);
    }
  });

  // [B4] PATCH /reorder — declared BEFORE /:chapterId so Express doesn't
  // match the literal "reorder" path segment against the :chapterId param.
  router.patch('/reorder', ownStory, async (req: Request, res: Response, next: NextFunction) => {
    const storyId = req.params.storyId as string;

    const parsed = ReorderChaptersBody.safeParse(req.body);
    if (!parsed.success) {
      badRequestFromZod(res, parsed.error);
      return;
    }
    const items = parsed.data.chapters;

    // Uniqueness checks the Zod schema can't express cleanly — these are
    // semantic validation (duplicate id / duplicate orderIndex) rather than
    // schema-shape issues, but still return the contract's `validation_error`
    // code so clients can handle all 400s uniformly. The human-readable
    // message disambiguates the specific failure.
    const seenIds = new Set<string>();
    const seenOrders = new Set<number>();
    for (const item of items) {
      if (seenIds.has(item.id)) {
        res.status(400).json({
          error: { message: 'Duplicate chapter id in payload', code: 'validation_error' },
        });
        return;
      }
      seenIds.add(item.id);
      if (seenOrders.has(item.orderIndex)) {
        res.status(400).json({
          error: {
            message: 'Duplicate orderIndex in payload',
            code: 'validation_error',
          },
        });
        return;
      }
      seenOrders.add(item.orderIndex);
    }

    try {
      await createChapterRepo(req).reorder(storyId, items);
      res.status(204).send();
    } catch (err) {
      if (err instanceof ChapterNotOwnedError) {
        res.status(403).json({ error: { message: 'Forbidden', code: 'forbidden' } });
        return;
      }
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
        badRequestFromZod(res, parsed.error);
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
