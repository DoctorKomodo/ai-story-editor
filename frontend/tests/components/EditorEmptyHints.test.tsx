// [F64] Three-segment mono hint strip rendered below an empty Paper.

import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { EditorEmptyHints } from '@/components/EditorEmptyHints';

describe('EditorEmptyHints (F64)', () => {
  it('renders three hint segments', () => {
    render(<EditorEmptyHints />);
    expect(screen.getByText(/select text → bubble/i)).toBeInTheDocument();
    expect(screen.getByText(/hover names → card/i)).toBeInTheDocument();
    expect(screen.getByText(/⌥↵ → continue/i)).toBeInTheDocument();
    expect(screen.getByTestId('editor-empty-hints')).toBeInTheDocument();
  });
});
