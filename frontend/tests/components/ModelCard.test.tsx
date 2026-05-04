// [X27] ModelCard rendering — covers price pill, description row, and the
// reasoning / web-search capability labels. Vision is intentionally not
// rendered because the app has no vision-capable surface.
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ModelCard } from '@/components/ModelCard';
import type { Model } from '@/hooks/useModels';

function baseModel(overrides: Partial<Model> = {}): Model {
  return {
    id: 'llama-3.3-70b',
    name: 'Llama 3.3 70B',
    contextLength: 65_536,
    supportsReasoning: false,
    supportsVision: false,
    supportsWebSearch: false,
    description: null,
    pricing: null,
    ...overrides,
  };
}

describe('ModelCard (X27)', () => {
  it('renders name + ctx and omits row 2 when description / capabilities / pricing are absent', () => {
    render(<ModelCard model={baseModel()} selected={false} onSelect={() => {}} />);
    expect(screen.getByTestId('model-card-llama-3.3-70b')).toBeInTheDocument();
    expect(screen.getByTestId('model-card-llama-3.3-70b-ctx')).toHaveTextContent(/66k|65k/);
    expect(screen.queryByTestId('model-card-llama-3.3-70b-price')).toBeNull();
    expect(screen.queryByTestId('model-card-llama-3.3-70b-desc')).toBeNull();
  });

  it('renders the price pill with "$0.15 in · $0.60 out" when pricing is present', () => {
    const model = baseModel({
      pricing: { inputUsdPerMTok: 0.15, outputUsdPerMTok: 0.6 },
    });
    render(<ModelCard model={model} selected={false} onSelect={() => {}} />);
    const pill = screen.getByTestId('model-card-llama-3.3-70b-price');
    expect(pill).toHaveTextContent('$0.15 in · $0.60 out');
    expect(pill).toHaveAttribute(
      'title',
      '$0.15 USD per 1M input tokens · $0.60 USD per 1M output tokens',
    );
  });

  it('does not render the price pill when pricing is null', () => {
    render(<ModelCard model={baseModel({ pricing: null })} selected={false} onSelect={() => {}} />);
    expect(screen.queryByTestId('model-card-llama-3.3-70b-price')).toBeNull();
  });

  it('renders the description on row 2 when present', () => {
    const model = baseModel({ description: 'A general-purpose 70B model.' });
    render(<ModelCard model={model} selected={false} onSelect={() => {}} />);
    const desc = screen.getByTestId('model-card-llama-3.3-70b-desc');
    expect(desc).toHaveTextContent('A general-purpose 70B model.');
  });

  it('renders the "Reasoning" capability label when supportsReasoning is true', () => {
    const model = baseModel({
      supportsReasoning: true,
      description: 'Tuned for chains-of-thought.',
    });
    render(<ModelCard model={model} selected={false} onSelect={() => {}} />);
    expect(screen.getByTestId('model-card-llama-3.3-70b-desc')).toHaveTextContent(
      /Reasoning · Tuned for chains-of-thought\./,
    );
  });

  it('renders the "Web search" capability label when supportsWebSearch is true', () => {
    const model = baseModel({ supportsWebSearch: true, description: 'Hits the live web.' });
    render(<ModelCard model={model} selected={false} onSelect={() => {}} />);
    expect(screen.getByTestId('model-card-llama-3.3-70b-desc')).toHaveTextContent(
      /Web search · Hits the live web\./,
    );
  });

  it('joins both capability labels and the description with " · "', () => {
    const model = baseModel({
      supportsReasoning: true,
      supportsWebSearch: true,
      description: 'Both capabilities.',
    });
    render(<ModelCard model={model} selected={false} onSelect={() => {}} />);
    expect(screen.getByTestId('model-card-llama-3.3-70b-desc')).toHaveTextContent(
      'Reasoning · Web search · Both capabilities.',
    );
  });

  it('does not render any vision label even when supportsVision is true', () => {
    const model = baseModel({ supportsVision: true, description: 'Multimodal.' });
    render(<ModelCard model={model} selected={false} onSelect={() => {}} />);
    const card = screen.getByTestId('model-card-llama-3.3-70b');
    expect(card.textContent ?? '').not.toMatch(/vision/i);
  });

  it('omits row 2 when only supportsVision is true (no consumer in app)', () => {
    const model = baseModel({ supportsVision: true });
    render(<ModelCard model={model} selected={false} onSelect={() => {}} />);
    expect(screen.queryByTestId('model-card-llama-3.3-70b-desc')).toBeNull();
  });

  it('fires onSelect with the model id and reflects selection on aria-checked', async () => {
    const onSelect = vi.fn();
    const { rerender } = render(
      <ModelCard model={baseModel()} selected={false} onSelect={onSelect} />,
    );
    const card = screen.getByTestId('model-card-llama-3.3-70b');
    expect(card).toHaveAttribute('aria-checked', 'false');

    await userEvent.setup().click(card);
    expect(onSelect).toHaveBeenCalledWith('llama-3.3-70b');

    rerender(<ModelCard model={baseModel()} selected onSelect={onSelect} />);
    expect(screen.getByTestId('model-card-llama-3.3-70b')).toHaveAttribute('aria-checked', 'true');
  });
});
