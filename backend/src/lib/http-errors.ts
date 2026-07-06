// Throwable HTTP errors + thin constructors for the common cases. Routes
// `throw` these; the global error handler (middleware/error-handler.ts) is the
// single place that turns them into `{ error: { message, code } }` responses.
// Domain/service errors do NOT extend this class — they stay transport-agnostic
// and are mapped by the handler's instanceof table instead.
//
// SECURITY INVARIANT: `message` is sent to the client verbatim in ALL
// environments (no production scrubbing, unlike the catch-all 500). It must be
// a static literal or an already-safe string — never request- or DB-derived
// data (ids, usernames, decrypted content).
export class HttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

export const notFound = (message = 'Not found'): HttpError =>
  new HttpError(404, 'not_found', message);
export const forbidden = (message = 'Forbidden'): HttpError =>
  new HttpError(403, 'forbidden', message);
export const unauthorized = (): HttpError => new HttpError(401, 'unauthorized', 'Unauthorized');
export const conflict = (message: string, code = 'conflict'): HttpError =>
  new HttpError(409, code, message);
