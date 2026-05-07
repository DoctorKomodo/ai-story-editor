import { describe, expect, it } from 'vitest';
import { GLOBAL_TEXT_GEN_DEFAULTS } from '@/lib/text-gen-defaults';

describe('GLOBAL_TEXT_GEN_DEFAULTS', () => {
  it('is the canonical text-generation defaults shape', () => {
    expect(GLOBAL_TEXT_GEN_DEFAULTS).toEqual({
      temperature: 0.85,
      topP: 0.95,
      maxTokens: 800,
    });
  });

  it('frontend/src/lib/textGenDefaults.ts hardcodes the same values', async () => {
    const fs = await import('node:fs/promises');
    const path = await import('node:path');
    const here = path.dirname(new URL(import.meta.url).pathname);
    const frontendFile = path.resolve(here, '../../../frontend/src/lib/textGenDefaults.ts');
    const text = await fs.readFile(frontendFile, 'utf8');
    expect(text).toMatch(/temperature:\s*0\.85/);
    expect(text).toMatch(/topP:\s*0\.95/);
    expect(text).toMatch(/maxTokens:\s*800\b/);
  });
});
