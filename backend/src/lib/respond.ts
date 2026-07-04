import type { Response } from 'express';
import { ZodError, type z } from 'zod';

// Wraps a dev-mode egress-drift ZodError so the global error handler's
// central `ZodError -> 400 validation_error` branch (which exists for
// client-input errors) doesn't misclassify a server-side repo/contract
// mismatch as a client mistake. Stays a 500 with a stack in dev, same as
// before the central ZodError mapping was added.
export class EgressSchemaDriftError extends Error {
  constructor(zodMessage: string) {
    super(`egress schema drift: ${zodMessage}`);
    this.name = 'EgressSchemaDriftError';
  }
}

// Egress validation gate. In non-production, parses `data` against the
// schema to catch drift between the repo's actual output and the wire
// contract declared in `story-editor-shared`. In production, skips the
// parse to avoid per-response latency — dev/test coverage is sufficient
// because drift surfaces during development before reaching prod.
export function respond<T>(schema: z.ZodType<T>, res: Response, data: T, status = 200): Response {
  if (process.env.NODE_ENV !== 'production') {
    // Throws on drift; the global error handler renders it (5xx in prod,
    // 500 with stack in dev — both visible during test).
    try {
      schema.parse(data);
    } catch (err) {
      throw err instanceof ZodError ? new EgressSchemaDriftError(err.message) : err;
    }
  }
  return res.status(status).json(data);
}
