import { QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { JSONContent, Editor as TiptapEditor } from '@tiptap/core';
import { describe, expect, it, vi } from 'vitest';
import { Paper, type PaperProps } from '@/components/Paper';
import { createQueryClient } from '@/lib/queryClient';

async function renderAndGrab(
  props: Partial<PaperProps> = {},
): Promise<{ editor: TiptapEditor; unmount: () => void }> {
  let captured: TiptapEditor | null = null;
  const client = createQueryClient();
  const { unmount } = render(
    <QueryClientProvider client={client}>
      <Paper
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

describe('Paper — header + status line', () => {
  it('renders the chapter title as the level-1 heading (editable input, no story title)', async () => {
    const { unmount } = await renderAndGrab({
      chapterId: 'ch-1',
      chapterTitle: 'A Quiet Beginning',
      chapterNumber: 3,
    });

    // Chapter title is the primary heading.
    const heading = screen.getByRole('heading', { level: 1 });
    expect(heading).toBeInTheDocument();
    const input = screen.getByTestId('chapter-title-input') as HTMLInputElement;
    expect(input.value).toBe('A Quiet Beginning');
    // Primary heading scale, not the old italic 22px sub-heading.
    expect(input.className).toMatch(/text-\[28px\]/);
    expect(input.className).not.toMatch(/italic/);
    // Zero-padded § label retained.
    expect(screen.getByTestId('chapter-label')).toHaveTextContent('§ 03');
    unmount();
  });

  it('renders no heading and no story title when no chapter is selected', async () => {
    const { unmount } = await renderAndGrab({});
    expect(screen.queryByRole('heading', { level: 1 })).toBeNull();
    expect(screen.queryByTestId('chapter-heading')).toBeNull();
    unmount();
  });

  it('status line shows draft label + word count and no genre', async () => {
    const { unmount } = await renderAndGrab({
      chapterId: 'ch-1',
      chapterTitle: 'Hollow Crown',
      draftLabel: 'Draft 2',
      initialWordCount: 12345,
    });
    const sub = screen.getByTestId('paper-sub');
    expect(sub).toHaveTextContent('Draft 2');
    expect(sub).toHaveTextContent('12,345 words');
    // Genre is gone: 'Fantasy' would have appeared here before.
    expect(sub).not.toHaveTextContent('Fantasy');
    expect(sub.className).toMatch(/uppercase/);
    expect(sub.className).toMatch(/font-mono/);
    unmount();
  });

  it('word count reflects the open draft and updates live as the body changes', async () => {
    const { editor, unmount } = await renderAndGrab({
      chapterId: 'ch-1',
      chapterTitle: 'Hollow Crown',
      draftLabel: 'Draft 1',
      initialWordCount: 0,
    });
    // Seeded from initialWordCount before any edit.
    expect(screen.getByTestId('paper-sub')).toHaveTextContent('0 words');
    act(() => {
      editor.commands.insertContent('Hello world today');
    });
    await waitFor(() => {
      expect(screen.getByTestId('paper-sub')).toHaveTextContent('3 words');
    });
    unmount();
  });

  it('omits the status chip when storyStatus is null', async () => {
    const { unmount } = await renderAndGrab({
      chapterId: 'ch-1',
      chapterTitle: 'Hollow Crown',
      draftLabel: 'Draft 1',
      initialWordCount: 0,
      storyStatus: null,
    });
    expect(screen.queryByTestId('paper-status-chip')).toBeNull();
    unmount();
  });

  it('omits the chapter heading entirely when no chapterTitle is provided', async () => {
    const { unmount } = await renderAndGrab({ chapterId: 'ch-1' });
    expect(screen.queryByTestId('chapter-heading')).toBeNull();
    unmount();
  });

  it('mounts the editor and accepts initialBodyJson', async () => {
    const initial: JSONContent = {
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'one two three' }] }],
    };
    const { editor, unmount } = await renderAndGrab({ initialBodyJson: initial });
    expect(editor.getText()).toBe('one two three');
    expect(screen.getByRole('textbox', { name: /chapter body/i })).toBeInTheDocument();
    unmount();
  });

  it('fires onUpdate with bodyJson and wordCount when content changes', async () => {
    const onUpdate = vi.fn<(args: { bodyJson: JSONContent; wordCount: number }) => void>();
    const { editor, unmount } = await renderAndGrab({ onUpdate });
    act(() => {
      editor.commands.insertContent('Hello world');
    });
    await waitFor(() => {
      expect(onUpdate).toHaveBeenCalled();
    });
    const lastCall = onUpdate.mock.calls.at(-1);
    expect(lastCall![0].wordCount).toBe(2);
    expect(lastCall![0].bodyJson).toMatchObject({ type: 'doc' });
    unmount();
  });

  it('fires onReady with the editor instance', async () => {
    const onReady = vi.fn<(editor: TiptapEditor | null) => void>();
    const { editor, unmount } = await renderAndGrab({ onReady });
    expect(onReady).toHaveBeenCalled();
    expect(onReady.mock.calls.at(-1)?.[0]).toBe(editor);
    unmount();
  });

  it('chapter title input commits the bound chapterId on blur, not the latest prop', async () => {
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
