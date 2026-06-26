import { cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { create } from 'zustand';
import { actStore } from './actStore';

const useCountStore = create<{ n: number }>(() => ({ n: 0 }));

function Probe(): React.ReactElement {
  const n = useCountStore((s) => s.n);
  return <span data-testid="n">{n}</span>;
}

describe('actStore', () => {
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    useCountStore.setState({ n: 0 });
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    cleanup();
    errorSpy.mockRestore();
  });

  it('runs the mutation (state is updated)', () => {
    render(<Probe />);
    actStore(() => useCountStore.setState({ n: 5 }));
    expect(useCountStore.getState().n).toBe(5);
  });

  it('suppresses the "not wrapped in act" warning a bare setState triggers', () => {
    render(<Probe />);

    // Bare mutation outside act → React logs the act warning.
    useCountStore.setState({ n: 1 });
    const bareWarned = errorSpy.mock.calls.some((c: unknown[]) =>
      String(c[0]).includes('not wrapped in act'),
    );
    expect(bareWarned).toBe(true);

    errorSpy.mockClear();

    // Same mutation via actStore → no act warning.
    actStore(() => useCountStore.setState({ n: 2 }));
    const wrappedWarned = errorSpy.mock.calls.some((c: unknown[]) =>
      String(c[0]).includes('not wrapped in act'),
    );
    expect(wrappedWarned).toBe(false);
  });
});
