import { act, fireEvent, render, screen } from '@testing-library/react';
import type { JSX } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { type SelectionAction, SelectionBubble } from '@/components/SelectionBubble';
import { useSelectionStore } from '@/store/selection';

/**
 * F33 tests.
 *
 * jsdom doesn't compute layout, so positioning is verified via "rect prop
 * reaches the bubble" rather than pixel coordinates. Selection events go
 * through `vi.spyOn(window, 'getSelection')` so we can simulate the cases
 * jsdom doesn't fully implement (Range over a fixture, isCollapsed,
 * outside-prose).
 */

afterEach(() => {
  // Each test owns its own state — reset the store and clear spies.
  useSelectionStore.setState({ selection: null });
  vi.restoreAllMocks();
});

function noop(): void {
  /* placeholder onAction */
}

function renderBubble(onAction: (a: SelectionAction) => void = noop): ReturnType<typeof render> {
  return render(<SelectionBubble onAction={onAction} />);
}

/** Build a fake non-collapsed Selection over a node's text. */
function fakeSelectionOver(node: Node, text: string): Selection {
  const range = {
    commonAncestorContainer: node,
    toString: () => text,
    getBoundingClientRect: () =>
      ({
        top: 100,
        left: 50,
        right: 150,
        bottom: 120,
        width: 100,
        height: 20,
        x: 50,
        y: 100,
      }) as DOMRect,
  } as unknown as Range;
  return {
    rangeCount: 1,
    isCollapsed: false,
    getRangeAt: (_: number) => range,
    toString: () => text,
  } as unknown as Selection;
}

describe('SelectionBubble (F33)', () => {
  it('does not render when the selection store is empty', () => {
    renderBubble();
    expect(screen.queryByRole('menu', { name: 'Selection actions' })).toBeNull();
  });

  it('renders all four action labels when the store is populated', () => {
    renderBubble();
    act(() => {
      useSelectionStore.setState({
        selection: {
          text: 'hello',
          range: null,
          rect: {
            top: 100,
            left: 50,
            right: 150,
            bottom: 120,
            width: 100,
            height: 20,
            x: 50,
            y: 100,
          } as DOMRect,
        },
      });
    });
    expect(screen.getByRole('menu', { name: 'Selection actions' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Rewrite' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Describe' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Expand' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Ask AI' })).toBeInTheDocument();
  });

  it('routes each button click to onAction with the right action kind', () => {
    const onAction = vi.fn<(a: SelectionAction) => void>();
    renderBubble(onAction);
    act(() => {
      useSelectionStore.setState({
        selection: {
          text: 'hello',
          range: null,
          rect: {
            top: 100,
            left: 50,
            right: 150,
            bottom: 120,
            width: 100,
            height: 20,
            x: 50,
            y: 100,
          } as DOMRect,
        },
      });
    });
    fireEvent.click(screen.getByRole('button', { name: 'Rewrite' }));
    fireEvent.click(screen.getByRole('button', { name: 'Describe' }));
    fireEvent.click(screen.getByRole('button', { name: 'Expand' }));
    fireEvent.click(screen.getByRole('button', { name: 'Ask AI' }));
    expect(onAction.mock.calls).toEqual([['rewrite'], ['describe'], ['expand'], ['ask']]);
  });

  it('preventDefaults on mousedown on the bubble container so selection is preserved', () => {
    renderBubble();
    act(() => {
      useSelectionStore.setState({
        selection: {
          text: 'hello',
          range: null,
          rect: {
            top: 100,
            left: 50,
            right: 150,
            bottom: 120,
            width: 100,
            height: 20,
            x: 50,
            y: 100,
          } as DOMRect,
        },
      });
    });
    const menu = screen.getByRole('menu', { name: 'Selection actions' });
    const event = new MouseEvent('mousedown', { bubbles: true, cancelable: true });
    const prevented = !menu.dispatchEvent(event);
    expect(prevented).toBe(true);
    expect(event.defaultPrevented).toBe(true);
  });

  it('preventDefaults on mousedown on each action button', () => {
    renderBubble();
    act(() => {
      useSelectionStore.setState({
        selection: {
          text: 'hello',
          range: null,
          rect: {
            top: 100,
            left: 50,
            right: 150,
            bottom: 120,
            width: 100,
            height: 20,
            x: 50,
            y: 100,
          } as DOMRect,
        },
      });
    });
    for (const label of ['Rewrite', 'Describe', 'Expand', 'Ask AI']) {
      const btn = screen.getByRole('button', { name: label });
      const ev = new MouseEvent('mousedown', { bubbles: true, cancelable: true });
      btn.dispatchEvent(ev);
      expect(ev.defaultPrevented).toBe(true);
    }
  });

  it('clears the store on unmount', () => {
    const { unmount } = renderBubble();
    act(() => {
      useSelectionStore.setState({
        selection: {
          text: 'hello',
          range: null,
          rect: {
            top: 100,
            left: 50,
            right: 150,
            bottom: 120,
            width: 100,
            height: 20,
            x: 50,
            y: 100,
          } as DOMRect,
        },
      });
    });
    expect(useSelectionStore.getState().selection).not.toBeNull();
    unmount();
    expect(useSelectionStore.getState().selection).toBeNull();
  });

  it('clears the store on Escape keydown', () => {
    renderBubble();
    act(() => {
      useSelectionStore.setState({
        selection: {
          text: 'hello',
          range: null,
          rect: {
            top: 100,
            left: 50,
            right: 150,
            bottom: 120,
            width: 100,
            height: 20,
            x: 50,
            y: 100,
          } as DOMRect,
        },
      });
    });
    expect(useSelectionStore.getState().selection).not.toBeNull();
    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    });
    expect(useSelectionStore.getState().selection).toBeNull();
  });

  it('clears the store on document scroll', () => {
    renderBubble();
    act(() => {
      useSelectionStore.setState({
        selection: {
          text: 'hello',
          range: null,
          rect: {
            top: 100,
            left: 50,
            right: 150,
            bottom: 120,
            width: 100,
            height: 20,
            x: 50,
            y: 100,
          } as DOMRect,
        },
      });
    });
    expect(useSelectionStore.getState().selection).not.toBeNull();
    act(() => {
      // Capture-phase scroll listener is attached on document; window
      // scroll events bubble there too.
      document.dispatchEvent(new Event('scroll'));
    });
    expect(useSelectionStore.getState().selection).toBeNull();
  });

  it('populates the store on mouseup when selection is inside the prose region', () => {
    // Render a prose fixture alongside the bubble so the listener finds it.
    function Harness(): JSX.Element {
      return (
        <div>
          <div className="paper-prose" data-testid="prose">
            <p data-testid="para">Hello world</p>
          </div>
          <SelectionBubble onAction={noop} />
        </div>
      );
    }
    render(<Harness />);
    const para = screen.getByTestId('para');
    const textNode = para.firstChild!;
    expect(textNode).toBeTruthy();

    vi.spyOn(window, 'getSelection').mockReturnValue(fakeSelectionOver(textNode, 'Hello world'));

    act(() => {
      document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    });
    const sel = useSelectionStore.getState().selection;
    expect(sel).not.toBeNull();
    expect(sel?.text).toBe('Hello world');
  });

  it('does not populate the store when selection is outside the prose region', () => {
    function Harness(): JSX.Element {
      return (
        <div>
          <div data-testid="not-prose">
            <p data-testid="para">Hello world</p>
          </div>
          <SelectionBubble onAction={noop} />
        </div>
      );
    }
    render(<Harness />);
    const para = screen.getByTestId('para');
    const textNode = para.firstChild!;
    vi.spyOn(window, 'getSelection').mockReturnValue(fakeSelectionOver(textNode, 'Hello world'));
    act(() => {
      document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    });
    expect(useSelectionStore.getState().selection).toBeNull();
  });

  it('clears the store on mouseup when selection is collapsed', () => {
    renderBubble();
    act(() => {
      useSelectionStore.setState({
        selection: {
          text: 'previously',
          range: null,
          rect: null,
        },
      });
    });
    vi.spyOn(window, 'getSelection').mockReturnValue({
      rangeCount: 1,
      isCollapsed: true,
      getRangeAt: () => ({}) as Range,
      toString: () => '',
    } as unknown as Selection);
    act(() => {
      document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    });
    expect(useSelectionStore.getState().selection).toBeNull();
  });

  it('responds to keyup the same way as mouseup (keyboard selection)', () => {
    function Harness(): JSX.Element {
      return (
        <div>
          <div className="paper-prose">
            <p data-testid="para">Hello world</p>
          </div>
          <SelectionBubble onAction={noop} />
        </div>
      );
    }
    render(<Harness />);
    const para = screen.getByTestId('para');
    const textNode = para.firstChild!;
    vi.spyOn(window, 'getSelection').mockReturnValue(fakeSelectionOver(textNode, 'Hello world'));
    act(() => {
      document.dispatchEvent(new KeyboardEvent('keyup', { key: 'ArrowRight', shiftKey: true }));
    });
    expect(useSelectionStore.getState().selection?.text).toBe('Hello world');
  });
});
