// Throwable HTTP errors + thin constructors for the common cases. Routes
// `throw` these; the global error handler (middleware/error-handler.ts) is the
// single place that turns them into `{ error: { message, code } }` responses.
// Domain/service errors do NOT extend this class — they stay transport-agnostic
// and are mapped by the handler's instanceof table instead.
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
