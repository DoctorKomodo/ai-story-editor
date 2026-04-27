// [F64] Empty-state hero for the StoryPicker — replaces the single "No stories
// yet" mono line with a centred brand-mark + headline + supporting copy.
// Renders inside StoryPicker's body when stories.length === 0; surfaces
// identically in modal-mode (TopBar / Sidebar opens) and embedded-mode (the
// F58 dashboard primary surface).
import type { JSX } from 'react';

function FeatherMark(): JSX.Element {
  return (
    <svg
      width="28"
      height="28"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M20.24 12.24a6 6 0 0 0-8.49-8.49L5 10.5V19h8.5z" />
      <line x1="16" y1="8" x2="2" y2="22" />
      <line x1="17.5" y1="15" x2="9" y2="15" />
    </svg>
  );
}

export function StoryPickerEmpty(): JSX.Element {
  return (
    <div
      data-testid="story-picker-empty"
      className="flex flex-col items-center justify-center gap-3.5 py-16 px-6 text-center min-h-[280px]"
    >
      <span
        aria-hidden="true"
        className="grid place-items-center w-14 h-14 rounded-[var(--radius)] bg-[var(--accent-soft)] text-ink"
      >
        <FeatherMark />
      </span>
      <h3 className="font-serif text-[20px] font-medium text-ink">Your stories live here</h3>
      <p className="font-sans text-[13px] text-ink-4 max-w-[320px]">
        Start a new project to set the genre, target word count, and writing voice — Inkwell keeps
        every chapter, character, and chat scoped to it.
      </p>
    </div>
  );
}
