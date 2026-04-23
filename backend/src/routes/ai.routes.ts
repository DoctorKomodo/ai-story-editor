import { Router, type Request, type Response, type NextFunction } from 'express';
import { requireAuth } from '../middleware/auth.middleware';
import { veniceModelsService } from '../services/venice.models.service';

export function createAiRouter() {
  const router = Router();

  router.use(requireAuth);

  // [V1] GET /api/ai/models — list text models the caller's BYOK key can see,
  // mapped to { id, name, contextLength, supportsReasoning, supportsVision }.
  // Cached in-memory for 10 minutes by the models service. A missing key
  // surfaces as NoVeniceKeyError from getVeniceClient, which the global error
  // handler maps to 409 { error: "venice_key_required" }.
  router.get('/models', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const models = await veniceModelsService.fetchModels(req.user!.id);
      res.status(200).json({ models });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
