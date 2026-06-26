import { act } from '@testing-library/react';

/**
 * Wrap a synchronous store mutation (typically a zustand `setState` in a
 * test's `afterEach` reset, or a mid-test mutation after `render()`) in
 * React's `act()`, so the re-render it triggers on still-mounted
 * subscribers is flushed inside an act batch.
 *
 * Why this is needed: Vitest runs `afterEach` hooks in reverse registration
 * order, so a test-file teardown reset fires AFTER the test body but BEFORE
 * `tests/setup.ts`'s global `cleanup()` unmounts the tree. A bare
 * `store.setState(...)` there notifies still-mounted subscribers outside an
 * act batch, producing "An update to <Component> inside a test was not
 * wrapped in act(...)" warnings. See `tests/hooks/useAuth.test.tsx` for the
 * original hand-written instance of this pattern.
 *
 * Use only for mutations that fire while a component is mounted. A reset in
 * `beforeEach` (or before `render()` in a test body) needs no wrap.
 */
export function actStore(mutate: () => void): void {
  act(() => {
    mutate();
  });
}
