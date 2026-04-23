// Single ingress to the Venice.ai API. No other file imports `openai` directly.
//
// Venice is OpenAI API-compatible; we construct an `openai` client pointed at
// Venice's base URL. Per CLAUDE.md + docs/venice-integration.md, there is no
// server-wide Venice key — callers pass a per-user decrypted key + optional
// endpoint override ([AU12] stores it, [V17] decrypts it per request). This
// module intentionally does NOT cache clients across users; each call builds a
// fresh instance bound to exactly one user's credentials.

import type { PrismaClient } from '@prisma/client';
import OpenAI from 'openai';
import { prisma as defaultPrisma } from './prisma';
import { decrypt } from '../services/crypto.service';

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
    // Route through globalThis.fetch (native fetch on Node 18+) instead of
    // the SDK's bundled node-fetch. Keeps the HTTP path consistent with
    // venice-key.service, which also uses globalThis.fetch, and makes the
    // transport rebindable (e.g. vi.stubGlobal in tests). Resolved lazily
    // per-call so the stubbing stays live across the lifetime of a test.
    fetch: (url, init) => globalThis.fetch(url as string, init as RequestInit),
  });
}

// --- [V17] Per-user Venice client ----------------------------------------
//
// Given a userId, read the BYOK columns off the User row, decrypt the stored
// Venice API key via [AU11] crypto.service.decrypt, and construct a fresh
// `openai` instance bound to that key + endpoint. A missing row, or any null
// ciphertext column, throws `NoVeniceKeyError` — controllers map that to
// 409 { error: "venice_key_required" } with a hint pointing at
// /settings#venice.
//
// NOT cached. Each call re-reads the DB and builds a new OpenAI instance —
// the decrypted plaintext key exists only for the duration of this function
// and is handed straight to the OpenAI client. It is never logged, stored in
// a module variable, or closed over beyond this scope. If a future change
// introduces a session-level cache, it MUST be keyed by userId + sessionId
// and MUST not outlive the session.

export interface GetVeniceClientDeps {
  client?: PrismaClient;
  // Injection seam for tests: override how the OpenAI instance is built so
  // tests can prove non-caching and assert the decrypted key flowed through.
  // Defaults to `createVeniceClient` above.
  buildClient?: (options: VeniceClientOptions) => OpenAI;
}

export function createGetVeniceClient(deps: GetVeniceClientDeps = {}) {
  const client = deps.client ?? defaultPrisma;
  const buildClient = deps.buildClient ?? createVeniceClient;

  return async function getVeniceClient(userId: string): Promise<OpenAI> {
    const row = await client.user.findUnique({
      where: { id: userId },
      select: {
        veniceApiKeyEnc: true,
        veniceApiKeyIv: true,
        veniceApiKeyAuthTag: true,
        veniceEndpoint: true,
      },
    });

    if (
      !row ||
      !row.veniceApiKeyEnc ||
      !row.veniceApiKeyIv ||
      !row.veniceApiKeyAuthTag
    ) {
      throw new NoVeniceKeyError();
    }

    // Plaintext key lives only in this local. Handed straight to buildClient
    // below; not logged, not re-thrown, not attached to any error.
    const apiKey = decrypt({
      ciphertext: row.veniceApiKeyEnc,
      iv: row.veniceApiKeyIv,
      authTag: row.veniceApiKeyAuthTag,
    });

    return buildClient({ apiKey, endpoint: row.veniceEndpoint });
  };
}

export const getVeniceClient = createGetVeniceClient();
