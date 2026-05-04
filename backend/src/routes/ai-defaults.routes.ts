// backend/src/routes/ai-defaults.routes.ts
//
// [X29] GET /api/ai/default-prompts — exposes DEFAULT_PROMPTS so the
// Settings → Prompts tab can render the same fallback strings the
// backend uses. Constants change only on deploy → frontend caches with
// staleTime: Infinity. Auth-required (mirrors the rest of /api/ai).

import { type Request, type Response, Router } from 'express';
import { requireAuth } from '../middleware/auth.middleware';
import { DEFAULT_PROMPTS } from '../services/prompt.service';

export function createAiDefaultsRouter() {
  const router = Router();
  router.use(requireAuth);

  router.get('/default-prompts', (_req: Request, res: Response) => {
    res.status(200).json({ defaults: DEFAULT_PROMPTS });
  });

  return router;
}
