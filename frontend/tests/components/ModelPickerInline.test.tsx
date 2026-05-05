// [X33] ModelPickerInline — pure presentational component covering rail
// rendering, preview vs active states, and the "Use this model" CTA flow.
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ModelPickerInline } from '@/components/ModelPickerInline';
import type { Model } from '@/hooks/useModels';

function makeModel(overrides: Partial<Model> = {}): Model {
  return {
    id: 'llama-3.3-70b',
    name: 'Llama 3.3 70B',
    contextLength: 128_000,
    supportsReasoning: false,
    supportsVision: false,
    supportsWebSearch: false,
    description: null,
    pricing: null,
    ...overrides,
  };
}

const TWO_MODELS: Model[] = [
  makeModel({
    id: 'llama-3.3-70b',
    name: 'Llama 3.3 70B',
    description: 'Meta-tuned 70B general-purpose model.',
    pricing: { inputUsdPerMTok: 0.6, outputUsdPerMTok: 2.4 },
    supportsWebSearch: true,
  }),
  makeModel({
    id: 'qwen-3-6-plus',
    name: 'Qwen 3.6 Plus',
    contextLength: 1_000_000,
    description: 'Reasoning-tuned flagship.',
    pricing: { inputUsdPerMTok: 0.63, outputUsdPerMTok: 3.75 },
    supportsReasoning: true,
    supportsWebSearch: true,
  }),
];

describe('ModelPickerInline (X33)', () => {
  it('renders one rail row per model with name, compact pricing, and ctx label', () => {
    render(<ModelPickerInline models={TWO_MODELS} activeId={null} onUseModel={() => {}} />);
    const llama = screen.getByTestId('model-rail-llama-3.3-70b');
    expect(llama).toHaveTextContent('Llama 3.3 70B');
    expect(llama).toHaveTextContent('$0.60');
    expect(llama).toHaveTextContent('$2.40');
    expect(llama).toHaveTextContent(/128k/i);

    const qwen = screen.getByTestId('model-rail-qwen-3-6-plus');
    expect(qwen).toHaveTextContent(/1M/i);
  });

  it('renders "no price" placeholder for bare models', () => {
    const bare = makeModel({ id: 'bare', name: 'Bare', pricing: null });
    render(<ModelPickerInline models={[bare]} activeId={null} onUseModel={() => {}} />);
    expect(screen.getByTestId('model-rail-bare')).toHaveTextContent(/no price/i);
  });

  it('marks the active model with a dot prefix in the rail', () => {
    render(
      <ModelPickerInline models={TWO_MODELS} activeId="llama-3.3-70b" onUseModel={() => {}} />,
    );
    const row = screen.getByTestId('model-rail-llama-3.3-70b');
    expect(row.querySelector('[aria-label="Currently in use"]')).not.toBeNull();
    const other = screen.getByTestId('model-rail-qwen-3-6-plus');
    expect(other.querySelector('[aria-label="Currently in use"]')).toBeNull();
  });

  it('opens with the active model highlighted in the detail pane', () => {
    render(
      <ModelPickerInline models={TWO_MODELS} activeId="qwen-3-6-plus" onUseModel={() => {}} />,
    );
    expect(screen.getByTestId('model-detail-name')).toHaveTextContent('Qwen 3.6 Plus');
  });

  it('falls back to the first model when activeId is null', () => {
    render(<ModelPickerInline models={TWO_MODELS} activeId={null} onUseModel={() => {}} />);
    expect(screen.getByTestId('model-detail-name')).toHaveTextContent('Llama 3.3 70B');
  });

  it('clicking a rail row updates the detail pane without calling onUseModel', async () => {
    const onUseModel = vi.fn();
    render(
      <ModelPickerInline models={TWO_MODELS} activeId="llama-3.3-70b" onUseModel={onUseModel} />,
    );
    await userEvent.setup().click(screen.getByTestId('model-rail-qwen-3-6-plus'));
    expect(screen.getByTestId('model-detail-name')).toHaveTextContent('Qwen 3.6 Plus');
    expect(onUseModel).not.toHaveBeenCalled();
  });

  it('CTA reads "Use this model" when previewing a non-active model and fires onUseModel on click', async () => {
    const onUseModel = vi.fn();
    render(
      <ModelPickerInline models={TWO_MODELS} activeId="llama-3.3-70b" onUseModel={onUseModel} />,
    );
    const user = userEvent.setup();
    await user.click(screen.getByTestId('model-rail-qwen-3-6-plus'));
    const cta = screen.getByTestId('model-detail-cta');
    expect(cta).toHaveTextContent(/use this model/i);
    expect(cta).not.toBeDisabled();
    await user.click(cta);
    expect(onUseModel).toHaveBeenCalledTimes(1);
    expect(onUseModel).toHaveBeenCalledWith('qwen-3-6-plus');
  });

  it('CTA reads "Currently in use" disabled when previewing the active model', () => {
    render(
      <ModelPickerInline models={TWO_MODELS} activeId="llama-3.3-70b" onUseModel={() => {}} />,
    );
    const cta = screen.getByTestId('model-detail-cta');
    expect(cta).toHaveTextContent(/currently in use/i);
    expect(cta).toBeDisabled();
  });

  it('renders capability chips for reasoning and web search; never renders vision', () => {
    render(
      <ModelPickerInline
        models={[
          makeModel({
            id: 'mm',
            name: 'Multimodal',
            supportsReasoning: true,
            supportsWebSearch: true,
            supportsVision: true,
            description: 'desc',
          }),
        ]}
        activeId="mm"
        onUseModel={() => {}}
      />,
    );
    expect(screen.getByText('Reasoning')).toBeInTheDocument();
    expect(screen.getByText('Web search')).toBeInTheDocument();
    expect(screen.queryByText(/vision/i)).toBeNull();
  });

  it('renders the description as full prose, and an italic empty-state when missing', () => {
    const { rerender } = render(
      <ModelPickerInline
        models={[makeModel({ id: 'with', description: 'Full description here.' })]}
        activeId="with"
        onUseModel={() => {}}
      />,
    );
    expect(screen.getByTestId('model-detail-description')).toHaveTextContent(
      'Full description here.',
    );

    rerender(
      <ModelPickerInline
        models={[makeModel({ id: 'no', description: null })]}
        activeId="no"
        onUseModel={() => {}}
      />,
    );
    expect(screen.getByTestId('model-detail-description')).toHaveTextContent(
      /no description provided by the model host/i,
    );
  });

  it('renders a skeleton rail and no detail pane when loading', () => {
    render(<ModelPickerInline models={[]} activeId={null} loading onUseModel={() => {}} />);
    expect(screen.queryByTestId('model-detail-name')).toBeNull();
    expect(screen.getByTestId('model-rail-skeleton')).toBeInTheDocument();
  });
});
