import type { NextFunction, Request, Response } from 'express';
import jwt, { JsonWebTokenError, TokenExpiredError } from 'jsonwebtoken';
import { attachDekToRequest } from '../services/content-crypto.service';
import { getSession } from '../services/session-store';
import type { AccessTokenPayload } from '../services/auth.service';

export interface AuthenticatedUser {
  id: string;
  email: string | null;
  sessionId?: string;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthenticatedUser;
    }
  }
}

function extractBearerToken(req: Request): string | null {
  const header = req.headers.authorization;
  if (!header) return null;
  const [scheme, token] = header.split(' ', 2);
  if (scheme?.toLowerCase() !== 'bearer' || !token) return null;
  return token;
}

function unauthorized(res: Response): Response {
  return res.status(401).json({ error: { message: 'Unauthorized', code: 'unauthorized' } });
}

function sessionExpired(res: Response): Response {
  return res.status(401).json({
    error: { message: 'Session expired', code: 'session_expired' },
  });
}

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const token = extractBearerToken(req);
  if (!token) {
    unauthorized(res);
    return;
  }

  const secret = process.env.JWT_SECRET;
  if (!secret) {
    res.status(500).json({ error: { message: 'Server misconfigured', code: 'server_error' } });
    return;
  }

  try {
    const decoded = jwt.verify(token, secret, { algorithms: ['HS256'] }) as AccessTokenPayload;
    if (typeof decoded !== 'object' || typeof decoded.sub !== 'string') {
      unauthorized(res);
      return;
    }
    req.user = { id: decoded.sub, email: decoded.email ?? null };

    // [E3] If the token carries a sessionId, the session store must have the
    // unwrapped DEK. Missing it means the process restarted, the entry was
    // evicted, or the session was revoked — either way the request can't
    // proceed on anything that needs content decryption. Surface a distinct
    // code so the frontend can route to /login with a "please sign in again"
    // message instead of the generic Unauthorized.
    if (decoded.sessionId) {
      const session = getSession(decoded.sessionId);
      if (!session || session.userId !== decoded.sub) {
        sessionExpired(res);
        return;
      }
      attachDekToRequest(req, session.dek);
      req.user.sessionId = decoded.sessionId;
    }

    next();
  } catch (err) {
    if (err instanceof TokenExpiredError || err instanceof JsonWebTokenError) {
      unauthorized(res);
      return;
    }
    next(err);
  }
}
