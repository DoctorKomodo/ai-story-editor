import type { NextFunction, Request, Response } from 'express';
import { Router } from 'express';
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import {
  EXPORT_FORMAT_VERSION,
  exportSchema,
  importPlanRequestSchema,
  importPlanResponseSchema,
  importRequestSchema,
  importResultSchema,
} from 'story-editor-shared';
import { HttpError } from '../lib/http-errors';
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

// A wrong-version file fails the strict import schema with dozens of unrelated
// issues (unknown keys on every chapter), burying the real cause. Name it
// before strict parsing so old backups get a distinct, actionable error.
// Message is a static literal (HttpError security invariant).
function rejectUnsupportedFormatVersion(req: Request, _res: Response, next: NextFunction): void {
  const version = (req.body as { file?: { formatVersion?: unknown } } | undefined)?.file
    ?.formatVersion;
  if (typeof version === 'number' && version !== EXPORT_FORMAT_VERSION) {
    next(
      new HttpError(
        400,
        'unsupported_format_version',
        'Unsupported backup format version — this file was exported by a different app version.',
      ),
    );
    return;
  }
  next();
}

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
    rejectUnsupportedFormatVersion,
    validateBody(importRequestSchema, async (body, req, res) => {
      const result = await runImport(req, body);
      return respond(importResultSchema, res, result);
    }),
  );
  return router;
}
