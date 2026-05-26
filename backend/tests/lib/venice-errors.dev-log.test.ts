import { APIError } from 'openai';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { logVeniceErrorDev, type VeniceRequestSnapshot } from '../../src/lib/venice-errors';

describe('logVeniceErrorDev', () => {
  let errSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.stubEnv('NODE_ENV', 'development');
    errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    errSpy.mockRestore();
  });

  function snapshot(): VeniceRequestSnapshot {
    return {
      model: 'llama-3.1-70b',
      messageCount: 2,
      systemMessagePreview: 'You are an expert creative-writing assistant',
      userMessagePreview: 'Continue from: she turned and ran.',
      venice_parameters: { include_venice_system_prompt: true, strip_thinking_response: true },
      response_format: { type: 'json_schema' },
      promptCacheKey: 'abc123',
      temperature: 0.7,
      top_p: 0.95,
      max_completion_tokens: 4096,
    };
  }

  it('does not log in production', () => {
    vi.stubEnv('NODE_ENV', 'production');
    logVeniceErrorDev({
      err: new Error('boom'),
      ctx: { userId: 'u1', route: 'ai-complete' },
    });
    expect(errSpy).not.toHaveBeenCalled();
  });

  it('logs [venice.error.dev] with class, name, message, stack for non-APIError', () => {
    const err = new TypeError('oops');
    logVeniceErrorDev({ err, ctx: { userId: 'u1', route: 'chat' } });
    expect(errSpy).toHaveBeenCalledOnce();
    expect(errSpy.mock.calls[0]?.[0]).toBe('[venice.error.dev]');
    const payload = errSpy.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(payload.route).toBe('chat');
    expect(payload.errorClass).toBe('TypeError');
    expect(payload.errorName).toBe('TypeError');
    expect(payload.errorMessage).toBe('oops');
    expect(typeof payload.stack).toBe('string');
    // No upstream fields for non-APIError.
    expect(payload).not.toHaveProperty('upstreamStatus');
    expect(payload).not.toHaveProperty('upstreamBody');
  });

  it('logs upstream status + headers + body for APIError', () => {
    const headers = new Headers();
    headers.set('x-request-id', 'req-1');
    headers.set('x-ratelimit-remaining-requests', '5');
    headers.set('set-cookie', 'should-not-appear');
    const err = new APIError(
      429,
      { error: { message: 'rate limited', code: 'too_many' } } as never,
      'rate limited',
      headers,
    );
    logVeniceErrorDev({ err, ctx: { userId: 'u1', route: 'ai-complete' } });
    const payload = errSpy.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(payload.upstreamStatus).toBe(429);
    expect((payload.upstreamHeaders as Record<string, string>)['x-request-id']).toBe('req-1');
    expect(
      (payload.upstreamHeaders as Record<string, string>)['x-ratelimit-remaining-requests'],
    ).toBe('5');
    expect(payload.upstreamHeaders).not.toHaveProperty('set-cookie');
    expect(payload.upstreamBody).toMatchObject({
      error: { message: 'rate limited', code: 'too_many' },
    });
  });

  it('scrubs sk-* tokens in upstream body, headers, request snapshot', () => {
    const headers = new Headers();
    headers.set('x-request-id', 'sk-leak123abcdef456789xyz');
    const err = new APIError(
      400,
      { error: { message: 'check this key: sk-toxic000111222333444', code: 'bad' } } as never,
      'bad',
      headers,
    );
    const snap = snapshot();
    snap.systemMessagePreview = 'leaked key: sk-foobar123456789abcdef';
    logVeniceErrorDev({ err, ctx: { userId: 'u1', route: 'ai-complete' }, request: snap });
    const payload = errSpy.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(JSON.stringify(payload)).not.toContain('sk-leak');
    expect(JSON.stringify(payload)).not.toContain('sk-toxic');
    expect(JSON.stringify(payload)).not.toContain('sk-foobar');
    expect(JSON.stringify(payload)).toContain('[redacted]');
  });

  it('includes rawContent when supplied', () => {
    logVeniceErrorDev({
      err: new SyntaxError('parse fail'),
      ctx: { userId: 'u1', route: 'chapter-summarise' },
      rawContent: '{"events":"truncated by token limit',
    });
    const payload = errSpy.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(payload.rawContent).toBe('{"events":"truncated by token limit');
  });

  it('omits rawContent when not supplied', () => {
    logVeniceErrorDev({ err: new Error('e'), ctx: { userId: 'u1', route: 'ai-complete' } });
    const payload = errSpy.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(payload).not.toHaveProperty('rawContent');
  });

  it('caps a 50KB upstreamBody at 8KB with a truncation marker', () => {
    const big = 'A'.repeat(50_000);
    const err = new APIError(500, { error: { message: big } } as never, 'big', new Headers());
    logVeniceErrorDev({ err, ctx: { userId: 'u1', route: 'ai-complete' } });
    const payload = errSpy.mock.calls[0]?.[1] as Record<string, unknown>;
    const dump = JSON.stringify(payload.upstreamBody);
    expect(dump.length).toBeLessThanOrEqual(8 * 1024 + 100); // 8KB + marker overhead
    expect(dump).toMatch(/truncated, original \d+ bytes/);
  });

  it('caps a long rawContent at 8KB with a truncation marker', () => {
    const big = 'X'.repeat(20_000);
    logVeniceErrorDev({
      err: new Error('parse'),
      ctx: { userId: 'u1', route: 'chapter-summarise' },
      rawContent: big,
    });
    const payload = errSpy.mock.calls[0]?.[1] as Record<string, unknown>;
    expect((payload.rawContent as string).length).toBeLessThanOrEqual(8 * 1024 + 100);
    expect(payload.rawContent).toMatch(/truncated, original \d+ bytes/);
  });
});
