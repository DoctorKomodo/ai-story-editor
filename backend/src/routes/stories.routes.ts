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

import { type NextFunction, type Request, type Response, Router } from 'express';
import {
  type StoryUpdateInput,
  storiesResponseSchema,
  storyCreateSchema,
  storyResponseSchema,
  storyUpdateSchema,
} from 'story-editor-shared';
import { respond } from '../lib/respond';
import { serializeStory } from '../lib/serialize';
import { requireAuth } from '../middleware/auth.middleware';
import { requireOwnership } from '../middleware/ownership.middleware';
import { validateBody } from '../middleware/validate';
import { createChapterRepo } from '../repos/chapter.repo';
import { createStoryRepo } from '../repos/story.repo';

// ─── Router ──────────────────────────────────────────────────────────────────

export function createStoriesRouter() {
  const router = Router();
  router.use(requireAuth);

  // GET /api/stories — list the caller's stories with per-story aggregates.
  router.get('/', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const stories = await createStoryRepo(req).findManyForUser();
      const ids = stories.map((s) => s.id);

      const byStoryId = await createChapterRepo(req).aggregateForStories(ids);

      const enriched = stories.map((s) => {
        const agg = byStoryId.get(s.id);
        return {
          ...serializeStory(s),
          chapterCount: agg?.chapterCount ?? 0,
          totalWordCount: agg?.totalWordCount ?? 0,
        };
      });

      respond(storiesResponseSchema, res, { stories: enriched });
    } catch (err) {
      next(err);
    }
  });

  // POST /api/stories — create a new story for the caller.
  router.post(
    '/',
    validateBody(storyCreateSchema, async (body, req, res) => {
      const story = await createStoryRepo(req).create({
        title: body.title,
        synopsis: body.synopsis ?? null,
        genre: body.genre ?? null,
        worldNotes: body.worldNotes ?? null,
        targetWords: body.targetWords ?? null,
      });

      respond(storyResponseSchema, res, { story: serializeStory(story) }, 201);
    }),
  );

  // ── /:id routes (B2) ────────────────────────────────────────────────────
  // Ownership middleware param defaults to `${type}Id` (storyId); our route
  // uses `:id`, so pass `idParam: 'id'`. Unknown/unowned → 403, same shape,
  // no id-enumeration oracle.

  const ownStory = requireOwnership('story', { idParam: 'id' });

  // GET /api/stories/:id — return the decrypted story.
  router.get('/:id', ownStory, async (req: Request, res: Response, next: NextFunction) => {
    // Express types req.params[k] as string | string[]; ownership middleware
    // already confirmed it's a non-empty owned id.
    const id = req.params.id as string;
    try {
      const story = await createStoryRepo(req).findById(id);
      // Should be unreachable — ownership middleware already confirmed the row
      // exists for this user. Treat a null here as a race (concurrent delete)
      // and respond 404 so the client sees something sensible.
      if (!story) {
        res.status(404).json({ error: { message: 'Not found', code: 'not_found' } });
        return;
      }
      respond(storyResponseSchema, res, { story: serializeStory(story) });
    } catch (err) {
      next(err);
    }
  });

  // PATCH /api/stories/:id — partial update; nullable fields accept `null`.
  router.patch(
    '/:id',
    ownStory,
    validateBody(storyUpdateSchema, async (body, req, res) => {
      const id = req.params.id as string;

      // Forward only the keys the caller actually supplied so we preserve the
      // `undefined` vs `null` contract that the repo relies on.
      const input: StoryUpdateInput = {};
      if (body.title !== undefined) input.title = body.title;
      if (body.synopsis !== undefined) input.synopsis = body.synopsis;
      if (body.genre !== undefined) input.genre = body.genre;
      if (body.worldNotes !== undefined) input.worldNotes = body.worldNotes;
      if (body.targetWords !== undefined) input.targetWords = body.targetWords;
      if (body.includePreviousChaptersInPrompt !== undefined) {
        input.includePreviousChaptersInPrompt = body.includePreviousChaptersInPrompt;
      }

      const story = await createStoryRepo(req).update(id, input);
      // Race: ownership middleware confirmed ownership, then the row disappeared
      // before the update landed. Return 404 rather than masking it as success.
      if (!story) {
        res.status(404).json({ error: { message: 'Not found', code: 'not_found' } });
        return;
      }
      respond(storyResponseSchema, res, { story: serializeStory(story) });
    }),
  );

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
