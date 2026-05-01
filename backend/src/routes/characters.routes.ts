// Router uses `mergeParams: true` so :storyId from the parent mount is
// visible on `req.params` inside handlers.

import { Prisma } from '@prisma/client';
import { type NextFunction, type Request, type Response, Router } from 'express';
import { z } from 'zod';
import { badRequestFromZod } from '../lib/bad-request';
import { requireAuth } from '../middleware/auth.middleware';
import { requireOwnership } from '../middleware/ownership.middleware';
import {
  CharacterNotOwnedError,
  type CharacterUpdateInput,
  createCharacterRepo,
} from '../repos/character.repo';

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

const CreateCharacterBody = z
  .object({
    name: z.string().min(1).max(200),
    role: z.string().max(200).nullable().optional(),
    age: z.string().max(50).nullable().optional(),
    color: z.string().max(20).nullable().optional(),
    initial: z.string().max(4).nullable().optional(),
    appearance: z.string().max(5_000).nullable().optional(),
    voice: z.string().max(5_000).nullable().optional(),
    arc: z.string().max(5_000).nullable().optional(),
    physicalDescription: z.string().max(5_000).nullable().optional(),
    personality: z.string().max(5_000).nullable().optional(),
    backstory: z.string().max(20_000).nullable().optional(),
    notes: z.string().max(20_000).nullable().optional(),
  })
  .strict();

const UpdateCharacterBody = z
  .object({
    name: z.string().min(1).max(200).optional(),
    role: z.string().max(200).nullable().optional(),
    age: z.string().max(50).nullable().optional(),
    color: z.string().max(20).nullable().optional(),
    initial: z.string().max(4).nullable().optional(),
    appearance: z.string().max(5_000).nullable().optional(),
    voice: z.string().max(5_000).nullable().optional(),
    arc: z.string().max(5_000).nullable().optional(),
    physicalDescription: z.string().max(5_000).nullable().optional(),
    personality: z.string().max(5_000).nullable().optional(),
    backstory: z.string().max(20_000).nullable().optional(),
    notes: z.string().max(20_000).nullable().optional(),
  })
  .strict();

const ReorderCharactersBody = z
  .object({
    characters: z
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

export function createCharactersRouter() {
  const router = Router({ mergeParams: true });
  router.use(requireAuth);

  const ownStory = requireOwnership('story', { idParam: 'storyId' });
  const ownCharacter = requireOwnership('character', { idParam: 'characterId' });

  router.get('/', ownStory, async (req: Request, res: Response, next: NextFunction) => {
    const storyId = req.params.storyId as string;
    try {
      const characters = await createCharacterRepo(req).findManyForStory(storyId);
      res.status(200).json({ characters });
    } catch (err) {
      next(err);
    }
  });

  router.post('/', ownStory, async (req: Request, res: Response, next: NextFunction) => {
    const storyId = req.params.storyId as string;

    const parsed = CreateCharacterBody.safeParse(req.body);
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
            name: body.name,
            role: body.role,
            age: body.age,
            color: body.color,
            initial: body.initial,
            appearance: body.appearance,
            voice: body.voice,
            arc: body.arc,
            physicalDescription: body.physicalDescription,
            personality: body.personality,
            backstory: body.backstory,
            notes: body.notes,
            orderIndex: nextOrderIndex,
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

      res.status(201).json({ character: created });
    } catch (err) {
      next(err);
    }
  });

  // [cast-ui] PATCH /reorder — declared BEFORE /:characterId so Express doesn't
  // match the literal "reorder" path segment against the :characterId param.
  router.patch('/reorder', ownStory, async (req: Request, res: Response, next: NextFunction) => {
    const storyId = req.params.storyId as string;

    const parsed = ReorderCharactersBody.safeParse(req.body);
    if (!parsed.success) {
      badRequestFromZod(res, parsed.error);
      return;
    }
    const items = parsed.data.characters;

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
          error: { message: 'Duplicate character id in payload', code: 'validation_error' },
        });
        return;
      }
      seenIds.add(item.id);
      if (seenOrders.has(item.orderIndex)) {
        res.status(400).json({
          error: { message: 'Duplicate orderIndex in payload', code: 'validation_error' },
        });
        return;
      }
      seenOrders.add(item.orderIndex);
    }

    try {
      await createCharacterRepo(req).reorder(storyId, items);
      res.status(204).send();
    } catch (err) {
      if (err instanceof CharacterNotOwnedError) {
        res.status(403).json({ error: { message: 'Forbidden', code: 'forbidden' } });
        return;
      }
      next(err);
    }
  });

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
        if (!character || character.storyId !== storyId) {
          res.status(404).json({ error: { message: 'Not found', code: 'not_found' } });
          return;
        }
        res.status(200).json({ character });
      } catch (err) {
        next(err);
      }
    },
  );

  router.patch(
    '/:characterId',
    ownStory,
    ownCharacter,
    async (req: Request, res: Response, next: NextFunction) => {
      const storyId = req.params.storyId as string;
      const characterId = req.params.characterId as string;

      const parsed = UpdateCharacterBody.safeParse(req.body);
      if (!parsed.success) {
        badRequestFromZod(res, parsed.error);
        return;
      }
      const body = parsed.data;

      try {
        const existing = await createCharacterRepo(req).findById(characterId);
        if (!existing || existing.storyId !== storyId) {
          res.status(404).json({ error: { message: 'Not found', code: 'not_found' } });
          return;
        }

        const input: CharacterUpdateInput = {};
        // Only forward explicitly present keys so `null` clears a field and
        // omitted keys leave it untouched.
        for (const key of [
          'name',
          'role',
          'age',
          'color',
          'initial',
          'appearance',
          'voice',
          'arc',
          'physicalDescription',
          'personality',
          'backstory',
          'notes',
        ] as const) {
          if (key in body) {
            (input as Record<string, unknown>)[key] = (body as Record<string, unknown>)[key];
          }
        }

        const character = await createCharacterRepo(req).update(characterId, input);
        if (!character) {
          res.status(404).json({ error: { message: 'Not found', code: 'not_found' } });
          return;
        }
        res.status(200).json({ character });
      } catch (err) {
        next(err);
      }
    },
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
        if (!existing || existing.storyId !== storyId) {
          res.status(404).json({ error: { message: 'Not found', code: 'not_found' } });
          return;
        }
        const ok = await createCharacterRepo(req).remove(characterId);
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
