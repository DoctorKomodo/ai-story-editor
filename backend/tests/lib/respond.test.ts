import type { Response } from 'express';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { respond } from '../../src/lib/respond';

function fakeRes(): Response & { _body?: unknown; _status?: number } {
  const res = {
    _status: 200,
    _body: undefined as unknown,
    status(s: number) {
      res._status = s;
      return res;
    },
    json(body: unknown) {
      res._body = body;
      return res;
    },
  };
  return res as unknown as Response & { _body?: unknown; _status?: number };
}

const schema = z.strictObject({ hello: z.string() });

describe('respond()', () => {
  it('parses in non-production and surfaces ZodError on drift', () => {
    const prev = process.env.NODE_ENV;
    process.env.NODE_ENV = 'development';
    try {
      const res = fakeRes();
      expect(() => respond(schema, res, { hello: 1 } as never)).toThrow();
    } finally {
      process.env.NODE_ENV = prev;
    }
  });

  it('skips parse in production and writes the body as-is', () => {
    const prev = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
      const res = fakeRes();
      // Intentionally invalid body — should NOT throw in prod.
      respond(schema, res, { hello: 1 } as never);
      expect(res._body).toEqual({ hello: 1 });
      expect(res._status).toBe(200);
    } finally {
      process.env.NODE_ENV = prev;
    }
  });

  it('passes through valid bodies in non-production with default 200 status', () => {
    const prev = process.env.NODE_ENV;
    process.env.NODE_ENV = 'development';
    try {
      const res = fakeRes();
      respond(schema, res, { hello: 'world' });
      expect(res._body).toEqual({ hello: 'world' });
      expect(res._status).toBe(200);
    } finally {
      process.env.NODE_ENV = prev;
    }
  });

  it('respects the status argument', () => {
    const prev = process.env.NODE_ENV;
    process.env.NODE_ENV = 'development';
    try {
      const res = fakeRes();
      respond(schema, res, { hello: 'world' }, 201);
      expect(res._status).toBe(201);
    } finally {
      process.env.NODE_ENV = prev;
    }
  });
});
