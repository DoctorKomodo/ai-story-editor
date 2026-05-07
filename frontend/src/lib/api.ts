/**
 * API client for the Inkwell backend.
 *
 * - Attaches `Authorization: Bearer <token>` when an access token is set in memory.
 * - On 401, attempts `POST /auth/refresh` exactly once; if refresh succeeds, retries
 *   the original request once with the new token. If refresh fails, clears the
 *   in-memory token and throws a typed `ApiError`.
 * - Throws `ApiError(status, code?, message)` on non-2xx responses. Parses
 *   `{ error: { message, code } }` bodies when present.
 * - Resolves with `undefined as T` for 204 responses.
 *
 * The access token is held in a module-level variable so the session store can
 * push updates (`setAccessToken`) without creating a circular import.
 */

const DEFAULT_BASE_URL = '/api';

function resolveBaseUrl(): string {
  const fromEnv = (import.meta as unknown as { env?: Record<string, string | undefined> }).env
    ?.VITE_API_BASE_URL;
  return fromEnv && fromEnv.length > 0 ? fromEnv : DEFAULT_BASE_URL;
}

let accessToken: string | null = null;
let onUnauthorized: (() => void) | null = null;
// Module-level dedup sentinel: while a refresh is in flight, all callers
// await the same promise rather than each issuing their own POST /auth/refresh
// (which would race against the backend's refresh-cookie rotation).
let refreshInFlight: Promise<string | null> | null = null;

export function setAccessToken(token: string | null): void {
  accessToken = token;
}

export function getAccessToken(): string | null {
  return accessToken;
}

/**
 * Register a callback invoked after a failed refresh (i.e. the client has given
 * up and cleared the token). The session store uses this to flip status to
 * `unauthenticated`. Optional — the token itself is cleared regardless.
 */
export function setUnauthorizedHandler(handler: (() => void) | null): void {
  onUnauthorized = handler;
}

/**
 * Test-only helper. Clears the in-memory access token, the unauthorized
 * handler, and any in-flight refresh promise so tests get a clean module
 * state in `beforeEach` / `afterEach`.
 */
export function resetApiClientForTests(): void {
  accessToken = null;
  onUnauthorized = null;
  refreshInFlight = null;
}

export interface ApiErrorBody {
  error?: {
    message?: string;
    code?: string;
    upstreamStatus?: number | null;
    retryAfterSeconds?: number | null;
    // Allow further fields without breaking existing callers.
    [key: string]: unknown;
  };
}

export class ApiError extends Error {
  public readonly status: number;
  public readonly code?: string;
  public readonly body?: ApiErrorBody;

  constructor(status: number, message: string, code?: string, body?: ApiErrorBody) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.body = body;
  }
}

/**
 * JSON-serialisable object body: any plain object shape. Uses `object` (rather
 * than `Record<string, unknown>`) so callers passing a typed interface
 * (e.g. `StoryInput`) don't need a cast — named interfaces without an index
 * signature aren't assignable to `Record<string, unknown>`, but they are
 * assignable to `object`. The runtime check `isPlainBodyObject` still strips
 * out DOM-ish non-JSON shapes (FormData, Blob, etc.) before stringifying.
 */
export type JsonBody = object;

export interface ApiRequestInit extends Omit<RequestInit, 'body'> {
  body?: BodyInit | JsonBody | unknown[] | null;
}

function buildUrl(path: string): string {
  const base = resolveBaseUrl();
  if (path.startsWith('http://') || path.startsWith('https://')) return path;
  if (path.startsWith('/')) return `${base}${path}`;
  return `${base}/${path}`;
}

function isPlainBodyObject(body: unknown): body is Record<string, unknown> | unknown[] {
  if (body === null || body === undefined) return false;
  if (typeof body !== 'object') return false;
  if (body instanceof FormData) return false;
  if (body instanceof Blob) return false;
  if (body instanceof ArrayBuffer) return false;
  if (body instanceof URLSearchParams) return false;
  if (body instanceof ReadableStream) return false;
  return true;
}

function buildRequestInit(init: ApiRequestInit | undefined): RequestInit {
  const headers = new Headers(init?.headers);
  let body: BodyInit | null | undefined;

  if (init?.body !== undefined && init.body !== null) {
    if (isPlainBodyObject(init.body)) {
      body = JSON.stringify(init.body);
      if (!headers.has('Content-Type')) {
        headers.set('Content-Type', 'application/json');
      }
    } else {
      body = init.body as BodyInit;
    }
  }

  if (accessToken && !headers.has('Authorization')) {
    headers.set('Authorization', `Bearer ${accessToken}`);
  }

  const { body: _ignored, ...rest } = init ?? {};
  void _ignored;
  const requestInit: RequestInit = {
    ...rest,
    headers,
    credentials: init?.credentials ?? 'include',
  };

  if (body !== undefined) {
    requestInit.body = body;
  }

  return requestInit;
}

async function parseErrorBody(
  res: Response,
): Promise<{ message: string; code?: string; body?: ApiErrorBody }> {
  const contentType = res.headers.get('content-type') ?? '';
  if (contentType.includes('application/json')) {
    try {
      const data = (await res.json()) as ApiErrorBody;
      const message = data.error?.message ?? res.statusText ?? `HTTP ${res.status}`;
      const code = data.error?.code;
      return { message, code, body: data };
    } catch {
      // fall through
    }
  }
  try {
    const text = await res.text();
    if (text) return { message: text };
  } catch {
    // ignore
  }
  return { message: res.statusText || `HTTP ${res.status}` };
}

async function parseSuccessBody<T>(res: Response): Promise<T> {
  if (res.status === 204) return undefined as T;
  const contentType = res.headers.get('content-type') ?? '';
  if (contentType.includes('application/json')) {
    return (await res.json()) as T;
  }
  // Non-JSON success: return text as unknown — callers generally know the shape.
  const text = await res.text();
  return text as unknown as T;
}

/**
 * Low-level refresh call. Uses bare `fetch` so it never recurses back through
 * the 401-retry branch. Returns the new access token on success, or null if
 * refresh failed. Exported so `initAuth()` can bootstrap without triggering
 * a redundant 401-retry cycle.
 *
 * Concurrent callers are deduped via `refreshInFlight`: the first caller
 * issues the network request, all subsequent callers await the same promise
 * until it settles. Without this, two simultaneous 401s would each POST
 * /auth/refresh, the backend would rotate the refresh cookie on the first
 * call, and the second's retry would fire with a token the backend has
 * already invalidated.
 */
export async function refreshAccessToken(): Promise<string | null> {
  if (refreshInFlight) return refreshInFlight;
  const run = (async (): Promise<string | null> => {
    try {
      const res = await fetch(buildUrl('/auth/refresh'), {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
      });
      if (!res.ok) return null;
      const data = (await res.json()) as { accessToken?: string };
      if (typeof data.accessToken === 'string' && data.accessToken.length > 0) {
        return data.accessToken;
      }
      return null;
    } catch {
      return null;
    }
  })();
  refreshInFlight = run;
  try {
    return await run;
  } finally {
    // Clear only if we're still the in-flight promise — defensive against a
    // synchronous re-entry by a future caller.
    if (refreshInFlight === run) refreshInFlight = null;
  }
}

/**
 * Core request driver shared by `api<T>()` and `apiStream()`.
 *
 * Handles the 401 → refresh → retry-once flow and throws `ApiError` on any
 * non-2xx response *other than the retried 401*. Success responses are
 * returned raw so streaming callers can consume `res.body`; the JSON helper
 * `api<T>()` wraps this and parses the body.
 */
async function doRequest(path: string, init?: ApiRequestInit): Promise<Response> {
  const url = buildUrl(path);
  const firstInit = buildRequestInit(init);
  const firstRes = await fetch(url, firstInit);

  if (firstRes.status !== 401) {
    if (!firstRes.ok) {
      const { message, code, body } = await parseErrorBody(firstRes);
      throw new ApiError(firstRes.status, message, code, body);
    }
    return firstRes;
  }

  // 401: try refresh once, then retry original request once.
  const newToken = await refreshAccessToken();
  if (newToken === null) {
    setAccessToken(null);
    if (onUnauthorized) onUnauthorized();
    const { message, code, body } = await parseErrorBody(firstRes);
    throw new ApiError(401, message, code, body);
  }

  setAccessToken(newToken);
  const retryInit = buildRequestInit(init);
  const retryRes = await fetch(url, retryInit);

  if (!retryRes.ok) {
    const { message, code, body } = await parseErrorBody(retryRes);
    if (retryRes.status === 401) {
      setAccessToken(null);
      if (onUnauthorized) onUnauthorized();
    }
    throw new ApiError(retryRes.status, message, code, body);
  }

  return retryRes;
}

export async function api<T = unknown>(path: string, init?: ApiRequestInit): Promise<T> {
  const res = await doRequest(path, init);
  return parseSuccessBody<T>(res);
}

/**
 * Streaming variant of `api<T>()` used by F15's `/api/ai/complete` call.
 *
 * Builds the request identically (same base URL, same Bearer-token header,
 * same 401 → refresh → retry-once flow, same error parsing for non-2xx
 * non-401 responses) but returns the raw `Response` on success so the
 * caller can consume `res.body` as a `ReadableStream` for SSE parsing.
 *
 * Do NOT read the body here — a single `ReadableStream` can only be
 * consumed once.
 */
export async function apiStream(path: string, init?: ApiRequestInit): Promise<Response> {
  return doRequest(path, init);
}
