import type { JSX } from 'react';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useCharRefSuggestionStore } from '@/store/charRefSuggestion';

const MENU_WIDTH = 240;
const MENU_GAP = 4;
const MAX_HEIGHT_VH = 0.4;

interface MenuPosition {
  left: number;
  top: number;
  flipped: boolean;
}

function computePosition(
  rect: DOMRect | null,
  menuHeight: number,
  viewportHeight: number,
  viewportWidth: number,
): MenuPosition | null {
  if (!rect) return null;
  const wantBelow = rect.bottom + MENU_GAP + menuHeight <= viewportHeight;
  const top = wantBelow ? rect.bottom + MENU_GAP : Math.max(8, rect.top - MENU_GAP - menuHeight);
  const left = Math.min(rect.left, viewportWidth - MENU_WIDTH - 8);
  return { left, top, flipped: !wantBelow };
}

function HighlightedName({ name, query }: { name: string; query: string }): JSX.Element {
  if (query.length === 0) return <>{name}</>;
  const lower = name.toLowerCase();
  const idx = lower.indexOf(query.toLowerCase());
  if (idx < 0) return <>{name}</>;
  return (
    <>
      {name.slice(0, idx)}
      <mark className="bg-transparent font-medium text-[var(--ink)]">
        {name.slice(idx, idx + query.length)}
      </mark>
      {name.slice(idx + query.length)}
    </>
  );
}

export function CharRefMenu(): JSX.Element | null {
  const open = useCharRefSuggestionStore((s) => s.open);
  const items = useCharRefSuggestionStore((s) => s.items);
  const activeIndex = useCharRefSuggestionStore((s) => s.activeIndex);
  const query = useCharRefSuggestionStore((s) => s.query);
  const clientRect = useCharRefSuggestionStore((s) => s.clientRect);
  const onSelect = useCharRefSuggestionStore((s) => s.onSelect);
  const ref = useRef<HTMLDivElement | null>(null);
  const [size, setSize] = useState<{ vw: number; vh: number; menuH: number }>(() => ({
    vw: typeof window !== 'undefined' ? window.innerWidth : 1024,
    vh: typeof window !== 'undefined' ? window.innerHeight : 768,
    menuH: 0,
  }));

  useEffect(() => {
    if (!open) return;
    const onResize = (): void => {
      setSize((prev) => ({ ...prev, vw: window.innerWidth, vh: window.innerHeight }));
    };
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    if (!ref.current) return;
    setSize((prev) => ({ ...prev, menuH: ref.current?.offsetHeight ?? 0 }));
  }, [open, items.length]);

  if (!open) return null;

  const position = computePosition(clientRect, size.menuH, size.vh, size.vw);
  if (!position) return null;

  const isEmpty = items.length === 0;

  const containerProps = isEmpty
    ? ({ 'data-testid': 'char-ref-menu' } as const)
    : { role: 'listbox' as const, 'aria-label': 'Characters', 'data-testid': 'char-ref-menu' };

  return createPortal(
    <div
      ref={ref}
      {...containerProps}
      style={{
        position: 'fixed',
        left: position.left,
        top: position.top,
        width: MENU_WIDTH,
        maxHeight: `${String(Math.floor(size.vh * MAX_HEIGHT_VH))}px`,
        overflowY: 'auto',
        zIndex: 60,
      }}
      className="bg-[var(--bg-elevated)] border border-[var(--line-2)] rounded-[var(--radius)] shadow-[0_4px_16px_rgba(0,0,0,0.08)] py-1"
    >
      {isEmpty ? (
        <p className="px-2.5 py-2 text-[12px] text-[var(--ink-3)] m-0">
          No characters in this story yet.
        </p>
      ) : (
        items.map((item, i) => (
          <button
            type="button"
            key={item.id}
            id={`charref-opt-${item.id}`}
            role="option"
            aria-selected={i === activeIndex}
            onMouseDown={(e) => {
              e.preventDefault();
              if (onSelect) onSelect(item);
            }}
            className={`w-full text-left px-2.5 py-1.5 flex items-baseline gap-2 transition-colors ${
              i === activeIndex
                ? 'bg-[var(--surface-hover)]'
                : 'bg-transparent hover:bg-[var(--surface-hover)]'
            }`}
          >
            <span className="text-[13px] text-[var(--ink)]">
              <HighlightedName name={item.name} query={query} />
            </span>
            {item.role ? (
              <span className="text-[11px] text-[var(--ink-4)] ml-auto">{item.role}</span>
            ) : null}
          </button>
        ))
      )}
    </div>,
    document.body,
  );
}
