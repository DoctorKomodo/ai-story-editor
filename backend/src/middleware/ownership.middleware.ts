import type { PrismaClient } from '@prisma/client';
import type { NextFunction, Request, Response } from 'express';
import { prisma as defaultPrisma } from '../lib/prisma';
import {
  chapterExistsForUser,
  characterExistsForUser,
  chatExistsForUser,
  draftExistsForUser,
  messageExistsForUser,
  outlineItemExistsForUser,
  storyExistsForUser,
} from '../repos/_narrative';

export type OwnedResource =
  | 'story'
  | 'chapter'
  | 'character'
  | 'outline'
  | 'chat'
  | 'message'
  | 'draft';

function deny(res: Response, status: 401 | 403 | 400, code: string): Response {
  const messages: Record<string, string> = {
    unauthorized: 'Unauthorized',
    forbidden: 'Forbidden',
    missing_resource_id: 'Missing resource id',
  };
  return res.status(status).json({ error: { message: messages[code] ?? 'Forbidden', code } });
}

// Dispatch table over the `_narrative.ts` ownership predicates — one flat
// `{ id, userId }` lookup per resource now that every narrative table
// carries its owner directly. No narrative-model Prisma calls live here.
const checkOwned: Record<
  OwnedResource,
  (id: string, userId: string, client: PrismaClient) => Promise<boolean>
> = {
  story: storyExistsForUser,
  chapter: chapterExistsForUser,
  character: characterExistsForUser,
  outline: outlineItemExistsForUser,
  chat: chatExistsForUser,
  message: messageExistsForUser,
  draft: draftExistsForUser,
};

export interface RequireOwnershipOptions {
  idParam?: string;
  client?: PrismaClient;
}

export function requireOwnership(type: OwnedResource, options: RequireOwnershipOptions = {}) {
  const client = options.client ?? defaultPrisma;
  const idParam = options.idParam ?? `${type}Id`;

  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    if (!req.user) {
      deny(res, 401, 'unauthorized');
      return;
    }
    const id = req.params[idParam];
    if (typeof id !== 'string' || id.length === 0) {
      deny(res, 400, 'missing_resource_id');
      return;
    }

    try {
      const owned = await checkOwned[type](id, req.user.id, client);
      if (!owned) {
        // Conflate "does not exist" with "does not own" so the endpoint isn't
        // an id-enumeration oracle — same 403 in either case.
        deny(res, 403, 'forbidden');
        return;
      }
      next();
    } catch (err) {
      next(err);
    }
  };
}
