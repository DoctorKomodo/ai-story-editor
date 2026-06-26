/**
 * Single source of truth for the by-design dev logs that backend error-path
 * tests deliberately trigger. Drives an `onConsoleLog` filter that keeps test
 * output readable WITHOUT disabling the logging itself (the
 * [AU13]/[E12] leak test depends on `logVeniceErrorDev` firing under
 * NODE_ENV=test). Each pattern is anchored at the start of the full console
 * block; vitest passes the entire (possibly multi-line) formatted string to
 * onConsoleLog, so an anchored match suppresses the whole block.
 *
 * Deliberately NOT included (these should print as genuine output if they
 * ever fire): [X32], [boot], [session-store].
 */
export const INTENTIONAL_LOG_PATTERNS: RegExp[] = [
  /^\[venice\.params\]/,
  /^\[venice\.models\]/,
  /^\[venice\.error\]/,
  /^\[venice\.error\.dev\]/,
  /^\[chapter\.repo\]/,
  /^\[V15\] Failed to persist assistant message/,
  /^\[error-handler\.dev\]/,
];

export function isIntentionalLog(log: string): boolean {
  return INTENTIONAL_LOG_PATTERNS.some((re) => re.test(log));
}
