/**
 * API client for the Inkwell backend.
 *
 * - Session auth via an opaque httpOnly cookie sent automatically by the browser
 *   because `credentials: 'include'` is set on every request. No JS-held token,
 *   no Authorization header.
 * - A 401 is terminal: fire `onUnauthorized` (session store flips to
 *   unauthenticated and routes to /login), then throw `ApiError(401)`. There is
 *   no refresh dance.
 * - Throws `ApiError(status, message, code?, body?)` on non-2xx responses.
 *   Parses `{ error: { message, code } }` bodies when present.
 * - Resolves with `undefined as T` for 204 responses.
 */
import { type Chat, chatResponseSchema } from 'story-editor-shared';

const DEFAULT_BASE_URL = '/api';

function resolveBaseUrl(): string {
  const fromEnv = (import.meta as unknown as { env?: Record<string, string | undefined> }).env
    ?.VITE_API_BASE_URL;
  return fromEnv && fromEnv.length > 0 ? fromEnv : DEFAULT_BASE_URL;
}

let onUnauthorized: (() => void) | null = null;

/**
 * Register a callback invoked when the server returns 401. The session store
 * uses this to flip status to `unauthenticated`. Optional — the ApiError is
 * thrown regardless.
 */
export function setUnauthorizedHandler(handler: (() => void) | null): void {
  onUnauthorized = handler;
}

/**
 * Test-only helper. Clears the unauthorized handler so tests get a clean
 * module state in `beforeEach` / `afterEach`.
 */
export function resetApiClientForTests(): void {
  onUnauthorized = null;
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
 * than `Record<string, unknown>`) so callers passing a typed object shape
 * (e.g. `StoryCreateInput`) don't need a cast — object types without an index
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
 * Core request driver shared by `api<T>()` and `apiStream()`.
 *
 * A 401 is terminal: parse the error body, fire `onUnauthorized`, and throw
 * `ApiError(401)`. The session cookie rides along automatically; there is no
 * refresh dance. Success responses are returned raw so streaming callers can
 * consume `res.body`; the JSON helper `api<T>()` wraps this and parses the body.
 */
async function doRequest(path: string, init?: ApiRequestInit): Promise<Response> {
  const res = await fetch(buildUrl(path), buildRequestInit(init));
  if (!res.ok) {
    const { message, code, body } = await parseErrorBody(res);
    if (res.status === 401 && onUnauthorized) onUnauthorized();
    throw new ApiError(res.status, message, code, body);
  }
  return res;
}

export async function api<T = unknown>(path: string, init?: ApiRequestInit): Promise<T> {
  const res = await doRequest(path, init);
  return parseSuccessBody<T>(res);
}

/**
 * Streaming variant of `api<T>()` used by the `/api/ai/complete` call.
 *
 * Builds the request identically (same base URL, same cookie auth, same error
 * parsing for non-2xx responses, terminal 401) but returns the raw `Response`
 * on success so the caller can consume `res.body` as a `ReadableStream` for
 * SSE parsing.
 *
 * Do NOT read the body here — a single `ReadableStream` can only be consumed once.
 */
export async function apiStream(path: string, init?: ApiRequestInit): Promise<Response> {
  return doRequest(path, init);
}

/** Headroom under the spec's 64 KiB `fetch({ keepalive: true })` body cap. */
export const KEEPALIVE_MAX_BYTES = 60_000;

/**
 * Fire-and-forget PATCH that outlives the page (`fetch` with
 * `keepalive: true`). Used only by `useUnloadFlush` on `pagehide` /
 * `visibilitychange` — there is no response to observe and no 401 flow at
 * unload time, so this deliberately bypasses `doRequest`.
 *
 * Takes the already-serialized JSON body (the caller needs the same string
 * for its own dedupe key, so serializing once here avoids doing it twice per
 * flush). Returns `false` without sending when it exceeds `KEEPALIVE_MAX_BYTES`
 * (the caller falls back to the local draft, which is the guaranteed
 * persistence layer regardless). Never throws.
 */
export function apiKeepalivePatch(path: string, json: string): boolean {
  const byteLength = new TextEncoder().encode(json).length;
  if (byteLength > KEEPALIVE_MAX_BYTES) return false;

  void fetch(buildUrl(path), {
    method: 'PATCH',
    keepalive: true,
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: json,
  }).catch(() => {});
  return true;
}

// ─── Export / Import API client functions ────────────────────────────────────

export async function fetchExportBlob(): Promise<{ blob: Blob; filename: string }> {
  const res = await fetch(buildUrl('/users/me/export'), { credentials: 'include' });
  if (!res.ok) {
    const { message, code, body } = await parseErrorBody(res);
    if (res.status === 401) onUnauthorized?.();
    throw new ApiError(res.status, message, code, body);
  }
  const cd = res.headers.get('Content-Disposition') ?? '';
  const match = cd.match(/filename="([^"]+)"/);
  return { blob: await res.blob(), filename: match?.[1] ?? 'inkwell-backup.json' };
}

// ─── Chat API client functions ───────────────────────────────────────────────
//
// Thin wrappers over `api()` / `apiStream()` used by SC14+ scene-tab hooks.
// All auth and error handling is delegated to `doRequest` via `api()` /
// `apiStream()` — do not call `fetch` directly here.

/**
 * [SC14] PATCH /api/chats/:id
 *
 * Renames an existing chat.
 */
export async function patchChat(id: string, title: string): Promise<Chat> {
  const res = await api<unknown>(`/chats/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: { title },
  });
  return chatResponseSchema.parse(res).chat;
}

/**
 * [SC14] DELETE /api/chats/:id
 *
 * Deletes a chat and all its messages.
 */
export async function deleteChat(id: string): Promise<void> {
  await api<void>(`/chats/${encodeURIComponent(id)}`, { method: 'DELETE' });
}
