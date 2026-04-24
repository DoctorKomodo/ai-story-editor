// [F20] Export button + pure serializer tests.
//
// Scope: covers both the pure `tipTapJsonToPlainText` / `serializeChapterTxt` /
// `serializeStoryTxt` helpers and the `<Export>` React component. The file
// contains indirect assertions for `sanitiseFilename` (via the download
// attribute of the synthesized `<a>`) and `downloadTxt` (via jsdom's real
// anchor click path with `URL.createObjectURL` stubbed).
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { JSONContent } from '@tiptap/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Export } from '@/components/Export';
import { downloadTxt } from '@/lib/downloadTxt';
import { serializeChapterTxt, serializeStoryTxt, tipTapJsonToPlainText } from '@/lib/exportTxt';

function paragraph(text: string): JSONContent {
  return { type: 'paragraph', content: [{ type: 'text', text }] };
}

function heading(level: number, text: string): JSONContent {
  return {
    type: 'heading',
    attrs: { level },
    content: [{ type: 'text', text }],
  };
}

function bulletList(items: string[]): JSONContent {
  return {
    type: 'bulletList',
    content: items.map(
      (t): JSONContent => ({
        type: 'listItem',
        content: [paragraph(t)],
      }),
    ),
  };
}

function makeDoc(nodes: JSONContent[]): JSONContent {
  return { type: 'doc', content: nodes };
}

describe('F20 · tipTapJsonToPlainText', () => {
  it('returns "" for null', () => {
    expect(tipTapJsonToPlainText(null)).toBe('');
  });

  it('returns "" for an empty doc', () => {
    expect(tipTapJsonToPlainText(makeDoc([]))).toBe('');
  });

  it('serializes two paragraphs with exactly one blank line between', () => {
    const doc = makeDoc([paragraph('Hello world.'), paragraph('Second line.')]);
    expect(tipTapJsonToPlainText(doc)).toBe('Hello world.\n\nSecond line.');
  });

  it('serializes a bullet list with three items as three lines (no blanks between)', () => {
    const doc = makeDoc([bulletList(['one', 'two', 'three'])]);
    expect(tipTapJsonToPlainText(doc)).toBe('one\ntwo\nthree');
  });

  it('serializes a heading followed by a paragraph with one blank between', () => {
    const doc = makeDoc([heading(1, 'Title Here'), paragraph('Body.')]);
    expect(tipTapJsonToPlainText(doc)).toBe('Title Here\n\nBody.');
  });

  it('renders a horizontalRule as --- on its own line', () => {
    const doc = makeDoc([paragraph('Before.'), { type: 'horizontalRule' }, paragraph('After.')]);
    expect(tipTapJsonToPlainText(doc)).toBe('Before.\n\n---\n\nAfter.');
  });

  it('renders hardBreak as a single newline within a paragraph', () => {
    const doc = makeDoc([
      {
        type: 'paragraph',
        content: [
          { type: 'text', text: 'line1' },
          { type: 'hardBreak' },
          { type: 'text', text: 'line2' },
        ],
      },
    ]);
    expect(tipTapJsonToPlainText(doc)).toBe('line1\nline2');
  });
});

describe('F20 · serializeChapterTxt / serializeStoryTxt', () => {
  it('prepends the chapter title + blank line before the body', () => {
    const out = serializeChapterTxt({
      title: 'Chapter 1',
      bodyJson: makeDoc([paragraph('Once upon a time.')]),
    });
    expect(out).toBe('Chapter 1\n\nOnce upon a time.');
  });

  it('renders just the title when the body is empty', () => {
    const out = serializeChapterTxt({ title: 'Lonely', bodyJson: null });
    expect(out).toBe('Lonely\n');
  });

  it('joins chapters by "\\n\\n---\\n\\n" after the story title, sorted by orderIndex', () => {
    const story = {
      title: 'My Story',
      chapters: [
        {
          title: 'Second',
          orderIndex: 1,
          bodyJson: makeDoc([paragraph('B body.')]),
        },
        {
          title: 'First',
          orderIndex: 0,
          bodyJson: makeDoc([paragraph('A body.')]),
        },
      ],
    };
    expect(serializeStoryTxt(story)).toBe(
      'My Story\n\nFirst\n\nA body.\n\n---\n\nSecond\n\nB body.',
    );
  });
});

describe('F20 · downloadTxt', () => {
  const originalCreateObjectURL = URL.createObjectURL;
  const originalRevokeObjectURL = URL.revokeObjectURL;
  let clickSpy: ReturnType<typeof vi.spyOn>;
  let capturedAnchor: HTMLAnchorElement | null;

  beforeEach(() => {
    URL.createObjectURL = vi.fn(() => 'blob:mock') as typeof URL.createObjectURL;
    URL.revokeObjectURL = vi.fn() as typeof URL.revokeObjectURL;
    capturedAnchor = null;
    clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
      this: HTMLAnchorElement,
    ): void {
      capturedAnchor = this;
    });
  });

  afterEach(() => {
    URL.createObjectURL = originalCreateObjectURL;
    URL.revokeObjectURL = originalRevokeObjectURL;
    clickSpy.mockRestore();
  });

  it('creates and clicks an <a> with the expected download attribute and blob: href', () => {
    downloadTxt('foo.txt', 'hello');

    expect(clickSpy).toHaveBeenCalledTimes(1);
    expect(capturedAnchor).not.toBeNull();
    expect(capturedAnchor?.getAttribute('download')).toBe('foo.txt');
    expect(capturedAnchor?.getAttribute('href')).toMatch(/^blob:/);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:mock');
  });
});

describe('F20 · <Export> component', () => {
  const originalCreateObjectURL = URL.createObjectURL;
  const originalRevokeObjectURL = URL.revokeObjectURL;
  let clickSpy: ReturnType<typeof vi.spyOn>;
  let capturedAnchor: HTMLAnchorElement | null;
  let capturedBlobs: Blob[];

  beforeEach(() => {
    capturedAnchor = null;
    capturedBlobs = [];
    URL.createObjectURL = vi.fn((obj: Blob | MediaSource): string => {
      if (obj instanceof Blob) capturedBlobs.push(obj);
      return 'blob:mock';
    }) as typeof URL.createObjectURL;
    URL.revokeObjectURL = vi.fn() as typeof URL.revokeObjectURL;
    clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
      this: HTMLAnchorElement,
    ): void {
      capturedAnchor = this;
    });
  });

  afterEach(() => {
    URL.createObjectURL = originalCreateObjectURL;
    URL.revokeObjectURL = originalRevokeObjectURL;
    clickSpy.mockRestore();
  });

  const sampleStory = {
    id: 'story-1',
    title: 'My Story',
    chapters: [
      {
        id: 'ch-1',
        title: 'First Chapter',
        orderIndex: 0,
        bodyJson: makeDoc([paragraph('Opening line.')]),
      },
      {
        id: 'ch-2',
        title: 'The Ocean: A Journey/Part',
        orderIndex: 1,
        bodyJson: makeDoc([paragraph('Into the sea.')]),
      },
    ],
  };

  it('disables the chapter export button when activeChapterId is null', async () => {
    render(<Export story={sampleStory} activeChapterId={null} />);
    await userEvent.click(screen.getByRole('button', { name: /export/i }));
    const chapterBtn = screen.getByRole('menuitem', { name: /export chapter/i });
    expect(chapterBtn).toBeDisabled();
  });

  it('exports chapter content beginning with title + blank line + body', async () => {
    render(<Export story={sampleStory} activeChapterId="ch-1" />);
    await userEvent.click(screen.getByRole('button', { name: /export/i }));
    await userEvent.click(screen.getByRole('menuitem', { name: /export chapter/i }));

    expect(capturedAnchor).not.toBeNull();
    expect(capturedAnchor?.getAttribute('download')).toBe('First Chapter.txt');
    expect(capturedAnchor?.getAttribute('href')).toMatch(/^blob:/);

    expect(capturedBlobs.length).toBe(1);
    const text = await capturedBlobs[0]!.text();
    expect(text).toBe('First Chapter\n\nOpening line.');
  });

  it('sanitises the chapter filename (replaces : and / with -, collapses whitespace)', async () => {
    render(<Export story={sampleStory} activeChapterId="ch-2" />);
    await userEvent.click(screen.getByRole('button', { name: /export/i }));
    await userEvent.click(screen.getByRole('menuitem', { name: /export chapter/i }));

    expect(capturedAnchor).not.toBeNull();
    expect(capturedAnchor?.getAttribute('download')).toBe('The Ocean- A Journey-Part.txt');
  });

  it('exports full story with chapters joined by "\\n\\n---\\n\\n" sorted by orderIndex', async () => {
    // Pass chapters out of order to confirm sort.
    const reversed = {
      ...sampleStory,
      chapters: [sampleStory.chapters[1]!, sampleStory.chapters[0]!],
    };
    render(<Export story={reversed} activeChapterId={null} />);
    await userEvent.click(screen.getByRole('button', { name: /export/i }));
    await userEvent.click(screen.getByRole('menuitem', { name: /export full story/i }));

    expect(capturedAnchor).not.toBeNull();
    expect(capturedAnchor?.getAttribute('download')).toBe('My Story.txt');
    expect(capturedBlobs.length).toBe(1);
    const text = await capturedBlobs[0]!.text();
    expect(text).toBe(
      'My Story\n\nFirst Chapter\n\nOpening line.\n\n---\n\nThe Ocean: A Journey/Part\n\nInto the sea.',
    );
  });
});
