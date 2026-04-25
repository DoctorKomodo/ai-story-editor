import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Transition } from '@/components/Transition';

/**
 * [F49] Shared transitions.
 *
 * jsdom doesn't compute animations or apply CSS keyframes (vitest's css: false
 * also strips imported stylesheets), so we cover two layers separately:
 *
 *  1. The `<Transition>` wrapper — assert it stamps the right className for
 *     each `kind` and merges any caller-supplied className.
 *  2. The CSS file — assert the keyframes and class hooks are present by
 *     reading `src/index.css` from disk. That's the only way to verify the
 *     animation tokens in a jsdom test environment.
 */

const CSS_PATH = resolve(__dirname, '../../src/index.css');
const CSS = readFileSync(CSS_PATH, 'utf8');

describe('<Transition>', () => {
  it('applies t-backdrop-in on mount for kind="backdrop"', () => {
    render(
      <Transition kind="backdrop">
        <span>hello</span>
      </Transition>,
    );
    const child = screen.getByText('hello');
    expect(child.parentElement?.className).toContain('t-backdrop-in');
  });

  it('applies t-modal-in on mount for kind="modal"', () => {
    render(
      <Transition kind="modal">
        <span>hello</span>
      </Transition>,
    );
    expect(screen.getByText('hello').parentElement?.className).toContain('t-modal-in');
  });

  it('applies t-popover-in on mount for kind="popover"', () => {
    render(
      <Transition kind="popover">
        <span>hello</span>
      </Transition>,
    );
    expect(screen.getByText('hello').parentElement?.className).toContain('t-popover-in');
  });

  it('merges caller-supplied className with the kind class', () => {
    render(
      <Transition kind="backdrop" className="absolute inset-0 bg-black/40">
        <span>hello</span>
      </Transition>,
    );
    const wrapper = screen.getByText('hello').parentElement;
    expect(wrapper).not.toBeNull();
    const cls = wrapper?.className ?? '';
    expect(cls).toContain('t-backdrop-in');
    expect(cls).toContain('absolute');
    expect(cls).toContain('inset-0');
    expect(cls).toContain('bg-black/40');
  });

  it('renders children unchanged', () => {
    render(
      <Transition kind="modal">
        <span data-testid="payload">payload</span>
      </Transition>,
    );
    const node = screen.getByTestId('payload');
    expect(node.textContent).toBe('payload');
    expect(node.tagName).toBe('SPAN');
  });

  it('does not stamp other transition classes for a given kind', () => {
    render(
      <Transition kind="popover">
        <span>only-popover</span>
      </Transition>,
    );
    const cls = screen.getByText('only-popover').parentElement?.className ?? '';
    expect(cls).toContain('t-popover-in');
    expect(cls).not.toContain('t-backdrop-in');
    expect(cls).not.toContain('t-modal-in');
  });
});

describe('shared transition CSS tokens', () => {
  it('defines the backdrop fade-in keyframe and class', () => {
    expect(CSS).toMatch(/@keyframes\s+inkwell-backdrop-in\b/);
    expect(CSS).toMatch(
      /\.t-backdrop-in\s*\{[^}]*animation:\s*inkwell-backdrop-in\s+160ms\s+ease-out/,
    );
  });

  it('defines the modal pop-in keyframe and class with the design-spec timing', () => {
    expect(CSS).toMatch(/@keyframes\s+inkwell-modal-in\b/);
    // 180ms duration with the cubic-bezier curve from the F49 spec.
    expect(CSS).toMatch(
      /\.t-modal-in\s*\{[^}]*animation:\s*inkwell-modal-in\s+180ms\s+cubic-bezier\(\s*0?\.2\s*,\s*0?\.9\s*,\s*0?\.3\s*,\s*1\s*\)/,
    );
    // Initial transform mixes translate(-50%, -50% + 8px) and scale(.98).
    expect(CSS).toMatch(
      /translate\(\s*-50%\s*,\s*calc\(\s*-50%\s*\+\s*8px\s*\)\s*\)\s*scale\(\s*0?\.98\s*\)/,
    );
  });

  it('defines the popover slide-in keyframe and class', () => {
    expect(CSS).toMatch(/@keyframes\s+inkwell-popover-in\b/);
    expect(CSS).toMatch(
      /\.t-popover-in\s*\{[^}]*animation:\s*inkwell-popover-in\s+140ms\s+ease-out/,
    );
  });

  it('defines the think keyframe and .think-dot class for thinking indicators', () => {
    expect(CSS).toMatch(/@keyframes\s+think\b/);
    expect(CSS).toMatch(/\.think-dot\s*\{[^}]*animation:\s*think\s+1s\s+ease-in-out\s+infinite/);
  });

  it('defines the .think-dot stagger via :nth-child', () => {
    expect(CSS).toMatch(/\.think-dot:nth-child\(2\)\s*\{[^}]*animation-delay:\s*0?\.15s/);
    expect(CSS).toMatch(/\.think-dot:nth-child\(3\)\s*\{[^}]*animation-delay:\s*0?\.3s/);
  });
});
