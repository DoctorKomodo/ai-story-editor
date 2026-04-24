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

export interface ApiErrorBody {
  error?: {
    message?: string;
    code?: string;
  };
}

export class ApiError extends Error {
  public readonly status: number;
  public readonly code?: string;

  constructor(status: number, message: string, code?: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

export interface ApiRequestInit extends Omit<RequestInit, 'body'> {
  body?: BodyInit | Record<string, unknown> | unknown[] | null;
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

async function parseErrorBody(res: Response): Promise<{ message: string; code?: string }> {
  const contentType = res.headers.get('content-type') ?? '';
  if (contentType.includes('application/json')) {
    try {
      const data = (await res.json()) as ApiErrorBody;
      const message = data.error?.message ?? res.statusText ?? `HTTP ${res.status}`;
      const code = data.error?.code;
      return { message, code };
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
 */
export async function refreshAccessToken(): Promise<string | null> {
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
}

export async function api<T = unknown>(path: string, init?: ApiRequestInit): Promise<T> {
  const url = buildUrl(path);
  const firstInit = buildRequestInit(init);
  const firstRes = await fetch(url, firstInit);

  if (firstRes.status !== 401) {
    if (!firstRes.ok) {
      const { message, code } = await parseErrorBody(firstRes);
      throw new ApiError(firstRes.status, message, code);
    }
    return parseSuccessBody<T>(firstRes);
  }

  // 401: try refresh once, then retry original request once.
  const newToken = await refreshAccessToken();
  if (newToken === null) {
    setAccessToken(null);
    if (onUnauthorized) onUnauthorized();
    const { message, code } = await parseErrorBody(firstRes);
    throw new ApiError(401, message, code);
  }

  setAccessToken(newToken);
  const retryInit = buildRequestInit(init);
  const retryRes = await fetch(url, retryInit);

  if (!retryRes.ok) {
    const { message, code } = await parseErrorBody(retryRes);
    if (retryRes.status === 401) {
      setAccessToken(null);
      if (onUnauthorized) onUnauthorized();
    }
    throw new ApiError(retryRes.status, message, code);
  }

  return parseSuccessBody<T>(retryRes);
}
