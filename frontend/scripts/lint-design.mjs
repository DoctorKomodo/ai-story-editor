#!/usr/bin/env node
/**
 * lint:design — fail CI on Camp B (raw Tailwind palette / hex / mid-tier
 * shadow / focus-ring) drift in the Inkwell frontend.
 *
 * See MIGRATION.md § "Substitution table" for the token replacements.
 *
 * Wired into CI via `npm run -w frontend lint:design` (or
 * `cd frontend && npm run lint:design`).
 *
 * Pure-Node implementation: walks `src` for .ts/.tsx files and scans each
 * line against the drift patterns. Has no external dependencies — runs on
 * any CI runner with Node, no ripgrep install required.
 *
 * Exits 0 if clean, 1 if drift found, 2 on infrastructure error.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

// =============================================================================
// Patterns — six categories of drift, all token violations.
// =============================================================================

const PATTERNS = [
  // 1. Tailwind palette colors. Every numbered palette has a token equivalent.
  /\b(neutral|red|blue|gray|slate|zinc|stone|green|yellow|amber|orange|lime|emerald|teal|cyan|sky|indigo|violet|purple|fuchsia|pink|rose)-(50|100|200|300|400|500|600|700|800|900|950)\b/,

  // 2. Black / white literals. Use bg-bg / bg-bg-elevated / text-ink / text-bg.
  /\b(bg|text|border|ring|fill|stroke|from|to|via)-(white|black)\b/,

  // 3. Mid-tier shadows we don't ship. Use shadow-card or shadow-pop.
  /\bshadow-(sm|md|lg|xl|2xl)\b/,

  // 4. Arbitrary-value escapes that bypass the token system.
  //    bg-[#fff], text-[rgb(0,0,0)], etc.
  //    bg-[var(--token)] is FINE and not matched.
  /\[(?:color:)?(?:#|rgb|hsl|oklch|hwb)/,

  // 5. Raw hex codes in source (3, 4, 6, or 8 hex digits).
  /#[0-9a-fA-F]{3,8}\b/,

  // 6. Focus rings. Inkwell uses focus:border-ink-3 — no ring.
  /\bfocus:ring(?:-\w+)*\b/,
];

// =============================================================================
// Files exempt from the rule (relative to `src/`).
// =============================================================================

const EXCLUDE_FILES = new Set(['index.css']);
const EXCLUDE_SUFFIXES = ['.stories.tsx', '.stories.ts', '.test.tsx', '.test.ts', '.spec.tsx', '.spec.ts'];
const INCLUDE_EXTENSIONS = new Set(['.ts', '.tsx']);

// =============================================================================
// Marker: a comment that lets a single line opt out.
//   const ICON_BLACK = '#000000';  // lint:design-allow — SVG fill
// Use sparingly — every allowlist entry is a tiny crack in the wall.
// =============================================================================

const ALLOW_MARKER = 'lint:design-allow';

// =============================================================================
// Walk + scan.
// =============================================================================

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FRONTEND = path.resolve(__dirname, '..');
const ROOT = path.join(FRONTEND, 'src');

function isExcluded(relPath) {
  const base = path.basename(relPath);
  if (EXCLUDE_FILES.has(base)) return true;
  for (const sfx of EXCLUDE_SUFFIXES) if (base.endsWith(sfx)) return true;
  return false;
}

function* walk(dir) {
  for (const entry of readdirSync(dir)) {
    const abs = path.join(dir, entry);
    let st;
    try {
      st = statSync(abs);
    } catch {
      continue;
    }
    if (st.isDirectory()) {
      yield* walk(abs);
      continue;
    }
    const ext = path.extname(entry);
    if (!INCLUDE_EXTENSIONS.has(ext)) continue;
    const rel = path.relative(ROOT, abs);
    if (isExcluded(rel)) continue;
    yield abs;
  }
}

const hits = [];
try {
  for (const file of walk(ROOT)) {
    const text = readFileSync(file, 'utf8');
    const lines = text.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (line.includes(ALLOW_MARKER)) continue;
      for (const pat of PATTERNS) {
        if (pat.test(line)) {
          hits.push(`${path.relative(FRONTEND, file)}:${i + 1}:${line.trim()}`);
          break;
        }
      }
    }
  }
} catch (err) {
  console.error('lint:design failed:', err.message);
  process.exit(2);
}

if (hits.length === 0) {
  console.log('✓ No design-token drift.');
  process.exit(0);
}

console.error(
  `\n❌ Design-token drift detected (${hits.length} violation${hits.length === 1 ? '' : 's'}):\n`,
);
for (const h of hits) console.error('  ' + h);
console.error('\nSee MIGRATION.md § "Substitution table" for token replacements.');
console.error(`To allowlist a single line, append:  // ${ALLOW_MARKER} — <reason>\n`);
process.exit(1);
