import { type Request, type Response, Router } from 'express';
import { requireAuth } from '../middleware/auth.middleware';
import { getDekFromRequest } from '../services/content-crypto.service';
import { veniceKeyService } from '../services/venice-key.service';

export function createVeniceKeyRouter() {
  const router = Router();

  // All endpoints in this router operate on the caller's own record only.
  // "Ownership of self" — req.user.id is the only id used.
  router.use(requireAuth);

  router.get('/', async (req: Request, res: Response, next) => {
    try {
      const status = await veniceKeyService.getStatus(getDekFromRequest(req), req.user!.id);
      res.status(200).json(status);
    } catch (err) {
      next(err);
    }
  });

  router.put('/', async (req: Request, res: Response, next) => {
    try {
      const status = await veniceKeyService.store(getDekFromRequest(req), req.user!.id, req.body);
      res.status(200).json({
        status: 'saved',
        lastSix: status.lastSix,
        endpoint: status.endpoint,
      });
    } catch (err) {
      next(err);
    }
  });

  router.delete('/', async (req: Request, res: Response, next) => {
    try {
      await veniceKeyService.remove(req.user!.id);
      res.status(200).json({ status: 'removed' });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
