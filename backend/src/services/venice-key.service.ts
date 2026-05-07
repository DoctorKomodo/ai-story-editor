import type { PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { prisma as defaultPrisma } from '../lib/prisma';
import { parseRetryAfter } from '../lib/venice-errors';
import { decrypt, encrypt } from './crypto.service';

export const DEFAULT_VENICE_ENDPOINT = 'https://api.venice.ai/api/v1';

export interface VeniceKeyStatus {
  hasKey: boolean;
  lastSix: string | null;
  endpoint: string | null;
}

export interface VeniceAccountResult {
  verified: boolean;
  balanceUsd: number | null;
  diem: number | null;
  endpoint: string | null;
  lastSix: string | null;
}

export class VeniceKeyInvalidError extends Error {
  constructor() {
    super('Venice API key was rejected by Venice');
    this.name = 'VeniceKeyInvalidError';
  }
}

export class VeniceKeyCheckError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'VeniceKeyCheckError';
  }
}

export class VeniceAccountRateLimitedError extends Error {
  constructor(
    public readonly retryAfterSeconds: number | null,
    public readonly upstreamStatus: number,
  ) {
    super('Venice rate-limited the account-info probe');
    this.name = 'VeniceAccountRateLimitedError';
  }
}

export class VeniceAccountUnavailableError extends Error {
  constructor(public readonly upstreamStatus: number | null) {
    super('Venice account-info probe failed');
    this.name = 'VeniceAccountUnavailableError';
  }
}

// Extract the USD / DIEM balances from the rate_limits response body. The
// body shape is `{ data: { balances: { USD: number, DIEM: number, ... } } }`.
// Returns nulls when the body doesn't match — verified:true is still useful
// to display even without numeric balances.
function readBalances(body: unknown): { usd: number | null; diem: number | null } {
  if (typeof body !== 'object' || body === null) return { usd: null, diem: null };
  const data = (body as { data?: unknown }).data;
  if (typeof data !== 'object' || data === null) return { usd: null, diem: null };
  const balances = (data as { balances?: unknown }).balances;
  if (typeof balances !== 'object' || balances === null) return { usd: null, diem: null };
  const usdRaw = (balances as Record<string, unknown>).USD;
  const diemRaw = (balances as Record<string, unknown>).DIEM;
  return {
    usd: typeof usdRaw === 'number' && Number.isFinite(usdRaw) ? usdRaw : null,
    diem: typeof diemRaw === 'number' && Number.isFinite(diemRaw) ? diemRaw : null,
  };
}

export const storeVeniceKeyInputSchema = z.object({
  apiKey: z
    .string()
    .transform((v) => v.trim())
    .pipe(z.string().min(1, 'apiKey is required')),
  endpoint: z
    .string()
    .transform((v) => v.trim())
    .pipe(z.string().url({ message: 'endpoint must be a URL' }))
    .optional(),
});

export type StoreVeniceKeyInput = z.infer<typeof storeVeniceKeyInputSchema>;

export interface VeniceKeyServiceDeps {
  client?: PrismaClient;
  fetchFn?: typeof fetch;
}

function lastSixOf(apiKey: string): string {
  return apiKey.slice(-6);
}

function resolveEndpoint(endpoint: string | null | undefined): string {
  if (endpoint && endpoint.length > 0) return endpoint;
  return DEFAULT_VENICE_ENDPOINT;
}

export function createVeniceKeyService(deps: VeniceKeyServiceDeps = {}) {
  const client = deps.client ?? defaultPrisma;

  async function validateAgainstVenice(apiKey: string, endpoint: string): Promise<void> {
    // Resolve fetch per-call so tests can stub globalThis.fetch after service
    // construction without having to pass it through deps.
    const fetchFn = deps.fetchFn ?? globalThis.fetch;
    const url = `${endpoint.replace(/\/$/, '')}/models`;
    let response: Response;
    try {
      response = await fetchFn(url, {
        method: 'GET',
        headers: { Authorization: `Bearer ${apiKey}` },
      });
    } catch {
      // Intentionally drop the user-supplied endpoint and the upstream error
      // message — a crafted endpoint like https://user:pass@host could leak
      // credentials via the error message in non-production responses.
      throw new VeniceKeyCheckError('Unable to reach Venice endpoint');
    }

    if (response.status === 401 || response.status === 403) {
      throw new VeniceKeyInvalidError();
    }
    if (!response.ok) {
      throw new VeniceKeyCheckError(`Venice responded ${response.status} ${response.statusText}`);
    }
  }

  interface StatusAndKey {
    hasKey: boolean;
    lastSix: string | null;
    endpoint: string | null;
    apiKey: string | null; // plaintext, request-scoped
  }

  async function getStatusAndKey(userId: string): Promise<StatusAndKey> {
    const row = await client.user.findUnique({
      where: { id: userId },
      select: {
        veniceApiKeyEnc: true,
        veniceApiKeyIv: true,
        veniceApiKeyAuthTag: true,
        veniceEndpoint: true,
      },
    });

    if (!row?.veniceApiKeyEnc || !row.veniceApiKeyIv || !row.veniceApiKeyAuthTag) {
      return { hasKey: false, lastSix: null, endpoint: null, apiKey: null };
    }

    const apiKey = decrypt({
      ciphertext: row.veniceApiKeyEnc,
      iv: row.veniceApiKeyIv,
      authTag: row.veniceApiKeyAuthTag,
    });

    return {
      hasKey: true,
      lastSix: lastSixOf(apiKey),
      endpoint: row.veniceEndpoint ?? DEFAULT_VENICE_ENDPOINT,
      apiKey,
    };
  }

  async function getStatus(userId: string): Promise<VeniceKeyStatus> {
    const { hasKey, lastSix, endpoint } = await getStatusAndKey(userId);
    return { hasKey, lastSix, endpoint };
  }

  async function store(userId: string, rawInput: unknown): Promise<VeniceKeyStatus> {
    const input = storeVeniceKeyInputSchema.parse(rawInput);
    const endpoint = resolveEndpoint(input.endpoint);

    await validateAgainstVenice(input.apiKey, endpoint);

    const payload = encrypt(input.apiKey);

    await client.user.update({
      where: { id: userId },
      data: {
        veniceApiKeyEnc: payload.ciphertext,
        veniceApiKeyIv: payload.iv,
        veniceApiKeyAuthTag: payload.authTag,
        veniceEndpoint: input.endpoint ?? null,
      },
    });

    return {
      hasKey: true,
      lastSix: lastSixOf(input.apiKey),
      endpoint: input.endpoint ?? DEFAULT_VENICE_ENDPOINT,
    };
  }

  async function remove(userId: string): Promise<void> {
    await client.user.update({
      where: { id: userId },
      data: {
        veniceApiKeyEnc: null,
        veniceApiKeyIv: null,
        veniceApiKeyAuthTag: null,
        veniceEndpoint: null,
      },
    });
  }

  // [X32] Unified Venice account-info probe. Calls GET /api_keys/rate_limits
  // (Venice's account-info endpoint) and reads `data.balances.{USD,DIEM}` from
  // the JSON body. Replaces the old `verify()` (V18) which read non-existent
  // `x-venice-balance-*` headers off /v1/models.
  //
  // On 401/403, returns verified:false rather than throwing — the Settings UI
  // must show "Not verified" without treating it as a crash. 429 / 5xx surface
  // as typed errors with `upstreamStatus` carried through to the route's error
  // body so the frontend's DevErrorOverlay can render it for triage.
  async function getAccount(userId: string): Promise<VeniceAccountResult> {
    const { hasKey, lastSix, endpoint, apiKey } = await getStatusAndKey(userId);

    if (!hasKey || apiKey === null) {
      return { verified: false, balanceUsd: null, diem: null, endpoint: null, lastSix: null };
    }

    const fetchFn = deps.fetchFn ?? globalThis.fetch;
    const baseEndpoint = endpoint ?? DEFAULT_VENICE_ENDPOINT;
    const url = `${baseEndpoint.replace(/\/$/, '')}/api_keys/rate_limits`;

    let response: Response;
    try {
      response = await fetchFn(url, {
        method: 'GET',
        headers: { Authorization: `Bearer ${apiKey}` },
      });
    } catch {
      console.error('[X32] Venice rate_limits probe failed (transport) for user', userId);
      throw new VeniceAccountUnavailableError(null);
    }

    if (response.status === 401 || response.status === 403) {
      return {
        verified: false,
        balanceUsd: null,
        diem: null,
        endpoint,
        lastSix,
      };
    }

    if (response.status === 429) {
      console.error('[X32] Venice rate_limits probe returned', response.status, 'for user', userId);
      throw new VeniceAccountRateLimitedError(parseRetryAfter(response.headers), 429);
    }

    if (!response.ok) {
      console.error('[X32] Venice rate_limits probe returned', response.status, 'for user', userId);
      throw new VeniceAccountUnavailableError(response.status);
    }

    let body: unknown;
    try {
      body = await response.json();
    } catch {
      console.error('[X32] Venice rate_limits probe failed (json parse) for user', userId);
      throw new VeniceAccountUnavailableError(response.status);
    }

    const balances = readBalances(body);
    return {
      verified: true,
      balanceUsd: balances.usd,
      diem: balances.diem,
      endpoint,
      lastSix,
    };
  }

  return { getStatus, store, remove, validateAgainstVenice, getAccount };
}

export const veniceKeyService = createVeniceKeyService();
