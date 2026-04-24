import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { WebSearchToggle } from '@/components/WebSearchToggle';
import type { Model } from '@/hooks/useModels';

function makeModel(overrides: Partial<Model> = {}): Model {
  return {
    id: 'm1',
    name: 'Model One',
    contextLength: 32000,
    supportsReasoning: false,
    supportsVision: false,
    supportsWebSearch: false,
    ...overrides,
  };
}

describe('WebSearchToggle (F14)', () => {
  it('returns null when model is null', () => {
    const { container } = render(
      <WebSearchToggle model={null} checked={false} onChange={vi.fn()} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('returns null when model.supportsWebSearch is false', () => {
    const model = makeModel({ supportsWebSearch: false });
    const { container } = render(
      <WebSearchToggle model={model} checked={false} onChange={vi.fn()} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('renders the checkbox, label "Web search", and helper text when model.supportsWebSearch is true', () => {
    const model = makeModel({ supportsWebSearch: true });
    render(<WebSearchToggle model={model} checked={false} onChange={vi.fn()} />);

    const checkbox = screen.getByRole('checkbox', { name: /web search/i });
    expect(checkbox).toBeInTheDocument();
    expect(screen.getByText('Web search')).toBeInTheDocument();
    expect(screen.getByText('May increase response time and cost.')).toBeInTheDocument();
  });

  it('checkbox `checked` reflects the `checked` prop', () => {
    const model = makeModel({ supportsWebSearch: true });
    const { rerender } = render(
      <WebSearchToggle model={model} checked={false} onChange={vi.fn()} />,
    );
    const checkbox = screen.getByRole('checkbox', { name: /web search/i }) as HTMLInputElement;
    expect(checkbox.checked).toBe(false);

    rerender(<WebSearchToggle model={model} checked={true} onChange={vi.fn()} />);
    expect(checkbox.checked).toBe(true);
  });

  it('calls onChange(true) and then onChange(false) as the user toggles', async () => {
    const user = userEvent.setup();
    const model = makeModel({ supportsWebSearch: true });
    const onChange = vi.fn();

    const { rerender } = render(
      <WebSearchToggle model={model} checked={false} onChange={onChange} />,
    );

    await user.click(screen.getByRole('checkbox', { name: /web search/i }));
    expect(onChange).toHaveBeenNthCalledWith(1, true);

    rerender(<WebSearchToggle model={model} checked={true} onChange={onChange} />);

    await user.click(screen.getByRole('checkbox', { name: /web search/i }));
    expect(onChange).toHaveBeenNthCalledWith(2, false);
  });

  it('sets aria-describedby on the input to the hint paragraph id, and the hint paragraph exists at that id', () => {
    const model = makeModel({ supportsWebSearch: true });
    render(<WebSearchToggle model={model} checked={false} onChange={vi.fn()} />);

    const checkbox = screen.getByRole('checkbox', { name: /web search/i });
    const describedBy = checkbox.getAttribute('aria-describedby');
    expect(describedBy).toBe('ai-web-search-hint');

    const hint = document.getElementById('ai-web-search-hint');
    expect(hint).not.toBeNull();
    expect(hint?.textContent).toBe('May increase response time and cost.');
  });
});
