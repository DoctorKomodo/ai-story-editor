import { type Request, type Response, Router } from 'express';
import { ZodError } from 'zod';
import { requireAuth } from '../middleware/auth.middleware';
import {
  VeniceKeyCheckError,
  VeniceKeyInvalidError,
  veniceKeyService,
} from '../services/venice-key.service';

function badRequestFromZod(res: Response, err: ZodError): Response {
  return res.status(400).json({
    error: {
      message: 'Invalid request body',
      code: 'validation_error',
      issues: err.issues.map((issue) => ({
        path: issue.path,
        message: issue.message,
      })),
    },
  });
}

export function createVeniceKeyRouter() {
  const router = Router();

  // All endpoints in this router operate on the caller's own record only.
  // "Ownership of self" — req.user.id is the only id used.
  router.use(requireAuth);

  router.get('/', async (req: Request, res: Response, next) => {
    try {
      const status = await veniceKeyService.getStatus(req.user!.id);
      res.status(200).json(status);
    } catch (err) {
      next(err);
    }
  });

  router.put('/', async (req: Request, res: Response, next) => {
    try {
      const status = await veniceKeyService.store(req.user!.id, req.body);
      res.status(200).json({
        status: 'saved',
        lastSix: status.lastSix,
        endpoint: status.endpoint,
      });
    } catch (err) {
      if (err instanceof ZodError) {
        badRequestFromZod(res, err);
        return;
      }
      if (err instanceof VeniceKeyInvalidError) {
        res
          .status(400)
          .json({ error: { message: 'venice_key_invalid', code: 'venice_key_invalid' } });
        return;
      }
      if (err instanceof VeniceKeyCheckError) {
        res
          .status(502)
          .json({ error: { message: 'venice_unreachable', code: 'venice_unreachable' } });
        return;
      }
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
