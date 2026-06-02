import { afterEach, describe, expect, it } from 'vitest';
import { abortAllStreams, registerStream } from '@/lib/streamRegistry';

afterEach(() => {
  // Empty the module-level registry between tests so a controller from one
  // test can never bleed into the next.
  abortAllStreams();
});

describe('streamRegistry', () => {
  it('aborts every registered controller on abortAllStreams', () => {
    const a = new AbortController();
    const b = new AbortController();
    registerStream(a);
    registerStream(b);

    abortAllStreams();

    expect(a.signal.aborted).toBe(true);
    expect(b.signal.aborted).toBe(true);
  });

  it('does not abort a controller after its deregister handle runs', () => {
    const c = new AbortController();
    const deregister = registerStream(c);

    deregister();
    abortAllStreams();

    expect(c.signal.aborted).toBe(false);
  });

  it('empties the registry so a controller is not retained across calls', () => {
    const first = new AbortController();
    registerStream(first);
    abortAllStreams();

    const second = new AbortController();
    const deregisterSecond = registerStream(second);
    deregisterSecond();
    abortAllStreams();

    expect(second.signal.aborted).toBe(false);
  });

  it('is a no-op on an empty registry', () => {
    expect(() => abortAllStreams()).not.toThrow();
  });
});
