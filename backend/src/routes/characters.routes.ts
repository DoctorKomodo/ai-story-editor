// Router uses `mergeParams: true` so :storyId from the parent mount is
// visible on `req.params` inside handlers.

import { type NextFunction, type Request, type Response, Router } from 'express';
import { z } from 'zod';
import { badRequestFromZod } from '../lib/bad-request';
import { requireAuth } from '../middleware/auth.middleware';
import { requireOwnership } from '../middleware/ownership.middleware';
import { type CharacterUpdateInput, createCharacterRepo } from '../repos/character.repo';

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
      const repo = createCharacterRepo(req);
      const max = await repo.maxOrderIndex(storyId);
      const orderIndex = max === null ? 0 : max + 1;
      const character = await repo.create({
        storyId,
        orderIndex,
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
      });
      res.status(201).json({ character });
    } catch (err) {
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
