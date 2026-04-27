// [F64] Three-segment mono hint strip rendered below an empty Paper. Pure
// presentational — Paper toggles visibility off the live editor.isEmpty.
import type { JSX } from 'react';

export function EditorEmptyHints(): JSX.Element {
  return (
    <div
      data-testid="editor-empty-hints"
      className="mt-8 pt-3 border-t border-line flex justify-center gap-[18px] font-mono text-[11px] uppercase tracking-[.04em] text-ink-4"
    >
      <span>select text → bubble</span>
      <span aria-hidden="true" className="text-ink-5">
        ·
      </span>
      <span>hover names → card</span>
      <span aria-hidden="true" className="text-ink-5">
        ·
      </span>
      <span>⌥↵ → continue</span>
    </div>
  );
}
