import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { AIResult } from '@/components/AIResult';

describe('AIResult (F15) · design tokens', () => {
  it('done state renders with the design-system token classes (no raw Tailwind colors)', () => {
    render(
      <AIResult
        status="done"
        text="Hello world."
        error={null}
        onInsertAtCursor={vi.fn()}
        onDismiss={vi.fn()}
      />,
    );
    const card = screen.getByTestId('ai-result');
    expect(card.className).not.toMatch(/\b(neutral|red|blue|gray|slate)-\d/);
    expect(card).toHaveClass('border-line');
    expect(card).toHaveClass('bg-bg-sunken');
    expect(card).toHaveClass('text-ink-2');
  });

  it('error state uses text-danger (no red-* literal)', () => {
    render(
      <AIResult
        status="error"
        text=""
        error={{ name: 'ApiError', message: 'boom', status: 500, code: 'oops' } as never}
        onInsertAtCursor={vi.fn()}
        onDismiss={vi.fn()}
      />,
    );
    const alert = screen.getByRole('alert');
    expect(alert.className).not.toMatch(/\b(neutral|red|blue|gray|slate)-\d/);
    expect(alert).toHaveClass('text-danger');
  });
});
