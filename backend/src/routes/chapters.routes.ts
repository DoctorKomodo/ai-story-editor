// [B3] Chapter CRUD under /api/stories/:storyId/chapters.
//
// Mounted with `Router({ mergeParams: true })` so `req.params.storyId` is
// visible inside handlers. Ownership of the parent story is checked by
// `requireOwnership('story', { idParam: 'storyId' })` on every route; the
// per-chapter routes additionally chain `requireOwnership('chapter', { idParam:
// 'chapterId' })`. The chapter-ownership middleware confirms the chapter is
// owned by the caller via story → userId, but it does NOT verify the chapter's
// storyId matches the URL's :storyId — so each per-chapter handler does a
// defence-in-depth `chapter.storyId === req.params.storyId` check and returns
// 404 if the URL path is incoherent.
//
// `wordCount` is server-derived only. On POST/PATCH we count words from the
// TipTap JSON tree via tipTapJsonToText — the client never sends wordCount
// (strict Zod rejects the key). `orderIndex` on POST is auto-assigned as
// `max(existing.orderIndex) + 1` (or 0 for the first chapter). POST strips
// `orderIndex` via `.strict()`; clients use PATCH (or the upcoming B4 reorder
// endpoint) to change ordering.

import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth.middleware';
import { requireOwnership } from '../middleware/ownership.middleware';
import { prisma } from '../lib/prisma';
import { createChapterRepo, type ChapterUpdateInput } from '../repos/chapter.repo';
import { tipTapJsonToText } from '../services/tiptap-text';

// ─── Request body schemas ─────────────────────────────────────────────────────

// `status` is constrained to the same three values the UI surfaces (draft /
// revision / final). The repo column is a free-form string at the DB level,
// but the Zod layer is the contract the route offers.
const ChapterStatus = z.enum(['draft', 'revision', 'final']);

// POST: strict (no unknown keys). Client cannot send `wordCount` (server-derived)
// or `orderIndex` (auto-assigned). `bodyJson` is an arbitrary JSON tree —
// validating its full TipTap structure in Zod would duplicate TipTap's own
// schema and is load-bearing for neither security nor persistence (the repo
// JSON.stringify()s it, the decrypt path parses it). We use `z.unknown()`.
const CreateChapterBody = z
  .object({
    title: z.string().min(1).max(500),
    bodyJson: z.unknown().optional(),
    status: ChapterStatus.optional(),
  })
  .strict();

// PATCH: strict; every field optional. `orderIndex` is accepted here so a
// client can nudge a single chapter's position; batch reorder is B4.
const UpdateChapterBody = z
  .object({
    title: z.string().min(1).max(500).optional(),
    bodyJson: z.unknown().optional(),
    status: ChapterStatus.optional(),
    orderIndex: z.number().int().min(0).optional(),
  })
  .strict();

// ─── wordCount helper ────────────────────────────────────────────────────────

function computeWordCount(bodyJson: unknown): number {
  const text = tipTapJsonToText(bodyJson).trim();
  if (text.length === 0) return 0;
  return text.split(/\s+/).filter(Boolean).length;
}

// ─── Router ──────────────────────────────────────────────────────────────────

export function createChaptersRouter() {
  // mergeParams exposes :storyId from the parent mount point.
  const router = Router({ mergeParams: true });
  router.use(requireAuth);

  const ownStory = requireOwnership('story', { idParam: 'storyId' });
  const ownChapter = requireOwnership('chapter', { idParam: 'chapterId' });

  // ── GET /api/stories/:storyId/chapters ─────────────────────────────────
  router.get('/', ownStory, async (req: Request, res: Response, next: NextFunction) => {
    const storyId = req.params.storyId as string;
    try {
      const chapters = await createChapterRepo(req).findManyForStory(storyId);
      res.status(200).json({ chapters });
    } catch (err) {
      next(err);
    }
  });

  // ── POST /api/stories/:storyId/chapters ────────────────────────────────
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
      // Next orderIndex: max(existing) + 1, or 0 for the first chapter.
      // Plaintext aggregation on a non-narrative column — same pattern as
      // stories.routes.ts uses for chapterCount / totalWordCount. Scope by
      // story→userId for defence-in-depth on top of ownership middleware.
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

  // ── Per-chapter routes ─────────────────────────────────────────────────
  // Chain ownStory + ownChapter; each checks ownership via story→userId, but
  // neither validates that the chapter actually lives inside :storyId. The
  // handler does the path-integrity check and 404s a mismatch.

  // GET /api/stories/:storyId/chapters/:chapterId
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

  // PATCH /api/stories/:storyId/chapters/:chapterId
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

      // Path-integrity check before doing any write work: if this chapter
      // isn't under :storyId, 404. The ownership middlewares already ran so
      // we know the caller owns both; we still need a fresh read to confirm
      // the chapter→story link matches the URL.
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
          // Race: ownership + path-integrity passed, then the row vanished
          // before the update landed. 404 beats masking as success.
          res.status(404).json({ error: { message: 'Not found', code: 'not_found' } });
          return;
        }
        res.status(200).json({ chapter });
      } catch (err) {
        next(err);
      }
    },
  );

  // DELETE /api/stories/:storyId/chapters/:chapterId
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
