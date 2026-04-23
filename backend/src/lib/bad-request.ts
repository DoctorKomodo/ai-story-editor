// Shared Zod-validation error envelope helper.
//
// The API contract (docs/api-contract.md) specifies that invalid request
// bodies return `400 { error: { message, code: "validation_error", issues } }`.
// Auth and the B-series routes both need this shape; extracting it here keeps
// one canonical implementation so new routes don't drift back into ad-hoc
// envelopes (`code: 'invalid_request'`, `details: flatten()`, etc.).
//
// Issues are projected to `{ path, message }` pairs rather than dumping the
// full ZodIssue shape — we don't need to expose internal codes/params, and a
// stable minimal shape is easier for clients to render.

import type { Response } from 'express';
import type { ZodError } from 'zod';

export function badRequestFromZod(res: Response, err: ZodError): Response {
  return res.status(400).json({
    error: {
      message: 'Invalid request body',
      code: 'validation_error',
      issues: err.issues.map((issue) => ({
        path: issue.path,
        message: issue.message,
      })),
    },
  });
}
