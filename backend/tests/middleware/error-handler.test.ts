import express, { type NextFunction, type Request, type Response } from 'express';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { globalErrorHandler } from '../../src/index';
import { NoVeniceKeyError } from '../../src/lib/venice';
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
      error: { message: 'venice_key_required', code: 'venice_key_required' },
    });
  });

  it('never leaks a stack trace for NoVeniceKeyError either', async () => {
    const res = await request(makeApp(new NoVeniceKeyError())).get('/boom');
    expect(res.body).not.toHaveProperty('stack');
    expect(res.body.error).not.toHaveProperty('stack');
    expect(JSON.stringify(res.body)).not.toMatch(/\s+at\s.*\(.*:\d+:\d+\)/);
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
});
