import type { Response } from 'express';
import { describe, expect, it, vi } from 'vitest';
import { badRequest } from '../../src/lib/bad-request';

describe('badRequest', () => {
  it('emits canonical envelope with synthesised issues array', () => {
    const json = vi.fn();
    const status = vi.fn(() => ({ json }));
    const res = { status } as unknown as Response;

    badRequest(res, 'Duplicate id', ['chapters', 0, 'id']);

    expect(status).toHaveBeenCalledWith(400);
    expect(json).toHaveBeenCalledWith({
      error: {
        message: 'Duplicate id',
        code: 'validation_error',
        issues: [{ path: ['chapters', 0, 'id'], message: 'Duplicate id' }],
      },
    });
  });

  it('accepts an empty path array', () => {
    const json = vi.fn();
    const status = vi.fn(() => ({ json }));
    const res = { status } as unknown as Response;

    badRequest(res, 'Top-level error', []);

    expect(json).toHaveBeenCalledWith({
      error: {
        message: 'Top-level error',
        code: 'validation_error',
        issues: [{ path: [], message: 'Top-level error' }],
      },
    });
  });

  it('accepts numeric path segments', () => {
    const json = vi.fn();
    const status = vi.fn(() => ({ json }));
    const res = { status } as unknown as Response;

    badRequest(res, 'Bad index', [0, 1, 2]);

    expect(json).toHaveBeenCalledWith({
      error: {
        message: 'Bad index',
        code: 'validation_error',
        issues: [{ path: [0, 1, 2], message: 'Bad index' }],
      },
    });
  });
});
