import type { Meta, StoryObj } from '@storybook/react-vite';
import type { Model } from '@/hooks/useModels';
import { ModelCard } from './ModelCard';

const baseModel: Model = {
  id: 'llama-3.3-70b',
  name: 'Llama 3.3 70B',
  contextLength: 65_536,
  supportsReasoning: false,
  supportsVision: false,
  supportsWebSearch: false,
  description: null,
  pricing: null,
};

interface DemoProps {
  model: Model;
  selected?: boolean;
}

function Demo({ model, selected = false }: DemoProps) {
  return (
    <div role="radiogroup" aria-label="Model" className="w-[360px]">
      <ModelCard model={model} selected={selected} onSelect={() => {}} />
    </div>
  );
}

const meta = {
  title: 'Components/ModelCard',
  component: Demo,
} satisfies Meta<typeof Demo>;

export default meta;
type Story = StoryObj<typeof meta>;

export const FullyPopulated: Story = {
  args: {
    model: {
      ...baseModel,
      description: 'A general-purpose 70B model tuned for instruction-following.',
      pricing: { inputUsdPerMTok: 0.6, outputUsdPerMTok: 2.4 },
      supportsReasoning: true,
      supportsWebSearch: true,
    },
    selected: true,
  },
};

export const PriceOnly: Story = {
  args: {
    model: {
      ...baseModel,
      pricing: { inputUsdPerMTok: 0.15, outputUsdPerMTok: 0.6 },
    },
  },
};

export const DescriptionOnly: Story = {
  args: {
    model: {
      ...baseModel,
      description: 'A small-but-mighty model for quick interactive completions.',
    },
  },
};

export const Bare: Story = {
  args: { model: baseModel },
};
