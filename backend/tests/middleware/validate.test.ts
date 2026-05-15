import type { NextFunction, Request, Response } from 'express';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { validateBody, validateQuery } from '../../src/middleware/validate.js';

function makeMocks(
  body: unknown,
  query: unknown = {},
): {
  req: Request;
  res: Response;
  next: NextFunction;
  status: ReturnType<typeof vi.fn>;
  json: ReturnType<typeof vi.fn>;
} {
  const json = vi.fn();
  const status = vi.fn(() => ({ json })) as unknown as Response['status'];
  const res = { status } as unknown as Response;
  const req = { body, query } as Request;
  const next = vi.fn() as unknown as NextFunction;
  return { req, res, next, status: status as unknown as ReturnType<typeof vi.fn>, json };
}

const fooSchema = z.strictObject({ foo: z.string() });

describe('validateBody', () => {
  it('invokes handler with parsed body on valid input', async () => {
    const handler = vi.fn();
    const mw = validateBody(fooSchema, async (body) => {
      handler(body);
    });
    const { req, res, next } = makeMocks({ foo: 'hello' });
    mw(req, res, next);
    await new Promise((r) => setImmediate(r));
    expect(handler).toHaveBeenCalledWith({ foo: 'hello' });
    expect(next).not.toHaveBeenCalled();
  });

  it('returns 400 with canonical envelope on invalid input; handler not invoked', async () => {
    const handler = vi.fn();
    const mw = validateBody(fooSchema, async (body) => {
      handler(body);
    });
    const { req, res, next, status, json } = makeMocks({ wrongKey: 1 });
    mw(req, res, next);
    await new Promise((r) => setImmediate(r));
    expect(handler).not.toHaveBeenCalled();
    expect(status).toHaveBeenCalledWith(400);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({
        error: expect.objectContaining({
          code: 'validation_error',
          issues: expect.any(Array),
        }),
      }),
    );
  });

  it('returns 400 on strict-extra-key violation', async () => {
    const handler = vi.fn();
    const mw = validateBody(fooSchema, async (body) => {
      handler(body);
    });
    const { req, res, next, status } = makeMocks({ foo: 'hello', extra: 1 });
    mw(req, res, next);
    await new Promise((r) => setImmediate(r));
    expect(handler).not.toHaveBeenCalled();
    expect(status).toHaveBeenCalledWith(400);
  });

  it('does not call next when async handler resolves', async () => {
    const mw = validateBody(fooSchema, async () => {});
    const { req, res, next } = makeMocks({ foo: 'hello' });
    mw(req, res, next);
    await new Promise((r) => setImmediate(r));
    expect(next).not.toHaveBeenCalled();
  });

  it('calls next(err) when async handler rejects', async () => {
    const err = new Error('boom');
    const mw = validateBody(fooSchema, async () => {
      throw err;
    });
    const { req, res, next } = makeMocks({ foo: 'hello' });
    mw(req, res, next);
    await new Promise((r) => setImmediate(r));
    expect(next).toHaveBeenCalledWith(err);
  });

  it('calls next(err) when sync handler throws', async () => {
    const err = new Error('sync boom');
    const mw = validateBody(fooSchema, () => {
      throw err;
    });
    const { req, res, next } = makeMocks({ foo: 'hello' });
    mw(req, res, next);
    await new Promise((r) => setImmediate(r));
    expect(next).toHaveBeenCalledWith(err);
  });
});

const queryFooSchema = z.strictObject({ kind: z.enum(['ask', 'scene']).optional() });

describe('validateQuery', () => {
  it('invokes handler with parsed query on valid input', async () => {
    const handler = vi.fn();
    const mw = validateQuery(queryFooSchema, async (query) => {
      handler(query);
    });
    const { req, res, next } = makeMocks({}, { kind: 'ask' });
    mw(req, res, next);
    await new Promise((r) => setImmediate(r));
    expect(handler).toHaveBeenCalledWith({ kind: 'ask' });
    expect(next).not.toHaveBeenCalled();
  });

  it('returns 400 with canonical envelope on invalid query', async () => {
    const handler = vi.fn();
    const mw = validateQuery(queryFooSchema, async (query) => {
      handler(query);
    });
    const { req, res, next, status, json } = makeMocks({}, { kind: 'archived' });
    mw(req, res, next);
    await new Promise((r) => setImmediate(r));
    expect(handler).not.toHaveBeenCalled();
    expect(status).toHaveBeenCalledWith(400);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({
        error: expect.objectContaining({ code: 'validation_error' }),
      }),
    );
  });

  it('returns 400 on strict-extra-key in query', async () => {
    const handler = vi.fn();
    const mw = validateQuery(queryFooSchema, async (query) => {
      handler(query);
    });
    const { req, res, next, status } = makeMocks({}, { kind: 'ask', extra: '1' });
    mw(req, res, next);
    await new Promise((r) => setImmediate(r));
    expect(handler).not.toHaveBeenCalled();
    expect(status).toHaveBeenCalledWith(400);
  });

  it('does not call next when async handler resolves', async () => {
    const mw = validateQuery(queryFooSchema, async () => {});
    const { req, res, next } = makeMocks({}, { kind: 'ask' });
    mw(req, res, next);
    await new Promise((r) => setImmediate(r));
    expect(next).not.toHaveBeenCalled();
  });

  it('calls next(err) when async handler rejects', async () => {
    const err = new Error('query boom');
    const mw = validateQuery(queryFooSchema, async () => {
      throw err;
    });
    const { req, res, next } = makeMocks({}, { kind: 'ask' });
    mw(req, res, next);
    await new Promise((r) => setImmediate(r));
    expect(next).toHaveBeenCalledWith(err);
  });

  it('calls next(err) when sync handler throws', async () => {
    const err = new Error('query sync boom');
    const mw = validateQuery(queryFooSchema, () => {
      throw err;
    });
    const { req, res, next } = makeMocks({}, { kind: 'ask' });
    mw(req, res, next);
    await new Promise((r) => setImmediate(r));
    expect(next).toHaveBeenCalledWith(err);
  });
});

// Type-level proofs — never executed; @ts-expect-error catches regressions
// to the schema↔handler generic linkage.
void function _typecheck() {
  validateBody(z.object({ foo: z.string() }), async (body) => {
    const _foo: string = body.foo;
    // @ts-expect-error — `bar` is not on the inferred type.
    const _bar: string = body.bar;
    void _foo;
    void _bar;
  });
  validateQuery(z.object({ kind: z.enum(['ask', 'scene']) }), async (query) => {
    const _kind: 'ask' | 'scene' = query.kind;
    // @ts-expect-error — wrong literal narrowing.
    const _wrong: 'archived' = query.kind;
    void _kind;
    void _wrong;
  });
};
