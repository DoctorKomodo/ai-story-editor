// [F64] Paper renders <EditorEmptyHints> when the editor is empty.

import { QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Paper } from '@/components/Paper';
import { createQueryClient } from '@/lib/queryClient';

function renderPaper(initialBodyJson: unknown): ReturnType<typeof render> {
  const client = createQueryClient();
  return render(
    <QueryClientProvider client={client}>
      <Paper storyTitle="The Long Dark" initialBodyJson={initialBodyJson as never} />
    </QueryClientProvider>,
  );
}

describe('Paper empty hints (F64)', () => {
  it('renders the editor hint strip when the editor is empty', async () => {
    renderPaper(null);
    await waitFor(() => {
      expect(screen.getByTestId('editor-empty-hints')).toBeInTheDocument();
    });
  });

  it('hides the editor hint strip once the editor has content', async () => {
    renderPaper({
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Once upon a time.' }] }],
    });
    await waitFor(() => {
      expect(screen.getByRole('textbox', { name: /chapter body/i })).toBeInTheDocument();
    });
    expect(screen.queryByTestId('editor-empty-hints')).toBeNull();
  });
});
