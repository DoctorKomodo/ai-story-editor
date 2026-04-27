// [F66] Typography input rules for the prose surface. Two pure rules,
// each gated by a B11 writing setting:
//   - Smart quotes:    `'` and `"` → `‘ ’` / `“ ”` (directional).
//   - Em-dash:         `--` → `—`.
//
// Wrapped in TipTap Extensions so the editor can be remounted with a
// fresh extension list when the user flips the toggle. Hot-swapping a
// single rule at runtime isn't supported by TipTap; remount is the
// canonical pattern.

import { Extension, InputRule } from '@tiptap/core';

interface TypographyOptions {
  smartQuotes: boolean;
  emDashExpansion: boolean;
}

// Characters that, when immediately preceding a quote, indicate the
// quote opens a span rather than closes one.
const OPENING_PRECEDERS = /[\s([{`'"]/;

function makeSmartQuoteRule(straight: '"' | "'", openCurly: string, closeCurly: string): InputRule {
  return new InputRule({
    find: straight === '"' ? /"$/ : /'$/,
    handler: ({ state, range }) => {
      const { from } = range;
      const before = from > 0 ? state.doc.textBetween(from - 1, from, undefined, ' ') : '';
      const useOpening = before.length === 0 || OPENING_PRECEDERS.test(before);
      const replacement = useOpening ? openCurly : closeCurly;
      state.tr.replaceWith(range.from, range.to, state.schema.text(replacement));
    },
  });
}

function makeEmDashRule(): InputRule {
  return new InputRule({
    find: /--$/,
    handler: ({ state, range }) => {
      state.tr.replaceWith(range.from, range.to, state.schema.text('—'));
    },
  });
}

const SmartQuotes = Extension.create({
  name: 'inkwellSmartQuotes',
  addInputRules() {
    return [makeSmartQuoteRule('"', '“', '”'), makeSmartQuoteRule("'", '‘', '’')];
  },
});

const EmDash = Extension.create({
  name: 'inkwellEmDash',
  addInputRules() {
    return [makeEmDashRule()];
  },
});

export function getTypographyExtensions({
  smartQuotes,
  emDashExpansion,
}: TypographyOptions): Extension[] {
  const out: Extension[] = [];
  if (smartQuotes) out.push(SmartQuotes);
  if (emDashExpansion) out.push(EmDash);
  return out;
}
