// [F20] Export button — client-side .txt download for the current chapter
// or the full story.
//
// Scope: a minimal button-driven disclosure with two menu actions. No mockup
// fidelity — this is a functional control placed in the editor header next to
// the user menu.
//
// The component is dumb: it receives already-loaded chapter JSON from the
// caller and does all the work in the browser. No backend route; the task
// text explicitly forbids one.

import { useCallback, useEffect, useRef, useState } from 'react';
import type { JSONContent } from '@tiptap/core';
import { serializeChapterTxt, serializeStoryTxt } from '@/lib/exportTxt';
import { downloadTxt } from '@/lib/downloadTxt';

export interface ExportStoryChapter {
  id: string;
  title: string;
  orderIndex: number;
  bodyJson: JSONContent | null;
}

export interface ExportStory {
  id: string;
  title: string;
  chapters: ExportStoryChapter[];
}

export interface ExportProps {
  story: ExportStory;
  activeChapterId: string | null;
}

/**
 * Strip path-unsafe chars from a filename, collapse whitespace, and fall back
 * to "Untitled" when the result is empty. Callers append `.txt` themselves.
 */
function sanitiseFilename(raw: string): string {
  const replaced = raw.replace(/[\\/:*?"<>|]/g, '-');
  const collapsed = replaced.replace(/\s+/g, ' ').trim();
  return collapsed === '' ? 'Untitled' : collapsed;
}

export function Export({ story, activeChapterId }: ExportProps): JSX.Element {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);

  const activeChapter =
    activeChapterId === null
      ? null
      : story.chapters.find((c) => c.id === activeChapterId) ?? null;

  useEffect(() => {
    if (!open) return;

    const handleMouseDown = (event: MouseEvent): void => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (containerRef.current && containerRef.current.contains(target)) return;
      setOpen(false);
    };

    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        setOpen(false);
      }
    };

    document.addEventListener('mousedown', handleMouseDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleMouseDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [open]);

  const handleExportChapter = useCallback((): void => {
    if (activeChapter === null) return;
    const content = serializeChapterTxt(activeChapter);
    const filename = `${sanitiseFilename(activeChapter.title)}.txt`;
    downloadTxt(filename, content);
    setOpen(false);
  }, [activeChapter]);

  const handleExportStory = useCallback((): void => {
    const content = serializeStoryTxt(story);
    const filename = `${sanitiseFilename(story.title)}.txt`;
    downloadTxt(filename, content);
    setOpen(false);
  }, [story]);

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls="export-menu-panel"
        onClick={() => {
          setOpen((v) => !v);
        }}
        className="rounded border border-neutral-300 bg-white px-3 py-1.5 text-sm font-medium hover:bg-neutral-100 transition-colors"
      >
        Export
      </button>

      {open ? (
        <div
          id="export-menu-panel"
          role="menu"
          aria-label="Export menu"
          className="absolute right-0 mt-1 w-48 rounded border border-neutral-200 bg-white py-1 shadow-md z-10"
        >
          <button
            type="button"
            role="menuitem"
            onClick={handleExportChapter}
            disabled={activeChapter === null}
            className="block w-full px-3 py-1.5 text-left text-sm hover:bg-neutral-100 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-transparent"
          >
            Export chapter
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={handleExportStory}
            className="block w-full px-3 py-1.5 text-left text-sm hover:bg-neutral-100"
          >
            Export full story
          </button>
        </div>
      ) : null}
    </div>
  );
}
