// [F23] Design-token / theme tests.
//
// Confirms that the three theme palettes (paper / sepia / dark) port the
// exact tokens from `mockups/frontend-prototype/design/styles.css`, and
// that the dark `data-theme` attribute swaps `--bg` / `--ink`.
//
// jsdom subtlety: vitest is configured with `css: false`, so importing
// `index.css` does NOT apply styles. We instead read the file at test
// time and inject it as a <style> into <head>; jsdom's `getComputedStyle`
// can then resolve the custom properties on `:root`. The Tailwind v4
// `@theme { … }` block isn't real CSS jsdom understands, but its body
// IS valid custom-property syntax, so we rewrite `@theme {` to `:root {`
// before injection — that way the literal radius/shadow values declared
// inside `@theme` land on the document root and are observable here.
//
// Real Tailwind utility output (e.g. `bg-bg` resolving to a real color)
// is verified at E2E time (T8) — exercising it here would only test that
// strings echo back, which is meaningless.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
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
  // Inject the token CSS once. Strip directives jsdom can't parse, then
  // rewrite the Tailwind v4 `@theme { … }` block into `:root { … }` so
  // the radius/shadow/color/font tokens declared inside it are visible
  // on the document root via `getComputedStyle`.
  const tokensOnly = cssText
    .replace(/@import[^;]+;/g, '')
    .replace(/@custom-variant[^;]+;/g, '')
    .replace(/@theme\s*\{/g, ':root {');
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
  });

  it('radius tokens are present on :root (declared via @theme)', () => {
    expect(getRootVar('--radius')).toBe('3px');
    expect(getRootVar('--radius-lg')).toBe('6px');
  });

  it('shadow tokens are present on :root (declared via @theme)', () => {
    expect(getRootVar('--shadow-card')).not.toBe('');
    expect(getRootVar('--shadow-pop')).not.toBe('');
  });
});
