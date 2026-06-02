/**
 * Registry of in-flight streaming `AbortController`s (chat assistant + inline
 * AI completions). Streaming surfaces own their controller inside a closure,
 * so the session-reset chokepoint cannot reach them directly; this registry
 * makes them reachable. `resetClientState` (frontend/src/lib/sessionReset.ts)
 * calls `abortAllStreams()` on every auth transition so a previous user's
 * stream can't push tokens into the next user's freshly-reset state.
 *
 * Distinct from the single-value `registerSessionResetQueryClient` registry in
 * sessionReset.ts: this tracks *many* controllers (a Set), so it lives in its
 * own module.
 */
const active = new Set<AbortController>();

/**
 * Register an active stream controller. Returns a deregister handle the caller
 * MUST invoke when the stream ends (success, error, or abort) — typically from
 * the streaming surface's `finally` block.
 */
export function registerStream(controller: AbortController): () => void {
  active.add(controller);
  return () => {
    active.delete(controller);
  };
}

/** Abort every registered stream and empty the registry. */
export function abortAllStreams(): void {
  for (const controller of active) {
    controller.abort();
  }
  active.clear();
}
