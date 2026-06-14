import { describe, expect, it } from 'vitest';
import { GLOBAL_TEXT_GEN_DEFAULTS, MAX_OUTPUT_TOKENS_CEILING } from '@/lib/text-gen-defaults';

describe('GLOBAL_TEXT_GEN_DEFAULTS', () => {
  it('is the canonical text-generation defaults shape', () => {
    expect(GLOBAL_TEXT_GEN_DEFAULTS).toEqual({
      temperature: 1.0,
      topP: 0.95,
      maxTokens: 800,
    });
  });

  it('frontend/src/lib/textGenDefaults.ts hardcodes the same values', async () => {
    const fs = await import('node:fs/promises');
    const path = await import('node:path');
    const here = __dirname;
    const frontendFile = path.resolve(here, '../../../frontend/src/lib/textGenDefaults.ts');
    const text = await fs.readFile(frontendFile, 'utf8');
    expect(text).toMatch(/temperature:\s*1(\.0)?\b/);
    expect(text).toMatch(/topP:\s*0\.95/);
    expect(text).toMatch(/maxTokens:\s*800\b/);
  });

  it('exposes MAX_OUTPUT_TOKENS_CEILING and the frontend mirror matches', async () => {
    expect(MAX_OUTPUT_TOKENS_CEILING).toBe(32_000);
    const fs = await import('node:fs/promises');
    const path = await import('node:path');
    const here = __dirname;
    const frontendFile = path.resolve(here, '../../../frontend/src/lib/textGenDefaults.ts');
    const text = await fs.readFile(frontendFile, 'utf8');
    expect(text).toMatch(/MAX_OUTPUT_TOKENS_CEILING\s*=\s*32_?000\b/);
  });
});
