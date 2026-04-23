// [B8] Router uses `mergeParams: true` so :storyId from the parent mount is
// visible on `req.params` inside handlers.

import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth.middleware';
import { requireOwnership } from '../middleware/ownership.middleware';
import { prisma } from '../lib/prisma';
import { badRequestFromZod } from '../lib/bad-request';
import {
  createOutlineRepo,
  OutlineNotOwnedError,
  type OutlineUpdateInput,
} from '../repos/outline.repo';

const CreateOutlineBody = z
  .object({
    title: z.string().min(1).max(300),
    sub: z.string().max(2000).nullable().optional(),
    // `status` is intentionally free-form (frontend uses 'queued' / 'active' /
    // 'done' today, but there's no server-side enum contract yet). Bounded to
    // keep the encrypted-column footprint reasonable.
    status: z.string().min(1).max(40),
  })
  .strict();

const UpdateOutlineBody = z
  .object({
    title: z.string().min(1).max(300).optional(),
    sub: z.string().max(2000).nullable().optional(),
    status: z.string().min(1).max(40).optional(),
    order: z.number().int().min(0).optional(),
  })
  .strict();

const ReorderOutlineBody = z
  .object({
    items: z
      .array(
        z
          .object({
            id: z.string().min(1),
            order: z.number().int().min(0),
          })
          .strict(),
      )
      .min(1)
      .max(500),
  })
  .strict();

export function createOutlineRouter() {
  const router = Router({ mergeParams: true });
  router.use(requireAuth);

  const ownStory = requireOwnership('story', { idParam: 'storyId' });
  const ownOutline = requireOwnership('outline', { idParam: 'outlineId' });

  router.get('/', ownStory, async (req: Request, res: Response, next: NextFunction) => {
    const storyId = req.params.storyId as string;
    try {
      const outline = await createOutlineRepo(req).findManyForStory(storyId);
      res.status(200).json({ outline });
    } catch (err) {
      next(err);
    }
  });

  router.post('/', ownStory, async (req: Request, res: Response, next: NextFunction) => {
    const storyId = req.params.storyId as string;

    const parsed = CreateOutlineBody.safeParse(req.body);
    if (!parsed.success) {
      badRequestFromZod(res, parsed.error);
      return;
    }
    const body = parsed.data;

    try {
      // TODO(schema): aggregate+insert is not transactionally safe; concurrent
      // POSTs to the same story can produce duplicate order values. Mirrors
      // the chapters POST auto-assign pattern — deferred until a schema-level
      // @@unique([storyId, order]) lands alongside a two-phase reorder swap.
      const userId = req.user!.id;
      const agg = await prisma.outlineItem.aggregate({
        where: { storyId, story: { userId } },
        _max: { order: true },
      });
      const nextOrder =
        agg._max.order === null || agg._max.order === undefined ? 0 : agg._max.order + 1;

      const outlineItem = await createOutlineRepo(req).create({
        storyId,
        title: body.title,
        sub: body.sub,
        status: body.status,
        order: nextOrder,
      });

      res.status(201).json({ outlineItem });
    } catch (err) {
      next(err);
    }
  });

  // PATCH /reorder — declared BEFORE /:outlineId so Express doesn't match the
  // literal "reorder" path segment against the :outlineId param.
  router.patch(
    '/reorder',
    ownStory,
    async (req: Request, res: Response, next: NextFunction) => {
      const storyId = req.params.storyId as string;

      const parsed = ReorderOutlineBody.safeParse(req.body);
      if (!parsed.success) {
        badRequestFromZod(res, parsed.error);
        return;
      }
      const items = parsed.data.items;

      // Uniqueness checks the Zod schema can't express cleanly — these are
      // semantic validation (duplicate id / duplicate order) rather than
      // schema-shape issues, but still return the contract's `validation_error`
      // code so clients can handle all 400s uniformly. The human-readable
      // message disambiguates the specific failure.
      const seenIds = new Set<string>();
      const seenOrders = new Set<number>();
      for (const item of items) {
        if (seenIds.has(item.id)) {
          res.status(400).json({
            error: { message: 'Duplicate outline id in payload', code: 'validation_error' },
          });
          return;
        }
        seenIds.add(item.id);
        if (seenOrders.has(item.order)) {
          res.status(400).json({
            error: { message: 'Duplicate order in payload', code: 'validation_error' },
          });
          return;
        }
        seenOrders.add(item.order);
      }

      try {
        await createOutlineRepo(req).reorder(storyId, items);
        res.status(204).send();
      } catch (err) {
        if (err instanceof OutlineNotOwnedError) {
          res.status(403).json({ error: { message: 'Forbidden', code: 'forbidden' } });
          return;
        }
        next(err);
      }
    },
  );

  // Ownership middleware confirms the caller owns the outline item but not
  // that the item lives under :storyId — each per-item handler 404s a
  // storyId/URL mismatch.
  router.get(
    '/:outlineId',
    ownStory,
    ownOutline,
    async (req: Request, res: Response, next: NextFunction) => {
      const storyId = req.params.storyId as string;
      const outlineId = req.params.outlineId as string;
      try {
        const outlineItem = await createOutlineRepo(req).findById(outlineId);
        if (!outlineItem || outlineItem.storyId !== storyId) {
          res.status(404).json({ error: { message: 'Not found', code: 'not_found' } });
          return;
        }
        res.status(200).json({ outlineItem });
      } catch (err) {
        next(err);
      }
    },
  );

  router.patch(
    '/:outlineId',
    ownStory,
    ownOutline,
    async (req: Request, res: Response, next: NextFunction) => {
      const storyId = req.params.storyId as string;
      const outlineId = req.params.outlineId as string;

      const parsed = UpdateOutlineBody.safeParse(req.body);
      if (!parsed.success) {
        badRequestFromZod(res, parsed.error);
        return;
      }
      const body = parsed.data;

      try {
        const existing = await createOutlineRepo(req).findById(outlineId);
        if (!existing || existing.storyId !== storyId) {
          res.status(404).json({ error: { message: 'Not found', code: 'not_found' } });
          return;
        }

        const input: OutlineUpdateInput = {};
        // Only forward explicitly present keys so `null` clears a field and
        // omitted keys leave it untouched.
        if ('title' in body) input.title = body.title;
        if ('sub' in body) input.sub = body.sub;
        if ('status' in body) input.status = body.status;
        if ('order' in body) input.order = body.order;

        const outlineItem = await createOutlineRepo(req).update(outlineId, input);
        if (!outlineItem) {
          res.status(404).json({ error: { message: 'Not found', code: 'not_found' } });
          return;
        }
        res.status(200).json({ outlineItem });
      } catch (err) {
        next(err);
      }
    },
  );

  router.delete(
    '/:outlineId',
    ownStory,
    ownOutline,
    async (req: Request, res: Response, next: NextFunction) => {
      const storyId = req.params.storyId as string;
      const outlineId = req.params.outlineId as string;
      try {
        const existing = await createOutlineRepo(req).findById(outlineId);
        if (!existing || existing.storyId !== storyId) {
          res.status(404).json({ error: { message: 'Not found', code: 'not_found' } });
          return;
        }
        const ok = await createOutlineRepo(req).remove(outlineId);
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
