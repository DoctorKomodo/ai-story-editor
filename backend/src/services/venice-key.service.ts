import type { PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { prisma as defaultPrisma } from '../lib/prisma';
import { decrypt, encrypt } from './crypto.service';

export const DEFAULT_VENICE_ENDPOINT = 'https://api.venice.ai/api/v1';

export interface VeniceKeyStatus {
  hasKey: boolean;
  lastSix: string | null;
  endpoint: string | null;
}

export interface VeniceKeyVerifyResult {
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

// Thrown by verify() when Venice returns 429 on the rate_limits probe. The
// route maps it to HTTP 429 with code:'venice_rate_limited' so the existing
// frontend handling continues to work.
export class VeniceVerifyRateLimitedError extends Error {
  constructor(public readonly retryAfterSeconds: number | null) {
    super('Venice rate-limited the verify probe');
    this.name = 'VeniceVerifyRateLimitedError';
  }
}

// Thrown by verify() for any non-success / non-401 / non-429 outcome
// (network failure, 5xx, malformed JSON). The route maps it to HTTP 502 with
// code:'venice_unavailable'.
export class VeniceVerifyUnavailableError extends Error {
  constructor() {
    super('Venice verify probe failed');
    this.name = 'VeniceVerifyUnavailableError';
  }
}

// Parse `retry-after` (delta-seconds or HTTP-date). Local to the verify path
// — lib/venice-errors.ts has the richer parser used by the streaming/openai
// surface, but here we only need the simple form Venice actually returns.
function parseRetryAfterSeconds(headers: Headers): number | null {
  const raw = headers.get('retry-after');
  if (!raw) return null;
  const asInt = parseInt(raw, 10);
  if (!Number.isNaN(asInt) && String(asInt) === raw.trim()) return asInt > 0 ? asInt : 0;
  const date = Date.parse(raw);
  if (!Number.isNaN(date)) {
    const diff = Math.ceil((date - Date.now()) / 1000);
    return diff > 0 ? diff : 0;
  }
  return null;
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

  async function getStatus(userId: string): Promise<VeniceKeyStatus> {
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
      return { hasKey: false, lastSix: null, endpoint: null };
    }

    const plaintext = decrypt({
      ciphertext: row.veniceApiKeyEnc,
      iv: row.veniceApiKeyIv,
      authTag: row.veniceApiKeyAuthTag,
    });
    return {
      hasKey: true,
      lastSix: lastSixOf(plaintext),
      endpoint: row.veniceEndpoint ?? DEFAULT_VENICE_ENDPOINT,
    };
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

  // [V18] Re-validates the stored key by calling Venice
  // (GET /api_keys/rate_limits) and reads `data.balances.{USD,DIEM}` from the
  // response body. Never modifies stored rows — purely a read + probe
  // operation. We chose this endpoint over `/v1/models` because Venice only
  // exposes balance information on its account-info endpoints; `/v1/models`
  // returns no `x-venice-balance-*` headers at all (verified empirically against
  // a live key). On 401/403 we return verified:false rather than throwing —
  // the Settings UI must show "Not verified" without treating it as a crash.
  async function verify(userId: string): Promise<VeniceKeyVerifyResult> {
    const status = await getStatus(userId);

    if (!status.hasKey) {
      return { verified: false, balanceUsd: null, diem: null, endpoint: null, lastSix: null };
    }

    // Re-read the user row to get the plaintext key. getStatus() intentionally
    // does not return it; we decrypt it again here so the plaintext lives only
    // for the lifetime of this function (and the in-flight HTTP call).
    const row = await client.user.findUnique({
      where: { id: userId },
      select: {
        veniceApiKeyEnc: true,
        veniceApiKeyIv: true,
        veniceApiKeyAuthTag: true,
      },
    });
    if (!row?.veniceApiKeyEnc || !row.veniceApiKeyIv || !row.veniceApiKeyAuthTag) {
      // Race: status.hasKey was true, but the key was deleted between calls.
      return {
        verified: false,
        balanceUsd: null,
        diem: null,
        endpoint: status.endpoint,
        lastSix: status.lastSix,
      };
    }
    const apiKey = decrypt({
      ciphertext: row.veniceApiKeyEnc,
      iv: row.veniceApiKeyIv,
      authTag: row.veniceApiKeyAuthTag,
    });

    const fetchFn = deps.fetchFn ?? globalThis.fetch;
    const endpoint = status.endpoint ?? DEFAULT_VENICE_ENDPOINT;
    const url = `${endpoint.replace(/\/$/, '')}/api_keys/rate_limits`;

    let response: Response;
    try {
      response = await fetchFn(url, {
        method: 'GET',
        headers: { Authorization: `Bearer ${apiKey}` },
      });
    } catch {
      throw new VeniceVerifyUnavailableError();
    }

    if (response.status === 401 || response.status === 403) {
      return {
        verified: false,
        balanceUsd: null,
        diem: null,
        endpoint: status.endpoint,
        lastSix: status.lastSix,
      };
    }
    if (response.status === 429) {
      throw new VeniceVerifyRateLimitedError(parseRetryAfterSeconds(response.headers));
    }
    if (!response.ok) {
      throw new VeniceVerifyUnavailableError();
    }

    let body: unknown;
    try {
      body = await response.json();
    } catch {
      throw new VeniceVerifyUnavailableError();
    }

    const balances = readBalances(body);
    return {
      verified: true,
      balanceUsd: balances.usd,
      diem: balances.diem,
      endpoint: status.endpoint,
      lastSix: status.lastSix,
    };
  }

  return { getStatus, store, remove, validateAgainstVenice, verify };
}

export const veniceKeyService = createVeniceKeyService();
