import { Router, type Request, type Response } from 'express';
import { ZodError } from 'zod';
import { prisma } from '../lib/prisma';
import { requireAuth } from '../middleware/auth.middleware';
import {
  InvalidCredentialsError,
  InvalidRefreshTokenError,
  REFRESH_TOKEN_TTL_SECONDS,
  UsernameUnavailableError,
  authService,
} from '../services/auth.service';

export const REFRESH_COOKIE_NAME = 'refreshToken';

function refreshCookieOptions() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax' as const,
    // Scope the cookie to the auth endpoints that actually use it. Narrower
    // than '/' so the refresh token doesn't ride on every /api/ai/* request.
    path: '/api/auth',
    maxAge: REFRESH_TOKEN_TTL_SECONDS * 1000,
  };
}

function badRequestFromZod(res: Response, err: ZodError): Response {
  return res.status(400).json({
    error: {
      message: 'Invalid request body',
      code: 'validation_error',
      issues: err.issues.map((issue) => ({
        path: issue.path,
        message: issue.message,
      })),
    },
  });
}

export function createAuthRouter() {
  const router = Router();

  router.post('/register', async (req, res, next) => {
    try {
      const result = await authService.register(req.body);
      res.status(201).json({
        user: result.user,
        recoveryCode: result.recoveryCode,
      });
    } catch (err) {
      if (err instanceof ZodError) {
        badRequestFromZod(res, err);
        return;
      }
      if (err instanceof UsernameUnavailableError) {
        res.status(409).json({ error: { message: 'Username unavailable', code: 'username_unavailable' } });
        return;
      }
      next(err);
    }
  });

  router.post('/login', async (req, res, next) => {
    try {
      const result = await authService.login(req.body);
      res.cookie(REFRESH_COOKIE_NAME, result.refreshToken, refreshCookieOptions());
      res.status(200).json({
        user: result.user,
        accessToken: result.accessToken,
        accessTokenExpiresAt: result.accessTokenExpiresAt.toISOString(),
      });
    } catch (err) {
      if (err instanceof ZodError) {
        badRequestFromZod(res, err);
        return;
      }
      if (err instanceof InvalidCredentialsError) {
        res.status(401).json({ error: { message: 'Invalid credentials', code: 'invalid_credentials' } });
        return;
      }
      next(err);
    }
  });

  router.post('/refresh', async (req: Request, res: Response, next) => {
    try {
      const token = req.cookies?.[REFRESH_COOKIE_NAME] as string | undefined;
      if (!token) {
        res.status(401).json({ error: { message: 'Invalid refresh token', code: 'invalid_refresh' } });
        return;
      }
      const result = await authService.refresh(token);
      res.cookie(REFRESH_COOKIE_NAME, result.refreshToken, refreshCookieOptions());
      res.status(200).json({
        user: result.user,
        accessToken: result.accessToken,
        accessTokenExpiresAt: result.accessTokenExpiresAt.toISOString(),
      });
    } catch (err) {
      if (err instanceof InvalidRefreshTokenError) {
        res.clearCookie(REFRESH_COOKIE_NAME, { ...refreshCookieOptions(), maxAge: 0 });
        res.status(401).json({ error: { message: 'Invalid refresh token', code: 'invalid_refresh' } });
        return;
      }
      next(err);
    }
  });

  router.post('/logout', async (req: Request, res: Response, next) => {
    try {
      const token = req.cookies?.[REFRESH_COOKIE_NAME] as string | undefined;
      if (token) await authService.logout(token);
      res.clearCookie(REFRESH_COOKIE_NAME, { ...refreshCookieOptions(), maxAge: 0 });
      res.status(204).send();
    } catch (err) {
      next(err);
    }
  });

  router.get('/me', requireAuth, async (req, res, next) => {
    try {
      const authed = req.user;
      if (!authed) {
        res.status(401).json({ error: { message: 'Unauthorized', code: 'unauthorized' } });
        return;
      }
      const user = await prisma.user.findUnique({ where: { id: authed.id } });
      if (!user) {
        res.status(401).json({ error: { message: 'Unauthorized', code: 'unauthorized' } });
        return;
      }
      res.status(200).json({
        user: {
          id: user.id,
          email: user.email,
          username: user.username,
          name: user.name,
          createdAt: user.createdAt,
          updatedAt: user.updatedAt,
        },
      });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
