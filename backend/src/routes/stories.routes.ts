// [B1] GET /api/stories and POST /api/stories.
// [B2] GET / PATCH / DELETE /api/stories/:id (auth + ownership-scoped).
//
// GET / returns all of the caller's stories (decrypted by the repo) with a
// `chapterCount` and `totalWordCount` aggregate computed in one groupBy pass.
// POST validates with Zod and persists through the story repo.
//
// GET/PATCH/DELETE /:id all go through `requireOwnership('story', { idParam:
// 'id' })` so unknown and unowned ids collapse to the same 403 — no
// id-enumeration oracle. Schema-level cascade deletes the chapter/chat/etc.
// sub-tree on story delete; we don't walk that tree in app code.
//
// All routes require `requireAuth` — the repo layer derives userId from
// req.user.id and needs the request-scoped DEK attached by the middleware.

import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth.middleware';
import { requireOwnership } from '../middleware/ownership.middleware';
import { prisma } from '../lib/prisma';
import { createStoryRepo, type StoryUpdateInput } from '../repos/story.repo';

// ─── Request body schemas ─────────────────────────────────────────────────────

// Keep bounds conservative — narrative fields are free-text but very long
// inputs are almost certainly a mistake (or an abuse attempt). The chapter
// body has its own higher ceiling because that's where real prose lives;
// story-level metadata stays tight.
const CreateStoryBody = z.object({
  title: z.string().min(1).max(500),
  synopsis: z.string().max(10_000).nullable().optional(),
  genre: z.string().max(200).nullable().optional(),
  worldNotes: z.string().max(50_000).nullable().optional(),
  targetWords: z.number().int().positive().nullable().optional(),
  systemPrompt: z.string().max(10_000).nullable().optional(),
});

// PATCH body: every field is optional. Nullable-fields accept `null` to clear;
// `title` stays non-nullable (a story must always have a title). `.strict()`
// rejects unknown keys so stray fields can't silently slip through. The repo
// distinguishes `undefined` (leave alone) from `null` (clear), so we must NOT
// coerce missing keys to null before handing them off.
const UpdateStoryBody = z
  .object({
    title: z.string().min(1).max(500).optional(),
    synopsis: z.string().max(10_000).nullable().optional(),
    genre: z.string().max(200).nullable().optional(),
    worldNotes: z.string().max(50_000).nullable().optional(),
    targetWords: z.number().int().positive().nullable().optional(),
    systemPrompt: z.string().max(10_000).nullable().optional(),
  })
  .strict();

// ─── Router ──────────────────────────────────────────────────────────────────

export function createStoriesRouter() {
  const router = Router();
  router.use(requireAuth);

  // GET /api/stories — list the caller's stories with per-story aggregates.
  router.get('/', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId = req.user!.id;

      const stories = await createStoryRepo(req).findManyForUser();
      const ids = stories.map((s) => s.id as string);

      // Aggregate chapterCount + totalWordCount in one round-trip. Scope by
      // the story→user relation so a stray storyId can't pull in another
      // user's chapters (defence-in-depth on top of the `ids` filter).
      // `wordCount` is plaintext and not narrative content, so direct Prisma
      // access is fine here — this is not a narrative entity read path.
      const aggregates =
        ids.length === 0
          ? []
          : await prisma.chapter.groupBy({
              by: ['storyId'],
              where: { storyId: { in: ids }, story: { userId } },
              _count: { _all: true },
              _sum: { wordCount: true },
            });

      const byStoryId = new Map<string, { chapterCount: number; totalWordCount: number }>();
      for (const agg of aggregates) {
        byStoryId.set(agg.storyId, {
          chapterCount: agg._count._all,
          totalWordCount: agg._sum.wordCount ?? 0,
        });
      }

      const enriched = stories.map((s) => {
        const agg = byStoryId.get(s.id as string);
        return {
          ...s,
          chapterCount: agg?.chapterCount ?? 0,
          totalWordCount: agg?.totalWordCount ?? 0,
        };
      });

      res.status(200).json({ stories: enriched });
    } catch (err) {
      next(err);
    }
  });

  // POST /api/stories — create a new story for the caller.
  router.post('/', async (req: Request, res: Response, next: NextFunction) => {
    const parsed = CreateStoryBody.safeParse(req.body);
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
      const story = await createStoryRepo(req).create({
        title: body.title,
        synopsis: body.synopsis ?? null,
        genre: body.genre ?? null,
        worldNotes: body.worldNotes ?? null,
        targetWords: body.targetWords ?? null,
        systemPrompt: body.systemPrompt ?? null,
      });

      res.status(201).json({ story });
    } catch (err) {
      next(err);
    }
  });

  // ── /:id routes (B2) ────────────────────────────────────────────────────
  // Ownership middleware param defaults to `${type}Id` (storyId); our route
  // uses `:id`, so pass `idParam: 'id'`. Unknown/unowned → 403, same shape,
  // no id-enumeration oracle.

  const ownStory = requireOwnership('story', { idParam: 'id' });

  // GET /api/stories/:id — return the decrypted story.
  router.get('/:id', ownStory, async (req: Request, res: Response, next: NextFunction) => {
    // Express types `req.params[k]` as `string | string[]`; ownership
    // middleware already enforced it's a non-empty string.
    const id = req.params.id as string;
    try {
      const story = await createStoryRepo(req).findById(id);
      if (!story) {
        // Should be unreachable — ownership middleware already confirmed the
        // row exists for this user. Treat a null here as a race (concurrent
        // delete) and respond 404 so the client sees something sensible.
        res.status(404).json({ error: { message: 'Not found', code: 'not_found' } });
        return;
      }
      res.status(200).json({ story });
    } catch (err) {
      next(err);
    }
  });

  // PATCH /api/stories/:id — partial update; nullable fields accept `null`.
  router.patch('/:id', ownStory, async (req: Request, res: Response, next: NextFunction) => {
    const id = req.params.id as string;
    const parsed = UpdateStoryBody.safeParse(req.body);
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

    // Forward only the keys the caller actually supplied so we preserve the
    // `undefined` vs `null` contract that the repo relies on.
    const body = parsed.data;
    const input: StoryUpdateInput = {};
    if (body.title !== undefined) input.title = body.title;
    if (body.synopsis !== undefined) input.synopsis = body.synopsis;
    if (body.genre !== undefined) input.genre = body.genre;
    if (body.worldNotes !== undefined) input.worldNotes = body.worldNotes;
    if (body.targetWords !== undefined) input.targetWords = body.targetWords;
    if (body.systemPrompt !== undefined) input.systemPrompt = body.systemPrompt;

    try {
      const story = await createStoryRepo(req).update(id, input);
      if (!story) {
        // Race: ownership middleware confirmed ownership, then the row
        // disappeared before the update landed. Return 404 rather than
        // masking it as success.
        res.status(404).json({ error: { message: 'Not found', code: 'not_found' } });
        return;
      }
      res.status(200).json({ story });
    } catch (err) {
      next(err);
    }
  });

  // DELETE /api/stories/:id — hard delete; schema cascades to chapters/etc.
  router.delete('/:id', ownStory, async (req: Request, res: Response, next: NextFunction) => {
    const id = req.params.id as string;
    try {
      const ok = await createStoryRepo(req).remove(id);
      if (!ok) {
        res.status(404).json({ error: { message: 'Not found', code: 'not_found' } });
        return;
      }
      res.status(204).send();
    } catch (err) {
      next(err);
    }
  });

  return router;
}
