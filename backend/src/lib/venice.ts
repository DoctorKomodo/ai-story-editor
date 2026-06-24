// Single ingress to the Venice.ai OpenAI-compatible API. Pure client factory:
// no DB, no DEK, no crypto. The caller (venice-key.service) loads + decrypts the
// per-user BYOK key and hands the plaintext in for the lifetime of one request.

import OpenAI, { type ClientOptions } from 'openai';

export const DEFAULT_VENICE_BASE_URL = 'https://api.venice.ai/api/v1';

export interface VeniceClientOptions {
  apiKey: string;
  endpoint?: string | null;
}

export class NoVeniceKeyError extends Error {
  readonly code = 'venice_key_required';
  constructor(message = 'No Venice API key is configured for this user.') {
    super(message);
    this.name = 'NoVeniceKeyError';
  }
}

export function createVeniceClient({ apiKey, endpoint }: VeniceClientOptions): OpenAI {
  if (!apiKey) {
    throw new NoVeniceKeyError();
  }
  return new OpenAI({
    apiKey,
    baseURL: endpoint && endpoint.length > 0 ? endpoint : DEFAULT_VENICE_BASE_URL,
    // Rebinds transport to the current globalThis.fetch so tests can stub it
    // (vi.stubGlobal) and so the SDK doesn't fall back to its bundled node-fetch.
    // Resolved lazily per-call so stubs stay live across a test's lifetime.
    fetch: ((url: string, init?: RequestInit) =>
      globalThis.fetch(url, init)) as unknown as ClientOptions['fetch'],
    // Don't let the SDK silently retry 429s — that burns the user's Venice
    // rate-limit quota and exhausts globalThis.fetch mock stubs in tests.
    maxRetries: 0,
  });
}
