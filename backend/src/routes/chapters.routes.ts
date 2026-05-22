// Router uses `mergeParams: true` so :storyId from the parent mount is
// visible on `req.params` inside handlers.

import { Prisma } from '@prisma/client';
import { type NextFunction, type Request, type Response, Router } from 'express';
import {
  chapterCreateSchema,
  chapterReorderSchema,
  chapterResponseSchema,
  chapterSummaryJsonSchema,
  chapterSummaryResponseSchema,
  chapterSummarySchema,
  chaptersResponseSchema,
  chapterUpdateSchema,
} from 'story-editor-shared';
import { z } from 'zod';
import { badRequest } from '../lib/bad-request';
import { prisma } from '../lib/prisma';
import { respond } from '../lib/respond';
import { serializeChapter, serializeChapterMeta } from '../lib/serialize';
import { getVeniceClient } from '../lib/venice';
import { mapVeniceError } from '../lib/venice-errors';
import { requireAuth } from '../middleware/auth.middleware';
import { requireOwnership } from '../middleware/ownership.middleware';
import { validateBody } from '../middleware/validate';
import {
  ChapterNotOwnedError,
  createChapterRepo,
  type RepoChapterUpdateInput,
} from '../repos/chapter.repo';
import { resolvePrompt } from '../services/prompt.service';
import { tipTapJsonToText } from '../services/tiptap-text';
import { resolveUserPrompts } from '../services/user-settings-resolvers';
import { veniceModelsService } from '../services/venice.models.service';

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

      try {
        await createChapterRepo(req).reorder(storyId, body.chapters);
        res.status(204).send();
      } catch (err) {
        if (err instanceof ChapterNotOwnedError) {
          res.status(403).json({ error: { message: 'Forbidden', code: 'forbidden' } });
          return;
        }
        throw err;
      }
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
        if (!chapter || chapter.storyId !== storyId) {
          res.status(404).json({ error: { message: 'Not found', code: 'not_found' } });
          return;
        }
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
      if (!existing || existing.storyId !== storyId) {
        res.status(404).json({ error: { message: 'Not found', code: 'not_found' } });
        return;
      }

      const input: RepoChapterUpdateInput = {};
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

  const SummariseBody = z.object({ modelId: z.string().min(1) });

  router.post(
    '/:chapterId/summarise',
    ownStory,
    ownChapter,
    validateBody(SummariseBody, async (body, req, res) => {
      const userId = req.user!.id;
      const chapterId = req.params.chapterId as string;
      const storyId = req.params.storyId as string;

      const chapter = await createChapterRepo(req).findById(chapterId);
      if (!chapter || chapter.storyId !== storyId) {
        res.status(404).json({ error: { message: 'Chapter not found', code: 'not_found' } });
        return;
      }

      const plaintext = tipTapJsonToText(chapter.bodyJson ?? null).trim();
      if (plaintext.length === 0 || chapter.wordCount === 0) {
        res
          .status(400)
          .json({ error: { message: 'Chapter has no body to summarise', code: 'empty_chapter' } });
        return;
      }

      try {
        await veniceModelsService.fetchModels(userId);
      } catch (err) {
        if (mapVeniceError(err, res, { userId, route: 'chapter-summarise' })) return;
        throw err;
      }

      const modelInfo = veniceModelsService.findModel(body.modelId);
      if (!modelInfo || modelInfo.supportsResponseSchema === false) {
        res.status(400).json({
          error: {
            message:
              "This model doesn't support structured output — switch to a schema-capable model.",
            code: 'model_unsupported_for_summarisation',
          },
        });
        return;
      }

      const userRow = await prisma.user.findUnique({
        where: { id: userId },
        select: { settingsJson: true },
      });
      const userPrompts = resolveUserPrompts(userRow?.settingsJson ?? null);

      const client = await getVeniceClient(userId);
      let raw: { choices?: Array<{ message?: { content?: string } }> };
      try {
        const completion = await client.chat.completions.create({
          model: body.modelId,
          messages: [
            { role: 'system', content: resolvePrompt(userPrompts, 'summariseChapter') },
            { role: 'user', content: plaintext },
          ],
          response_format: {
            type: 'json_schema',
            json_schema: {
              name: 'ChapterSummary',
              schema: chapterSummaryJsonSchema(),
              strict: true,
            },
          },
          // SDK 6.36 types response_format natively for non-streaming completions;
          // venice_parameters and other extra fields still need the cast below.
        } as unknown as Parameters<typeof client.chat.completions.create>[0]);
        raw = completion as unknown as typeof raw;
      } catch (err) {
        if (mapVeniceError(err, res, { userId, route: 'chapter-summarise' })) return;
        throw err;
      }

      const content = raw.choices?.[0]?.message?.content ?? '';
      let parsed: ReturnType<typeof chapterSummarySchema.parse>;
      try {
        parsed = chapterSummarySchema.parse(JSON.parse(content));
      } catch {
        res.status(502).json({
          error: {
            message: 'Venice returned a malformed summary.',
            code: 'summary_parse_failed',
          },
        });
        return;
      }

      const updated = await createChapterRepo(req).update(chapterId, { summaryJson: parsed });
      if (!updated) {
        res.status(404).json({ error: { message: 'Chapter not found', code: 'not_found' } });
        return;
      }
      respond(chapterSummaryResponseSchema, res, {
        summary: updated.summary!,
        summaryUpdatedAt: updated.summaryUpdatedAt?.toISOString() ?? null,
      });
    }),
  );

  return router;
}
