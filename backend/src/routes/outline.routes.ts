// [B8] Router uses `mergeParams: true` so :storyId from the parent mount is
// visible on `req.params` inside handlers.

import { Prisma } from '@prisma/client';
import { type NextFunction, type Request, type Response, Router } from 'express';
import {
  outlineCreateSchema,
  outlineItemResponseSchema,
  outlineListResponseSchema,
  outlineReorderSchema,
  outlineUpdateSchema,
} from 'story-editor-shared';
import { badRequestFromZod } from '../lib/bad-request';
import { respond } from '../lib/respond';
import { serializeOutlineItem } from '../lib/serialize';
import { requireAuth } from '../middleware/auth.middleware';
import { requireOwnership } from '../middleware/ownership.middleware';
import {
  createOutlineRepo,
  OutlineNotOwnedError,
  type OutlineUpdateInput,
} from '../repos/outline.repo';

// [D16] See chapters.routes.ts for the full rationale — mirror constant here
// so both POST handlers behave identically under the race.
const POST_ORDER_RETRY_ATTEMPTS = 3;

function isPrismaUniqueViolation(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002';
}

export function createOutlineRouter() {
  const router = Router({ mergeParams: true });
  router.use(requireAuth);

  const ownStory = requireOwnership('story', { idParam: 'storyId' });
  const ownOutline = requireOwnership('outline', { idParam: 'outlineId' });

  router.get('/', ownStory, async (req: Request, res: Response, next: NextFunction) => {
    const storyId = req.params.storyId as string;
    try {
      const rows = await createOutlineRepo(req).findManyForStory(storyId);
      respond(outlineListResponseSchema, res, { outline: rows.map(serializeOutlineItem) });
    } catch (err) {
      next(err);
    }
  });

  router.post('/', ownStory, async (req: Request, res: Response, next: NextFunction) => {
    const storyId = req.params.storyId as string;

    const parsed = outlineCreateSchema.safeParse(req.body);
    if (!parsed.success) {
      badRequestFromZod(res, parsed.error);
      return;
    }
    const body = parsed.data;

    try {
      // [D16] Matches chapters.routes.ts: @@unique([storyId, order]) catches
      // the aggregate+insert race at the DB; we re-aggregate + retry on P2002.
      const outlineRepo = createOutlineRepo(req);

      let lastErr: unknown;
      let created: Awaited<ReturnType<ReturnType<typeof createOutlineRepo>['create']>> | null =
        null;
      for (let attempt = 0; attempt < POST_ORDER_RETRY_ATTEMPTS; attempt++) {
        const currentMax = await outlineRepo.maxOrder(storyId);
        const nextOrder = currentMax === null ? 0 : currentMax + 1;

        try {
          created = await outlineRepo.create({
            storyId,
            title: body.title,
            sub: body.sub,
            status: body.status,
            order: nextOrder,
          });
          break;
        } catch (err) {
          if (!isPrismaUniqueViolation(err)) throw err;
          lastErr = err;
        }
      }

      if (created === null) {
        throw lastErr ?? new Error('outline POST: failed to allocate order');
      }

      respond(outlineItemResponseSchema, res, { outlineItem: serializeOutlineItem(created) }, 201);
    } catch (err) {
      next(err);
    }
  });

  // PATCH /reorder — declared BEFORE /:outlineId so Express doesn't match the
  // literal "reorder" path segment against the :outlineId param.
  router.patch('/reorder', ownStory, async (req: Request, res: Response, next: NextFunction) => {
    const storyId = req.params.storyId as string;

    const parsed = outlineReorderSchema.safeParse(req.body);
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
  });

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
        const row = await createOutlineRepo(req).findById(outlineId);
        if (!row || row.storyId !== storyId) {
          res.status(404).json({ error: { message: 'Not found', code: 'not_found' } });
          return;
        }
        respond(outlineItemResponseSchema, res, { outlineItem: serializeOutlineItem(row) });
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

      const parsed = outlineUpdateSchema.safeParse(req.body);
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

        const updated = await createOutlineRepo(req).update(outlineId, input);
        if (!updated) {
          res.status(404).json({ error: { message: 'Not found', code: 'not_found' } });
          return;
        }
        respond(outlineItemResponseSchema, res, { outlineItem: serializeOutlineItem(updated) });
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
