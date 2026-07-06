import type { NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';
import { badRequestFromZod } from '../lib/bad-request';
import { conflict, HttpError } from '../lib/http-errors';
import { NoVeniceKeyError } from '../lib/venice';
import { ChapterNotOwnedError } from '../repos/chapter.repo';
import { CharacterNotOwnedError } from '../repos/character.repo';
import {
  DraftDeleteActiveError,
  DraftDeleteLastError,
  DraftVersionConflictError,
} from '../repos/draft.repo';
import { OutlineNotOwnedError } from '../repos/outline.repo';
import { InvalidCredentialsError, UsernameUnavailableError } from '../services/auth.service';
import { DekNotAvailableError } from '../services/content-crypto.service';
import { UnknownModelError } from '../services/venice.models.service';
import { VeniceKeyCheckError, VeniceKeyInvalidError } from '../services/venice-key.service';

// Central domain-error mapping table. Routes `throw` an `HttpError` or one of
// the domain/service error classes below; this is the single place that
// assigns an HTTP status + wire body. Keeping the mapping here (rather than
// scattering it across per-route catch ladders) means the API error catalog
// (docs/api-contract.md) has one source of truth.
//
// Global error handler. Keeps stack traces out of production responses and
// gives clients a consistent JSON shape when a route hands an error to next().
// Exported so tests can mount the exact same handler on a disposable app
// instead of duplicating the logic.
export function globalErrorHandler(
  err: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction,
): void {
  if (err instanceof HttpError) {
    res.status(err.status).json({ error: { message: err.message, code: err.code } });
    return;
  }
  if (err instanceof ZodError) {
    badRequestFromZod(res, err);
    return;
  }
  // [V17] Per-user Venice client signals "user has no stored key" via
  // NoVeniceKeyError. Map to 409 so the frontend can prompt the user to set
  // one in /settings#venice. Keep this above the catch-all 500 below.
  if (err instanceof NoVeniceKeyError) {
    res.status(409).json({
      error: {
        message: 'No Venice API key is stored. Add yours in Settings to enable AI features.',
        code: 'venice_key_required',
      },
    });
    return;
  }
  if (err instanceof UnknownModelError) {
    res.status(400).json({ error: { message: err.message, code: 'unknown_model' } });
    return;
  }
  if (err instanceof InvalidCredentialsError) {
    res
      .status(401)
      .json({ error: { message: 'Invalid credentials', code: 'invalid_credentials' } });
    return;
  }
  if (err instanceof UsernameUnavailableError) {
    res
      .status(409)
      .json({ error: { message: 'Username unavailable', code: 'username_unavailable' } });
    return;
  }
  if (err instanceof VeniceKeyInvalidError) {
    res.status(400).json({ error: { message: 'venice_key_invalid', code: 'venice_key_invalid' } });
    return;
  }
  if (err instanceof VeniceKeyCheckError) {
    res.status(502).json({ error: { message: 'venice_unreachable', code: 'venice_unreachable' } });
    return;
  }
  if (
    err instanceof ChapterNotOwnedError ||
    err instanceof CharacterNotOwnedError ||
    err instanceof OutlineNotOwnedError
  ) {
    res.status(403).json({ error: { message: 'Forbidden', code: 'forbidden' } });
    return;
  }
  if (err instanceof DraftVersionConflictError) {
    const e = conflict('Draft was modified elsewhere');
    res.status(e.status).json({ error: { message: e.message, code: e.code } });
    return;
  }
  if (err instanceof DraftDeleteActiveError) {
    const e = conflict('Cannot delete the active draft', 'cannot_delete_active_draft');
    res.status(e.status).json({ error: { message: e.message, code: e.code } });
    return;
  }
  if (err instanceof DraftDeleteLastError) {
    const e = conflict('Cannot delete the last draft', 'cannot_delete_last_draft');
    res.status(e.status).json({ error: { message: e.message, code: e.code } });
    return;
  }
  if (err instanceof DekNotAvailableError) {
    // Reachable only if a route calls getDekFromRequest without requireAuth
    // (programmer error) — surface it in dev logs even though we fail closed
    // with a normal 401 body below.
    if (process.env.NODE_ENV !== 'production') {
      console.error('[error-handler.dev]', err);
    }
    // Byte-identical to auth.middleware.ts's session_expired body so the
    // frontend's existing 401 -> sign-in-again recovery path handles it.
    res.status(401).json({ error: { message: 'Session expired', code: 'session_expired' } });
    return;
  }

  const isProd = process.env.NODE_ENV === 'production';
  if (!isProd) {
    console.error('[error-handler.dev]', err);
  }
  const message = isProd
    ? 'Internal server error'
    : err instanceof Error
      ? err.message
      : 'Internal server error';
  const body: { error: { message: string; code: string; stack?: string } } = {
    error: { message, code: 'internal_error' },
  };
  if (!isProd && err instanceof Error && typeof err.stack === 'string') {
    body.error.stack = err.stack;
  }
  res.status(500).json(body);
}
