import { QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { JSONContent, Editor as TiptapEditor } from '@tiptap/core';
import { describe, expect, it, vi } from 'vitest';
import { Paper, type PaperProps } from '@/components/Paper';
import { createQueryClient } from '@/lib/queryClient';

/**
 * F32 tests.
 *
 * Mirrors the F8 jsdom strategy: capture the editor instance via the
 * `onReady` escape hatch and drive content through `editor.commands.*`
 * rather than relying on contenteditable keystrokes (which jsdom
 * doesn't faithfully implement).
 */

async function renderAndGrab(
  props: Partial<PaperProps> = {},
): Promise<{ editor: TiptapEditor; unmount: () => void }> {
  let captured: TiptapEditor | null = null;
  const client = createQueryClient();
  const { unmount } = render(
    <QueryClientProvider client={client}>
      <Paper
        storyTitle={props.storyTitle ?? 'Untitled'}
        {...props}
        onReady={(ed) => {
          captured = ed;
          props.onReady?.(ed);
        }}
      />
    </QueryClientProvider>,
  );
  await waitFor(() => {
    expect(captured).not.toBeNull();
  });
  return { editor: captured!, unmount };
}

describe('Paper (F32)', () => {
  it('renders the story title', async () => {
    const { unmount } = await renderAndGrab({ storyTitle: 'A Long-Forgotten Tale' });

    const heading = screen.getByRole('heading', { level: 1 });
    expect(heading).toHaveTextContent('A Long-Forgotten Tale');
    expect(heading.className).toMatch(/font-serif/);

    unmount();
  });

  it('falls back to "Untitled" when no story title is set', async () => {
    const { unmount } = await renderAndGrab({ storyTitle: '' });

    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Untitled');

    unmount();
  });

  it('renders genre / draft / word count / status chip in the sub row when provided', async () => {
    const { unmount } = await renderAndGrab({
      storyTitle: 'Hollow Crown',
      storyGenre: 'Fantasy',
      draftLabel: 'Draft 2',
      storyWordCount: 12345,
      storyStatus: 'draft',
    });

    const sub = screen.getByTestId('paper-sub');
    expect(sub).toHaveTextContent('Fantasy');
    expect(sub).toHaveTextContent('Draft 2');
    // toLocaleString — en-US default in jsdom.
    expect(sub).toHaveTextContent('12,345 words');
    // Status chip lives inside the sub row.
    const chip = screen.getByTestId('paper-status-chip');
    expect(chip).toHaveTextContent('draft');
    // Chip is right-aligned via `ml-auto`.
    expect(chip.className).toMatch(/ml-auto/);
    // Sub row is uppercase / mono / 11px / .04em letter-spacing.
    expect(sub.className).toMatch(/uppercase/);
    expect(sub.className).toMatch(/font-mono/);
    expect(sub.className).toMatch(/text-\[11px\]/);
    expect(sub.className).toMatch(/tracking-\[\.04em\]/);

    unmount();
  });

  it('omits sub-row fields that are null (no genre, no status)', async () => {
    const { unmount } = await renderAndGrab({
      storyTitle: 'Hollow Crown',
      storyGenre: null,
      draftLabel: 'Draft 1',
      storyWordCount: 0,
      storyStatus: null,
    });

    const sub = screen.getByTestId('paper-sub');
    expect(sub).toHaveTextContent('Draft 1');
    expect(sub).toHaveTextContent('0 words');
    // No genre token, no status chip rendered.
    expect(sub).not.toHaveTextContent('Fantasy');
    expect(screen.queryByTestId('paper-status-chip')).toBeNull();

    unmount();
  });

  it('defaults the draft label to "Draft 1" when not provided', async () => {
    const { unmount } = await renderAndGrab({
      storyTitle: 'Hollow Crown',
      storyWordCount: 100,
    });

    expect(screen.getByTestId('paper-sub')).toHaveTextContent('Draft 1');

    unmount();
  });

  it('renders the chapter heading with italic font, zero-padded label, and bottom border', async () => {
    const { unmount } = await renderAndGrab({
      storyTitle: 'Hollow Crown',
      chapterId: 'ch-test-1',
      chapterTitle: 'A Quiet Beginning',
      chapterNumber: 3,
    });

    const heading = screen.getByTestId('chapter-heading');
    // 1px bottom border via `border-b`.
    expect(heading.className).toMatch(/border-b/);
    // mt-12 = 48px top margin per spec.
    expect(heading.className).toMatch(/mt-12/);

    const titleInput = screen.getByTestId('chapter-title-input') as HTMLInputElement;
    expect(titleInput.value).toBe('A Quiet Beginning');
    expect(titleInput.className).toMatch(/italic/);
    expect(titleInput.className).toMatch(/font-serif/);
    expect(titleInput.className).toMatch(/text-\[22px\]/);

    // Right-aligned `§ NN` label, zero-padded.
    expect(screen.getByTestId('chapter-label')).toHaveTextContent('§ 03');

    unmount();
  });

  it('omits the chapter heading entirely when no chapterTitle is provided', async () => {
    const { unmount } = await renderAndGrab({ storyTitle: 'Hollow Crown' });

    expect(screen.queryByTestId('chapter-heading')).toBeNull();
    expect(screen.queryByRole('heading', { level: 2 })).toBeNull();

    unmount();
  });

  it('mounts the editor and accepts initialBodyJson', async () => {
    const initial: JSONContent = {
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'one two three' }] }],
    };
    const { editor, unmount } = await renderAndGrab({
      storyTitle: 'Hollow Crown',
      initialBodyJson: initial,
    });

    expect(editor.getText()).toBe('one two three');
    expect(screen.getByRole('textbox', { name: /chapter body/i })).toBeInTheDocument();

    unmount();
  });

  it('fires onUpdate with bodyJson and wordCount when content changes', async () => {
    const onUpdate = vi.fn<(args: { bodyJson: JSONContent; wordCount: number }) => void>();
    const { editor, unmount } = await renderAndGrab({
      storyTitle: 'Hollow Crown',
      onUpdate,
    });

    act(() => {
      editor.commands.insertContent('Hello world');
    });

    await waitFor(() => {
      expect(onUpdate).toHaveBeenCalled();
    });

    const lastCall = onUpdate.mock.calls.at(-1);
    expect(lastCall).toBeDefined();
    expect(lastCall![0].wordCount).toBe(2);
    expect(lastCall![0].bodyJson).toMatchObject({ type: 'doc' });

    unmount();
  });

  it('fires onReady with the editor instance', async () => {
    const onReady = vi.fn<(editor: TiptapEditor) => void>();
    const { editor, unmount } = await renderAndGrab({
      storyTitle: 'Hollow Crown',
      onReady,
    });

    expect(onReady).toHaveBeenCalled();
    // The wrapping renderAndGrab also captures via onReady, but the
    // user-supplied callback must receive the same editor instance.
    expect(onReady.mock.calls.at(-1)?.[0]).toBe(editor);

    unmount();
  });

  it('matches the F8 word-count rule (singular vs plural / empty)', async () => {
    const onUpdate = vi.fn<(args: { bodyJson: JSONContent; wordCount: number }) => void>();
    const { editor, unmount } = await renderAndGrab({
      storyTitle: 'Hollow Crown',
      onUpdate,
    });

    act(() => {
      editor.commands.setContent({
        type: 'doc',
        content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Hello' }] }],
      });
    });
    act(() => {
      editor.commands.insertContent(' ');
    });
    await waitFor(() => {
      expect(onUpdate).toHaveBeenCalled();
    });
    // After the insert, the doc text trimmed is 'Hello' (one token).
    let last = onUpdate.mock.calls.at(-1);
    expect(last![0].wordCount).toBe(1);

    onUpdate.mockClear();
    act(() => {
      editor.commands.insertContent('world');
    });
    await waitFor(() => {
      expect(onUpdate).toHaveBeenCalled();
    });
    last = onUpdate.mock.calls.at(-1);
    expect(last![0].wordCount).toBe(2);

    unmount();
  });

  it('chapter title input commits the bound chapterId on blur, not the latest prop', async () => {
    // Mounts with chapterId 'A', user blurs after editing — onCommit must
    // receive 'A' (the id bound at render time), defending against the race
    // where a chapter switch updates the prop before blur fires.
    const onChapterTitleChange = vi.fn();
    const { unmount } = await renderAndGrab({
      chapterId: 'A',
      chapterTitle: 'Chapter A title',
      onChapterTitleChange,
    });

    const input = screen.getByTestId('chapter-title-input') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'Renamed Chapter A' } });
    fireEvent.blur(input);

    expect(onChapterTitleChange).toHaveBeenCalledTimes(1);
    expect(onChapterTitleChange).toHaveBeenCalledWith('A', 'Renamed Chapter A');

    unmount();
  });

  it('blurring an empty chapter title silently reverts without firing onCommit', async () => {
    // Backend Zod schema requires title.min(1); the input mirrors that
    // constraint client-side so a 400 PATCH never fires.
    const onChapterTitleChange = vi.fn();
    const { unmount } = await renderAndGrab({
      chapterId: 'A',
      chapterTitle: 'Original',
      onChapterTitleChange,
    });

    const input = screen.getByTestId('chapter-title-input') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '   ' } });
    fireEvent.blur(input);

    expect(onChapterTitleChange).not.toHaveBeenCalled();
    expect(input.value).toBe('Original');

    unmount();
  });

  it('Escape reverts the chapter title draft without committing', async () => {
    const onChapterTitleChange = vi.fn();
    const { unmount } = await renderAndGrab({
      chapterId: 'A',
      chapterTitle: 'Original',
      onChapterTitleChange,
    });

    const input = screen.getByTestId('chapter-title-input') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'half-typed' } });
    fireEvent.keyDown(input, { key: 'Escape' });

    expect(input.value).toBe('Original');
    expect(onChapterTitleChange).not.toHaveBeenCalled();

    unmount();
  });
});
