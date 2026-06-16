// In-process session store for Option B DEK survival (see docs/encryption.md).
//
// A session id binds to { userId, dek, expiresAt }. The DEK lives here, not
// anywhere else on disk. A process restart wipes the map — active users are
// forced to re-authenticate, which matches the goal that the server cannot
// decrypt content outside of a live session.
//
// The session-store is the ONLY persistent-across-requests DEK cache permitted
// under the current scheme (see CLAUDE.md). `content-crypto.service` reads the
// DEK from a request-scoped WeakMap populated by the auth middleware; the
// middleware copies from this store. content-crypto never reads this store
// directly.

export const IDLE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const ABSOLUTE_TTL_MS = 30 * 24 * 60 * 60 * 1000;

const MAX_SESSIONS = Number(process.env.SESSION_STORE_MAX) || 10_000;
const SWEEP_INTERVAL_MS = 60_000;

interface SessionEntry {
  userId: string;
  dek: Buffer;
  createdAt: number;
  expiresAt: number;
  lastAccessedAt: number;
}

const sessions = new Map<string, SessionEntry>();
let sweeperTimer: NodeJS.Timeout | null = null;

function ensureSweeper(): void {
  if (sweeperTimer) return;
  sweeperTimer = setInterval(sweep, SWEEP_INTERVAL_MS);
  sweeperTimer.unref?.();
}

function sweep(): void {
  const now = Date.now();
  for (const [id, entry] of sessions) {
    if (entry.expiresAt <= now) sessions.delete(id);
  }
}

function evictOldest(): void {
  let oldestId: string | null = null;
  let oldestAccess = Number.POSITIVE_INFINITY;
  for (const [id, entry] of sessions) {
    if (entry.lastAccessedAt < oldestAccess) {
      oldestAccess = entry.lastAccessedAt;
      oldestId = id;
    }
  }
  if (oldestId !== null) {
    const entry = sessions.get(oldestId)!;
    // Warn only when evicting a session that hasn't expired yet — that means
    // cap pressure is forcing live users out.
    if (entry.expiresAt > Date.now()) {
      console.warn(
        '[session-store] evicting a live session under cap pressure; consider raising SESSION_STORE_MAX',
      );
    }
    sessions.delete(oldestId);
  }
}

export interface OpenSessionInput {
  sessionId: string;
  userId: string;
  dek: Buffer;
  createdAt: Date;
  expiresAt: Date;
}

export function openSession({
  sessionId,
  userId,
  dek,
  createdAt,
  expiresAt,
}: OpenSessionInput): void {
  ensureSweeper();
  if (!sessions.has(sessionId) && sessions.size >= MAX_SESSIONS) {
    // Sweep expired entries first; only force-evict a live one if still full.
    sweep();
    if (sessions.size >= MAX_SESSIONS) {
      evictOldest();
    }
  }
  sessions.set(sessionId, {
    userId,
    dek,
    createdAt: createdAt.getTime(),
    expiresAt: expiresAt.getTime(),
    lastAccessedAt: Date.now(),
  });
}

export interface ResolvedSession {
  userId: string;
  dek: Buffer;
}

export function getSession(sessionId: string): ResolvedSession | null {
  const entry = sessions.get(sessionId);
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) {
    sessions.delete(sessionId);
    return null;
  }
  entry.lastAccessedAt = Date.now();
  return { userId: entry.userId, dek: entry.dek };
}

export function closeSession(sessionId: string): void {
  sessions.delete(sessionId);
}

export function closeSessionsForUser(userId: string): number {
  let removed = 0;
  for (const [id, entry] of sessions) {
    if (entry.userId === userId) {
      sessions.delete(id);
      removed += 1;
    }
  }
  return removed;
}

export function extendSessionExpiry(sessionId: string, expiresAt: Date): void {
  const entry = sessions.get(sessionId);
  if (!entry) return;
  const cap = entry.createdAt + ABSOLUTE_TTL_MS;
  entry.expiresAt = Math.min(expiresAt.getTime(), cap);
  entry.lastAccessedAt = Date.now();
}

// Test helpers — never called from production code.
export function _resetSessionStore(): void {
  sessions.clear();
  if (sweeperTimer) {
    clearInterval(sweeperTimer);
    sweeperTimer = null;
  }
}

export function _sessionCount(): number {
  return sessions.size;
}

export function peekSessionExpiry(sessionId: string): number | null {
  return sessions.get(sessionId)?.expiresAt ?? null;
}
