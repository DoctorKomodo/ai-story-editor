import type { PrismaClient } from '@prisma/client';
import type { NextFunction, Request, Response } from 'express';
import { prisma as defaultPrisma } from '../lib/prisma';

export type OwnedResource = 'story' | 'chapter' | 'character' | 'outline' | 'chat' | 'message';

function deny(res: Response, status: 401 | 403 | 400, code: string): Response {
  const messages: Record<string, string> = {
    unauthorized: 'Unauthorized',
    forbidden: 'Forbidden',
    missing_resource_id: 'Missing resource id',
  };
  return res.status(status).json({ error: { message: messages[code] ?? 'Forbidden', code } });
}

async function checkOwned(
  client: PrismaClient,
  type: OwnedResource,
  id: string,
  userId: string,
): Promise<boolean> {
  const select = { id: true } as const;
  switch (type) {
    case 'story': {
      const row = await client.story.findFirst({ where: { id, userId }, select });
      return row !== null;
    }
    case 'chapter': {
      const row = await client.chapter.findFirst({
        where: { id, story: { userId } },
        select,
      });
      return row !== null;
    }
    case 'character': {
      const row = await client.character.findFirst({
        where: { id, story: { userId } },
        select,
      });
      return row !== null;
    }
    case 'outline': {
      const row = await client.outlineItem.findFirst({
        where: { id, story: { userId } },
        select,
      });
      return row !== null;
    }
    case 'chat': {
      const row = await client.chat.findFirst({
        where: { id, chapter: { story: { userId } } },
        select,
      });
      return row !== null;
    }
    case 'message': {
      const row = await client.message.findFirst({
        where: { id, chat: { chapter: { story: { userId } } } },
        select,
      });
      return row !== null;
    }
  }
}

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
      const owned = await checkOwned(client, type, id, req.user.id);
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
