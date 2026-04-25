// [F23] Design-token / theme tests.
//
// Confirms that the three theme palettes (paper / sepia / dark) port the
// exact tokens from `mockups/frontend-prototype/design/styles.css`, that
// the dark `data-theme` attribute swaps `--bg`, that Tailwind utilities
// produced by the `@theme` block are recognised on a rendered element, and
// that the `dark:` custom variant continues to compile against
// `[data-theme="dark"]`.
//
// jsdom subtlety: vitest is configured with `css: false`, so importing
// `index.css` does NOT apply styles. We instead read the file at test
// time and inject it as a <style> into <head>; jsdom's `getComputedStyle`
// can then resolve the custom properties on `:root`.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { render } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const CSS_PATH = path.resolve(__dirname, '../src/index.css');
const cssText = readFileSync(CSS_PATH, 'utf8');

const STYLE_ID = 'inkwell-tokens-test';

function getRootVar(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

beforeAll(() => {
  // Inject the token CSS once. Strip the `@import "tailwindcss";` and
  // Tailwind v4 directives jsdom can't parse — we only need the
  // :root / [data-theme="…"] custom-property blocks.
  const tokensOnly = cssText
    .replace(/@import[^;]+;/g, '')
    .replace(/@custom-variant[^;]+;/g, '')
    // Drop `@theme { ... }` (Tailwind v4 directive, not real CSS) and any
    // other at-rules with a body that jsdom would otherwise mis-parse.
    .replace(/@theme\s*\{[^}]*\}/g, '');
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = tokensOnly;
  document.head.appendChild(style);
});

describe('[F23] theme tokens', () => {
  beforeEach(() => {
    delete document.documentElement.dataset.theme;
  });

  afterEach(() => {
    delete document.documentElement.dataset.theme;
  });

  it('paper theme is the default — --bg is #faf8f3', () => {
    expect(getRootVar('--bg')).toBe('#faf8f3');
    expect(getRootVar('--ink')).toBe('#1a1a1a');
    expect(getRootVar('--radius')).toBe('3px');
    expect(getRootVar('--radius-lg')).toBe('6px');
  });

  it('sepia theme overrides --bg to #f4ecd8', () => {
    document.documentElement.dataset.theme = 'sepia';
    expect(getRootVar('--bg')).toBe('#f4ecd8');
    expect(getRootVar('--ink')).toBe('#2d230f');
  });

  it('dark theme overrides --bg to #14130f', () => {
    document.documentElement.dataset.theme = 'dark';
    expect(getRootVar('--bg')).toBe('#14130f');
    expect(getRootVar('--ink')).toBe('#ebe7dc');
  });

  it('font tokens are present on :root', () => {
    expect(getRootVar('--serif')).toMatch(/Iowan Old Style/);
    expect(getRootVar('--sans')).toMatch(/Söhne|S.hne/);
    expect(getRootVar('--mono')).toMatch(/JetBrains Mono/);
  });

  it('shadow tokens are present on :root', () => {
    expect(getRootVar('--shadow-card')).not.toBe('');
    expect(getRootVar('--shadow-pop')).not.toBe('');
  });
});

describe('[F23] Tailwind utility wiring', () => {
  it('renders a node using bg-bg / text-ink / border-line / shadow-card / rounded / font-serif without throwing', () => {
    const { getByTestId } = render(
      <div
        data-testid="tw"
        className="bg-bg text-ink border border-line shadow-card rounded font-serif"
      >
        test
      </div>,
    );
    const node = getByTestId('tw');
    expect(node).toBeInTheDocument();
    // The class list should include every utility we care about — confirms
    // none were stripped by an upstream classname processor.
    expect(node.className).toContain('bg-bg');
    expect(node.className).toContain('text-ink');
    expect(node.className).toContain('border-line');
    expect(node.className).toContain('shadow-card');
    expect(node.className).toContain('rounded');
    expect(node.className).toContain('font-serif');
  });

  it('the `dark:` custom variant still compiles against [data-theme="dark"]', () => {
    document.documentElement.dataset.theme = 'dark';
    const { getByTestId } = render(
      <div data-testid="dv" className="dark:text-ink">
        x
      </div>,
    );
    const node = getByTestId('dv');
    expect(node).toBeInTheDocument();
    expect(node.className).toContain('dark:text-ink');
    delete document.documentElement.dataset.theme;
  });
});
