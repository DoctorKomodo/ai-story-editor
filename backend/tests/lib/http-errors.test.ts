import { describe, expect, it } from 'vitest';
import { forbidden, HttpError, notFound, unauthorized } from '../../src/lib/http-errors';

describe('HttpError', () => {
  it('carries status/code/message and is an instanceof Error and HttpError', () => {
    const err = new HttpError(418, 'teapot', "I'm a teapot");
    expect(err.status).toBe(418);
    expect(err.code).toBe('teapot');
    expect(err.message).toBe("I'm a teapot");
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(HttpError);
  });
});

describe('notFound()', () => {
  it('defaults to 404 not_found "Not found"', () => {
    const err = notFound();
    expect(err.status).toBe(404);
    expect(err.code).toBe('not_found');
    expect(err.message).toBe('Not found');
  });

  it('accepts a custom message', () => {
    const err = notFound('Chapter not found');
    expect(err.status).toBe(404);
    expect(err.code).toBe('not_found');
    expect(err.message).toBe('Chapter not found');
  });
});

describe('forbidden()', () => {
  it('defaults to 403 forbidden "Forbidden"', () => {
    const err = forbidden();
    expect(err.status).toBe(403);
    expect(err.code).toBe('forbidden');
    expect(err.message).toBe('Forbidden');
  });

  it('accepts a custom message', () => {
    const err = forbidden('Not your story');
    expect(err.status).toBe(403);
    expect(err.code).toBe('forbidden');
    expect(err.message).toBe('Not your story');
  });
});

describe('unauthorized()', () => {
  it('is 401 unauthorized "Unauthorized"', () => {
    const err = unauthorized();
    expect(err.status).toBe(401);
    expect(err.code).toBe('unauthorized');
    expect(err.message).toBe('Unauthorized');
  });
});
