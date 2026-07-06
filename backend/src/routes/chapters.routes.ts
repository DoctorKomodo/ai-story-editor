// Router uses `mergeParams: true` so :storyId from the parent mount is
// visible on `req.params` inside handlers.

import { Prisma } from '@prisma/client';
import { type NextFunction, type Request, type Response, Router } from 'express';
import {
  chapterCreateSchema,
  chapterReorderSchema,
  chapterResponseSchema,
  chaptersResponseSchema,
  chapterUpdateSchema,
} from 'story-editor-shared';
import { badRequest } from '../lib/bad-request';
import { notFound } from '../lib/http-errors';
import { respond } from '../lib/respond';
import { serializeChapter, serializeChapterMeta } from '../lib/serialize';
import { requireAuth } from '../middleware/auth.middleware';
import { requireOwnership } from '../middleware/ownership.middleware';
import { validateBody } from '../middleware/validate';
import { createChapterRepo, type RepoChapterUpdateInput } from '../repos/chapter.repo';
import { computeWordCount } from '../services/tiptap-text';

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

export function createChaptersRouter() {
  const router = Router({ mergeParams: true });
  router.use(requireAuth);

  const ownStory = requireOwnership('story', { idParam: 'storyId' });
  const ownChapter = requireOwnership('chapter', { idParam: 'chapterId' });

  router.get('/', ownStory, async (req: Request, res: Response, next: NextFunction) => {
    const storyId = req.params.storyId as string;
    try {
      const rows = await createChapterRepo(req).findManyForStory(storyId);
      respond(chaptersResponseSchema, res, { chapters: rows.map(serializeChapterMeta) });
    } catch (err) {
      next(err);
    }
  });

  router.post(
    '/',
    ownStory,
    validateBody(chapterCreateSchema, async (body, req, res) => {
      const storyId = req.params.storyId as string;

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

      respond(chapterResponseSchema, res, { chapter: serializeChapter(created) }, 201);
    }),
  );

  // [B4] PATCH /reorder — declared BEFORE /:chapterId so Express doesn't
  // match the literal "reorder" path segment against the :chapterId param.
  router.patch(
    '/reorder',
    ownStory,
    validateBody(chapterReorderSchema, async (body, req, res) => {
      const storyId = req.params.storyId as string;

      // Uniqueness checks the Zod schema can't express cleanly — these are
      // semantic validation (duplicate id / duplicate orderIndex) rather than
      // schema-shape issues, but still return the contract's `validation_error`
      // code so clients can handle all 400s uniformly. The human-readable
      // message disambiguates the specific failure.
      const seenIds = new Set<string>();
      const seenOrders = new Set<number>();
      for (const [i, item] of body.chapters.entries()) {
        if (seenIds.has(item.id)) {
          return badRequest(res, `Duplicate chapter id "${item.id}"`, ['chapters', i, 'id']);
        }
        if (seenOrders.has(item.orderIndex)) {
          return badRequest(res, `Duplicate orderIndex ${item.orderIndex}`, [
            'chapters',
            i,
            'orderIndex',
          ]);
        }
        seenIds.add(item.id);
        seenOrders.add(item.orderIndex);
      }

      await createChapterRepo(req).reorder(storyId, body.chapters);
      res.status(204).send();
    }),
  );

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
        if (!chapter || chapter.storyId !== storyId) throw notFound();
        respond(chapterResponseSchema, res, { chapter: serializeChapter(chapter) });
      } catch (err) {
        next(err);
      }
    },
  );

  router.patch(
    '/:chapterId',
    ownStory,
    ownChapter,
    validateBody(chapterUpdateSchema, async (body, req, res) => {
      const storyId = req.params.storyId as string;
      const chapterId = req.params.chapterId as string;

      const existing = await createChapterRepo(req).findById(chapterId);
      if (!existing || existing.storyId !== storyId) throw notFound();

      const input: RepoChapterUpdateInput = {};
      if (body.title !== undefined) input.title = body.title;
      if (body.orderIndex !== undefined) input.orderIndex = body.orderIndex;

      const chapter = await createChapterRepo(req).update(chapterId, input);
      if (!chapter) throw notFound();
      respond(chapterResponseSchema, res, { chapter: serializeChapter(chapter) });
    }),
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
        if (!existing || existing.storyId !== storyId) throw notFound();
        const ok = await createChapterRepo(req).remove(chapterId);
        if (!ok) throw notFound();
        res.status(204).send();
      } catch (err) {
        next(err);
      }
    },
  );

  return router;
}
