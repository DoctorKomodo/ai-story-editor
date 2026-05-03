// backend/tests/routes/error-handler.test.ts
//
// Asserts the global error handler's NODE_ENV gating:
//   - `stack` is included in the JSON body when NODE_ENV !== 'production'
//   - `stack` is omitted when NODE_ENV === 'production'
//
// We can't install a route on the existing app easily, so we mount the same
// `globalErrorHandler` export onto a disposable Express instance and trigger
// a deliberate throw.

import express from 'express';
import request from 'supertest';
import { afterEach, describe, expect, it } from 'vitest';
import { globalErrorHandler } from '../../src/index';

function buildApp(): express.Express {
  const app = express();
  app.get('/boom', (_req, _res, next) => {
    next(new Error('kaboom'));
  });
  app.use(globalErrorHandler);
  return app;
}

describe('globalErrorHandler stack gating', () => {
  const originalEnv = process.env.NODE_ENV;

  afterEach(() => {
    process.env.NODE_ENV = originalEnv;
  });

  it('includes a stack in the JSON body when NODE_ENV !== production', async () => {
    process.env.NODE_ENV = 'development';
    const res = await request(buildApp()).get('/boom');
    expect(res.status).toBe(500);
    expect(res.body.error.code).toBe('internal_error');
    expect(typeof res.body.error.stack).toBe('string');
    expect(res.body.error.stack).toContain('kaboom');
  });

  it('omits stack when NODE_ENV === production', async () => {
    process.env.NODE_ENV = 'production';
    const res = await request(buildApp()).get('/boom');
    expect(res.status).toBe(500);
    expect(res.body.error.code).toBe('internal_error');
    expect(res.body.error.message).toBe('Internal server error');
    expect('stack' in res.body.error).toBe(false);
  });
});
