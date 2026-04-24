import OpenAI from 'openai';
import { describe, expect, it } from 'vitest';
import {
  createVeniceClient,
  DEFAULT_VENICE_BASE_URL,
  NoVeniceKeyError,
} from '../../src/lib/venice';

describe('lib/venice', () => {
  it('exposes the documented default base URL', () => {
    expect(DEFAULT_VENICE_BASE_URL).toBe('https://api.venice.ai/api/v1');
  });

  it('builds an OpenAI-compatible client against the Venice base URL', () => {
    const client = createVeniceClient({ apiKey: 'sk-test-user-key' });
    expect(client).toBeInstanceOf(OpenAI);
    expect(String(client.baseURL)).toContain(DEFAULT_VENICE_BASE_URL);
  });

  it('honours a per-user endpoint override', () => {
    const client = createVeniceClient({
      apiKey: 'sk-test-user-key',
      endpoint: 'https://venice.my-self-hosted.example/api/v1',
    });
    expect(String(client.baseURL)).toContain('my-self-hosted.example');
  });

  it('falls back to the default URL when endpoint is null or empty', () => {
    const clientNull = createVeniceClient({ apiKey: 'sk-k', endpoint: null });
    const clientEmpty = createVeniceClient({ apiKey: 'sk-k', endpoint: '' });
    expect(String(clientNull.baseURL)).toContain(DEFAULT_VENICE_BASE_URL);
    expect(String(clientEmpty.baseURL)).toContain(DEFAULT_VENICE_BASE_URL);
  });

  it('throws NoVeniceKeyError when apiKey is missing', () => {
    expect(() => createVeniceClient({ apiKey: '' })).toThrow(NoVeniceKeyError);
    try {
      createVeniceClient({ apiKey: '' });
    } catch (err) {
      expect((err as NoVeniceKeyError).code).toBe('venice_key_required');
    }
  });

  it('never caches a client across calls — each call builds a fresh instance', () => {
    const a = createVeniceClient({ apiKey: 'user-a-key' });
    const b = createVeniceClient({ apiKey: 'user-b-key' });
    expect(a).not.toBe(b);
  });
});
