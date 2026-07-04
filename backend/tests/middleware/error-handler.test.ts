import express, { type NextFunction, type Request, type Response } from 'express';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { globalErrorHandler } from '../../src/index';
import { forbidden, HttpError, notFound } from '../../src/lib/http-errors';
import { NoVeniceKeyError } from '../../src/lib/venice';
import { ChapterNotOwnedError } from '../../src/repos/chapter.repo';
import { CharacterNotOwnedError } from '../../src/repos/character.repo';
import { OutlineNotOwnedError } from '../../src/repos/outline.repo';
import { InvalidCredentialsError, UsernameUnavailableError } from '../../src/services/auth.service';
import { DekNotAvailableError } from '../../src/services/content-crypto.service';
import { UnknownModelError } from '../../src/services/venice.models.service';
import { VeniceKeyCheckError, VeniceKeyInvalidError } from '../../src/services/venice-key.service';
import '../setup';

// Isolated mini-app: Express dispatches middleware in registration order, so
// routes added after `app.use(globalErrorHandler)` on the real app would sit
// past the error handler and never feed it. Building a disposable app keeps
// the contract tests honest and avoids cross-test interference.
function makeApp(throwValue: unknown): express.Express {
  const app = express();
  app.get('/boom', (_req: Request, _res: Response, next: NextFunction) => {
    next(throwValue);
  });
  app.use(globalErrorHandler);
  return app;
}

describe('globalErrorHandler [B7]', () => {
  it('maps an unknown Error to HTTP 500 with the envelope shape', async () => {
    const res = await request(makeApp(new Error('boom-message'))).get('/boom');
    expect(res.status).toBe(500);
    expect(res.body).toHaveProperty('error');
    expect(res.body.error).toHaveProperty('message');
    expect(res.body.error).toHaveProperty('code', 'internal_error');
  });

  it('responds with pure JSON — no HTML', async () => {
    const res = await request(makeApp(new Error('boom-message'))).get('/boom');
    expect(res.headers['content-type']).toMatch(/application\/json/);
    // The body must be object-shaped JSON, not an HTML error page.
    expect(typeof res.body).toBe('object');
    expect(res.body).not.toBeNull();
  });

  it('maps NoVeniceKeyError to HTTP 409 with the documented body [V17]', async () => {
    const res = await request(makeApp(new NoVeniceKeyError())).get('/boom');
    expect(res.status).toBe(409);
    expect(res.body).toEqual({
      error: {
        message: 'No Venice API key is stored. Add yours in Settings to enable AI features.',
        code: 'venice_key_required',
      },
    });
  });

  it('never leaks a stack trace for NoVeniceKeyError either', async () => {
    const res = await request(makeApp(new NoVeniceKeyError())).get('/boom');
    expect(res.body).not.toHaveProperty('stack');
    expect(res.body.error).not.toHaveProperty('stack');
    expect(JSON.stringify(res.body)).not.toMatch(/\s+at\s.*\(.*:\d+:\d+\)/);
  });

  it('maps a thrown HttpError to its own status/code/message', async () => {
    const res = await request(makeApp(new HttpError(404, 'not_found', 'Chapter not found'))).get(
      '/boom',
    );
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: { message: 'Chapter not found', code: 'not_found' } });
  });

  it('never includes a stack for mapped errors, even in dev', async () => {
    const err = notFound();
    err.stack = 'Error: x\n    at fake (/tmp/fake.ts:1:1)';
    const res = await request(makeApp(err)).get('/boom');
    expect(JSON.stringify(res.body)).not.toContain('/tmp/fake.ts');
  });

  it('maps ZodError to the badRequestFromZod shape', async () => {
    const zerr = z.object({ title: z.string() }).safeParse({}).error!;
    const res = await request(makeApp(zerr)).get('/boom');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('validation_error');
    expect(res.body.error.message).toBe('Invalid request body');
    expect(Array.isArray(res.body.error.issues)).toBe(true);
  });

  it('maps UnknownModelError to 400 unknown_model', async () => {
    const res = await request(makeApp(new UnknownModelError('no-such-model'))).get('/boom');
    expect(res.status).toBe(400);
    expect(res.body).toEqual({
      error: { message: 'Unknown Venice model: no-such-model', code: 'unknown_model' },
    });
    expect(res.body.error).not.toHaveProperty('stack');
  });

  it('maps InvalidCredentialsError to 401 invalid_credentials', async () => {
    const res = await request(makeApp(new InvalidCredentialsError())).get('/boom');
    expect(res.status).toBe(401);
    expect(res.body).toEqual({
      error: { message: 'Invalid credentials', code: 'invalid_credentials' },
    });
  });

  it('maps UsernameUnavailableError to 409 username_unavailable', async () => {
    const res = await request(makeApp(new UsernameUnavailableError())).get('/boom');
    expect(res.status).toBe(409);
    expect(res.body).toEqual({
      error: { message: 'Username unavailable', code: 'username_unavailable' },
    });
  });

  it('maps VeniceKeyInvalidError to 400 venice_key_invalid', async () => {
    const res = await request(makeApp(new VeniceKeyInvalidError())).get('/boom');
    expect(res.status).toBe(400);
    expect(res.body).toEqual({
      error: { message: 'venice_key_invalid', code: 'venice_key_invalid' },
    });
  });

  it('maps VeniceKeyCheckError to 502 venice_unreachable', async () => {
    const res = await request(makeApp(new VeniceKeyCheckError('upstream down'))).get('/boom');
    expect(res.status).toBe(502);
    expect(res.body).toEqual({
      error: { message: 'venice_unreachable', code: 'venice_unreachable' },
    });
  });

  it.each([
    ['ChapterNotOwnedError', new ChapterNotOwnedError()],
    ['CharacterNotOwnedError', new CharacterNotOwnedError()],
    ['OutlineNotOwnedError', new OutlineNotOwnedError()],
  ])('maps %s to 403 forbidden', async (_name, err) => {
    const res = await request(makeApp(err)).get('/boom');
    expect(res.status).toBe(403);
    expect(res.body).toEqual({ error: { message: 'Forbidden', code: 'forbidden' } });
  });

  it('maps DekNotAvailableError to 401 session_expired (byte-identical to auth.middleware)', async () => {
    const res = await request(makeApp(new DekNotAvailableError())).get('/boom');
    expect(res.status).toBe(401);
    expect(res.body).toEqual({
      error: { message: 'Session expired', code: 'session_expired' },
    });
  });

  it('a mapped HttpError still returns its real message/code in production', async () => {
    const original = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
      const res = await request(makeApp(forbidden('Not your story'))).get('/boom');
      expect(res.status).toBe(403);
      expect(res.body).toEqual({ error: { message: 'Not your story', code: 'forbidden' } });
    } finally {
      process.env.NODE_ENV = original;
    }
  });

  describe('production mode', () => {
    // Flip NODE_ENV for these cases only and restore on teardown — other files
    // in the suite assume the default test env. Vitest default pool runs each
    // file in its own worker, so we don't trample parallel files, but we still
    // restore inside this describe to keep it self-contained.
    const original = process.env.NODE_ENV;

    beforeEach(() => {
      process.env.NODE_ENV = 'production';
    });

    afterEach(() => {
      process.env.NODE_ENV = original;
    });

    it('replaces the real error message with a generic one', async () => {
      const res = await request(makeApp(new Error('leaky-prod-secret'))).get('/boom');
      expect(res.status).toBe(500);
      expect(res.body).toEqual({
        error: { message: 'Internal server error', code: 'internal_error' },
      });
      // Explicit extra check: the raw message must not appear anywhere in the
      // serialized body even under an unexpected nested key.
      expect(JSON.stringify(res.body)).not.toContain('leaky-prod-secret');
    });

    it('still omits any stack trace in production', async () => {
      const err = new Error('leaky-prod-secret');
      // Force a recognisable stack so an accidental leak would be visible.
      err.stack = 'Error: leaky-prod-secret\n    at fake (/tmp/fake.ts:1:1)';
      const res = await request(makeApp(err)).get('/boom');
      expect(res.body).not.toHaveProperty('stack');
      expect(res.body.error).not.toHaveProperty('stack');
      expect(JSON.stringify(res.body)).not.toContain('/tmp/fake.ts');
    });
  });

  describe('non-production (dev/test) mode', () => {
    it("lets the underlying error's message through for ergonomics", async () => {
      // NODE_ENV is 'test' here by default (see tests/setup.ts).
      const res = await request(makeApp(new Error('dev-visible-message'))).get('/boom');
      expect(res.status).toBe(500);
      expect(res.body.error.message).toBe('dev-visible-message');
      expect(res.body.error.code).toBe('internal_error');
    });

    it('includes a stack trace in dev/test mode for debuggability', async () => {
      const err = new Error('dev-visible-message');
      err.stack = 'Error: dev-visible-message\n    at fake (/tmp/fake.ts:1:1)';
      const res = await request(makeApp(err)).get('/boom');
      expect(typeof res.body.error.stack).toBe('string');
      expect(res.body.error.stack).toContain('/tmp/fake.ts');
    });

    it('falls back to a generic message when the thrown value is not an Error', async () => {
      const res = await request(makeApp('a bare string, not an Error')).get('/boom');
      expect(res.status).toBe(500);
      expect(res.body.error.message).toBe('Internal server error');
      expect(res.body.error.code).toBe('internal_error');
    });
  });

  it("dev mode tags the handler's console log with a stable [error-handler.dev] prefix", async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      await request(makeApp(new Error('boom-message'))).get('/boom');
      expect(spy).toHaveBeenCalledWith('[error-handler.dev]', expect.any(Error));
    } finally {
      spy.mockRestore();
    }
  });

  it('production mode does not log the error to the console at all', async () => {
    const original = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      await request(makeApp(new Error('boom-message'))).get('/boom');
      expect(spy).not.toHaveBeenCalled();
    } finally {
      spy.mockRestore();
      process.env.NODE_ENV = original;
    }
  });
});
