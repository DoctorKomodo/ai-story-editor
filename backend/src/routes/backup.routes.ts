import type { Request, Response } from 'express';
import { Router } from 'express';
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import {
  exportSchema,
  importPlanRequestSchema,
  importPlanResponseSchema,
  importResultSchema,
  importSchema,
} from 'story-editor-shared';
import { prisma } from '../lib/prisma';
import { respond } from '../lib/respond';
import { requireAuth } from '../middleware/auth.middleware';
import { validateBody } from '../middleware/validate';
import { buildExport } from '../services/export.service';
import { planImport, runImport } from '../services/import.service';

function yyyymmdd(d: Date): string {
  return `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}${String(d.getUTCDate()).padStart(2, '0')}`;
}

export function createExportRouter(): Router {
  const router = Router();
  router.use(requireAuth);
  router.get('/', async (req: Request, res: Response, next) => {
    try {
      const user = await prisma.user.findUnique({
        where: { id: req.user!.id },
        select: { username: true },
      });
      const file = await buildExport(req);
      const name = `inkwell-backup-${user?.username ?? 'user'}-${yyyymmdd(new Date())}.json`;
      res.setHeader('Content-Disposition', `attachment; filename="${name}"`);
      return respond(exportSchema, res, file);
    } catch (err) {
      next(err);
    }
  });
  return router;
}

const importLimiter = rateLimit({
  windowMs: 60_000,
  limit: 5,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  keyGenerator: (req) => req.user?.id ?? ipKeyGenerator(req.ip ?? 'unknown'),
  skipFailedRequests: false,
});

export function createImportRouter(): Router {
  const router = Router();
  router.use(requireAuth);
  router.use(importLimiter);
  router.post(
    '/plan',
    validateBody(importPlanRequestSchema, async (body, req, res) => {
      const result = await planImport(req, body);
      return respond(importPlanResponseSchema, res, result);
    }),
  );
  router.post(
    '/',
    validateBody(importSchema, async (body, req, res) => {
      const result = await runImport(req, body);
      return respond(importResultSchema, res, result);
    }),
  );
  return router;
}
