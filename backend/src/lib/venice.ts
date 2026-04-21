// Single ingress to the Venice.ai API. No other file imports `openai` directly.
//
// Venice is OpenAI API-compatible; we construct an `openai` client pointed at
// Venice's base URL. Per CLAUDE.md + docs/venice-integration.md, there is no
// server-wide Venice key — callers pass a per-user decrypted key + optional
// endpoint override ([AU12] stores it, [V17] decrypts it per request). This
// module intentionally does NOT cache clients across users; each call builds a
// fresh instance bound to exactly one user's credentials.

import OpenAI from 'openai';

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
  });
}
