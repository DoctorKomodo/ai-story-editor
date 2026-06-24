import type { Request, Response } from 'express';
import { Router } from 'express';
import { exportSchema } from 'story-editor-shared';
import { prisma } from '../lib/prisma';
import { respond } from '../lib/respond';
import { requireAuth } from '../middleware/auth.middleware';
import { buildExport } from '../services/export.service';

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
