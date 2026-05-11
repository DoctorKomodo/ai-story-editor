import type { Response } from 'express';
import type { z } from 'zod';

// Egress validation gate. In non-production, parses `data` against the
// schema to catch drift between the repo's actual output and the wire
// contract declared in `story-editor-shared`. In production, skips the
// parse to avoid per-response latency — dev/test coverage is sufficient
// because drift surfaces during development before reaching prod.
export function respond<T>(schema: z.ZodType<T>, res: Response, data: T, status = 200): Response {
  if (process.env.NODE_ENV !== 'production') {
    // Throws ZodError on drift; the global error handler renders it
    // (5xx in prod, 500 with stack in dev — both visible during test).
    schema.parse(data);
  }
  return res.status(status).json(data);
}
