// Router uses `mergeParams: true` so :storyId from the parent mount is
// visible on `req.params` inside handlers.

import { Prisma } from '@prisma/client';
import { type NextFunction, type Request, type Response, Router } from 'express';
import {
  characterCreateSchema,
  characterReorderSchema,
  characterResponseSchema,
  charactersResponseSchema,
  characterUpdateSchema,
} from 'story-editor-shared';
import { badRequest } from '../lib/bad-request';
import { notFound } from '../lib/http-errors';
import { respond } from '../lib/respond';
import { serializeCharacter } from '../lib/serialize';
import { requireAuth } from '../middleware/auth.middleware';
import { requireOwnership } from '../middleware/ownership.middleware';
import { validateBody } from '../middleware/validate';
import { createCharacterRepo } from '../repos/character.repo';

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

export function createCharactersRouter() {
  const router = Router({ mergeParams: true });
  router.use(requireAuth);

  const ownStory = requireOwnership('story', { idParam: 'storyId' });
  const ownCharacter = requireOwnership('character', { idParam: 'characterId' });

  router.get('/', ownStory, async (req: Request, res: Response, next: NextFunction) => {
    const storyId = req.params.storyId as string;
    try {
      const characters = await createCharacterRepo(req).findManyForStory(storyId);
      respond(charactersResponseSchema, res, { characters: characters.map(serializeCharacter) });
    } catch (err) {
      next(err);
    }
  });

  router.post(
    '/',
    ownStory,
    validateBody(characterCreateSchema, async (body, req, res) => {
      const storyId = req.params.storyId as string;

      // [D16] aggregate(_max)+insert is racy: two concurrent POSTs can compute
      // the same `nextOrderIndex`. @@unique([storyId, orderIndex]) guarantees
      // the DB rejects the loser with P2002; we re-aggregate and retry. One
      // retry is almost always sufficient (the winner's row now shows up in
      // `_max`); `POST_ORDER_RETRY_ATTEMPTS` bounds the loop.
      const characterRepo = createCharacterRepo(req);

      let lastErr: unknown;
      let created: Awaited<ReturnType<ReturnType<typeof createCharacterRepo>['create']>> | null =
        null;
      for (let attempt = 0; attempt < POST_ORDER_RETRY_ATTEMPTS; attempt++) {
        const currentMax = await characterRepo.maxOrderIndex(storyId);
        const nextOrderIndex = currentMax === null ? 0 : currentMax + 1;
        try {
          created = await characterRepo.create({
            storyId,
            orderIndex: nextOrderIndex,
            ...body,
          });
          break;
        } catch (err) {
          if (!isPrismaUniqueViolation(err)) throw err;
          lastErr = err;
          // loop — re-aggregate picks up the winning row.
        }
      }

      if (created === null) {
        throw lastErr ?? new Error('characters POST: failed to allocate orderIndex');
      }

      respond(characterResponseSchema, res, { character: serializeCharacter(created) }, 201);
    }),
  );

  // [cast-ui] PATCH /reorder — declared BEFORE /:characterId so Express doesn't
  // match the literal "reorder" path segment against the :characterId param.
  router.patch(
    '/reorder',
    ownStory,
    validateBody(characterReorderSchema, async (body, req, res) => {
      const storyId = req.params.storyId as string;

      // Uniqueness checks the Zod schema can't express cleanly — these are
      // semantic validation (duplicate id / duplicate orderIndex) rather than
      // schema-shape issues, but still return the contract's `validation_error`
      // code so clients can handle all 400s uniformly. The human-readable
      // message disambiguates the specific failure.
      const seenIds = new Set<string>();
      const seenOrders = new Set<number>();
      for (const [i, item] of body.characters.entries()) {
        if (seenIds.has(item.id)) {
          return badRequest(res, `Duplicate character id "${item.id}"`, ['characters', i, 'id']);
        }
        if (seenOrders.has(item.orderIndex)) {
          return badRequest(res, `Duplicate orderIndex ${item.orderIndex}`, [
            'characters',
            i,
            'orderIndex',
          ]);
        }
        seenIds.add(item.id);
        seenOrders.add(item.orderIndex);
      }

      await createCharacterRepo(req).reorder(storyId, body.characters);
      res.status(204).send();
    }),
  );

  // Ownership middleware confirms the caller owns the character but not that
  // the character lives under :storyId — each per-character handler 404s a
  // character.storyId/URL mismatch.
  router.get(
    '/:characterId',
    ownStory,
    ownCharacter,
    async (req: Request, res: Response, next: NextFunction) => {
      const storyId = req.params.storyId as string;
      const characterId = req.params.characterId as string;
      try {
        const character = await createCharacterRepo(req).findById(characterId);
        if (!character || character.storyId !== storyId) throw notFound();
        respond(characterResponseSchema, res, { character: serializeCharacter(character) });
      } catch (err) {
        next(err);
      }
    },
  );

  router.patch(
    '/:characterId',
    ownStory,
    ownCharacter,
    validateBody(characterUpdateSchema, async (body, req, res) => {
      const storyId = req.params.storyId as string;
      const characterId = req.params.characterId as string;

      const existing = await createCharacterRepo(req).findById(characterId);
      if (!existing || existing.storyId !== storyId) throw notFound();

      const character = await createCharacterRepo(req).update(characterId, body);
      if (!character) throw notFound();
      respond(characterResponseSchema, res, { character: serializeCharacter(character) });
    }),
  );

  router.delete(
    '/:characterId',
    ownStory,
    ownCharacter,
    async (req: Request, res: Response, next: NextFunction) => {
      const storyId = req.params.storyId as string;
      const characterId = req.params.characterId as string;
      try {
        const existing = await createCharacterRepo(req).findById(characterId);
        if (!existing || existing.storyId !== storyId) throw notFound();
        const ok = await createCharacterRepo(req).remove(characterId);
        if (!ok) throw notFound();
        res.status(204).send();
      } catch (err) {
        next(err);
      }
    },
  );

  return router;
}
