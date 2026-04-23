import express, { type NextFunction, type Request, type Response } from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { globalErrorHandler } from '../../src/index';
import { NoVeniceKeyError } from '../../src/lib/venice';
import '../setup';

// Mount the real globalErrorHandler on a throwaway app with a route that
// forwards a NoVeniceKeyError via next(err). We can't add routes to the
// exported `app` after the fact — Express walks middleware in registration
// order, so routes registered post-import would run after the error handler
// in the stack and wouldn't exercise it. Hence the isolated mini-app.
function makeApp() {
  const app = express();
  app.get('/throws/no-venice-key', (_req: Request, _res: Response, next: NextFunction) => {
    next(new NoVeniceKeyError());
  });
  app.get('/throws/other', (_req: Request, _res: Response, next: NextFunction) => {
    next(new Error('something else went wrong'));
  });
  app.use(globalErrorHandler);
  return app;
}

describe('globalErrorHandler — NoVeniceKeyError mapping [V17]', () => {
  it('maps NoVeniceKeyError to HTTP 409 with the documented body', async () => {
    const res = await request(makeApp()).get('/throws/no-venice-key');
    expect(res.status).toBe(409);
    expect(res.body).toEqual({
      error: { message: 'venice_key_required', code: 'venice_key_required' },
    });
  });

  it('still returns 500 for non-Venice errors (catch-all unchanged)', async () => {
    const res = await request(makeApp()).get('/throws/other');
    expect(res.status).toBe(500);
    expect(res.body.error.code).toBe('internal_error');
  });
});
