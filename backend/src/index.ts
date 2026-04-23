import cookieParser from 'cookie-parser';
import cors from 'cors';
import express, { type NextFunction, type Request, type Response } from 'express';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';
import morgan from 'morgan';
import { validateEncryptionEnv } from './boot/env-validation';
import { NoVeniceKeyError } from './lib/venice';
import { createAiRouter } from './routes/ai.routes';
import { createAuthRouter } from './routes/auth.routes';
import { createVeniceKeyRouter } from './routes/venice-key.routes';
import { createChapterChatsRouter, createChatMessagesRouter } from './routes/chat.routes';
import { createStoriesRouter } from './routes/stories.routes';

// Fail fast if encryption env is misconfigured. Tests set a valid key in
// tests/setup.ts, so this runs cleanly there too.
validateEncryptionEnv();

const app = express();

// CORS origin is explicit. In production we refuse to boot without FRONTEND_URL
// so a forgotten env var can't silently leave the cookie-backed endpoints open
// to credentialed requests from http://localhost:3000 (security review finding).
function resolveFrontendOrigin(): string {
  const raw = process.env.FRONTEND_URL;
  if (raw && raw.length > 0) return raw;
  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      'FRONTEND_URL must be set in production — CORS credentials=true will not fall back to localhost.',
    );
  }
  return 'http://localhost:3000';
}

app.use(helmet());
// Function-based origin: only echo Access-Control-Allow-Origin for the exact
// configured FRONTEND_URL. Static-string form of cors() would echo the allowed
// origin on every response regardless of request origin, relying entirely on
// the browser to compare — function form keeps the header off non-matching
// responses and leaves same-origin requests with no extra CORS headers.
const allowedOrigin = resolveFrontendOrigin();
app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin || origin === allowedOrigin) {
        callback(null, true);
        return;
      }
      callback(null, false);
    },
    credentials: true,
  }),
);
app.use(express.json());
app.use(cookieParser());
// morgan's dev format is for local debugging only. In production it would log
// every request URL (including owned resource IDs like /api/stories/:id) to
// stdout with no gating, which is both noisy and a minor ID-enumeration leak
// if the log sink is ever compromised.
if (process.env.NODE_ENV !== 'production' && process.env.NODE_ENV !== 'test') {
  app.use(morgan('dev'));
}

app.use(
  '/api/ai',
  rateLimit({
    windowMs: 60_000,
    limit: 20,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
  }),
);

app.use('/api/auth', createAuthRouter());
app.use('/api/users/me/venice-key', createVeniceKeyRouter());
app.use('/api/ai', createAiRouter());
// [B1] Story list + create. Chapters, characters, outline, chat follow in B2–B11.
app.use('/api/stories', createStoriesRouter());
// [V15] Chat + message routes — two separate router mounts (option A: mergeParams).
app.use('/api/chapters/:chapterId/chats', createChapterChatsRouter());
app.use('/api/chats/:chatId/messages', createChatMessagesRouter());

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok' });
});

// Global error handler. Keeps stack traces out of production responses and
// gives clients a consistent JSON shape when a route hands an error to next().
// Exported so tests can mount the exact same handler on a disposable app
// instead of duplicating the logic.
export function globalErrorHandler(
  err: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction,
): void {
  // [V17] Per-user Venice client signals "user has no stored key" via
  // NoVeniceKeyError. Map to 409 so the frontend can prompt the user to set
  // one in /settings#venice. Keep this above the catch-all 500 below.
  if (err instanceof NoVeniceKeyError) {
    res.status(409).json({
      error: { message: 'venice_key_required', code: 'venice_key_required' },
    });
    return;
  }
  const isProd = process.env.NODE_ENV === 'production';
  const message = isProd
    ? 'Internal server error'
    : (err instanceof Error ? err.message : 'Internal server error');
  res.status(500).json({ error: { message, code: 'internal_error' } });
}

app.use(globalErrorHandler);

const port = Number(process.env.PORT ?? 4000);

if (require.main === module) {
  app.listen(port, () => {
    console.log(`Backend listening on http://localhost:${port}`);
  });
}

export { app };
