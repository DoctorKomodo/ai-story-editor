import type { Request, RequestHandler, Response } from 'express';
import type { ZodType, z } from 'zod';
import { badRequestFromZod } from '../lib/bad-request';

export function validateBody<S extends ZodType>(
  schema: S,
  handler: (body: z.infer<S>, req: Request, res: Response) => Promise<unknown> | unknown,
): RequestHandler {
  return (req, res, next) => {
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      badRequestFromZod(res, parsed.error);
      return;
    }
    Promise.resolve()
      .then(() => handler(parsed.data, req, res))
      .catch(next);
  };
}

export function validateQuery<S extends ZodType>(
  schema: S,
  handler: (query: z.infer<S>, req: Request, res: Response) => Promise<unknown> | unknown,
): RequestHandler {
  return (req, res, next) => {
    const parsed = schema.safeParse(req.query);
    if (!parsed.success) {
      badRequestFromZod(res, parsed.error);
      return;
    }
    Promise.resolve()
      .then(() => handler(parsed.data, req, res))
      .catch(next);
  };
}
