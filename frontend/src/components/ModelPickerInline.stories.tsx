import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import type { Model } from '@/hooks/useModels';
import { ModelPickerInline } from './ModelPickerInline';

const SAMPLE_MODELS: Model[] = [
  {
    id: 'zai-org-glm-5-1',
    name: 'GLM 5.1',
    contextLength: 200_000,
    maxCompletionTokens: 8_192,
    supportsReasoning: true,
    supportsVision: false,
    supportsWebSearch: true,
    description:
      'Next-generation large language model from Zhiyuan AI, featuring significantly enhanced reasoning capabilities, an expanded context window, and stronger performance across creative writing, code, and analysis tasks.',
    pricing: { inputUsdPerMTok: 1.75, outputUsdPerMTok: 5.5 },
    defaultTemperature: null,
    defaultTopP: null,
  },
  {
    id: 'llama-3.3-70b',
    name: 'Llama 3.3 70B',
    contextLength: 128_000,
    maxCompletionTokens: 16_384,
    supportsReasoning: false,
    supportsVision: false,
    supportsWebSearch: true,
    description:
      'Meta-tuned 70B general-purpose model. Strong instruction-following and creative-writing performance; reliable default for long-form prose.',
    pricing: { inputUsdPerMTok: 0.6, outputUsdPerMTok: 2.4 },
    defaultTemperature: null,
    defaultTopP: null,
  },
  {
    id: 'qwen-3-6-plus',
    name: 'Qwen 3.6 Plus',
    contextLength: 1_000_000,
    maxCompletionTokens: 65_536,
    supportsReasoning: true,
    supportsVision: false,
    supportsWebSearch: true,
    description:
      "Alibaba's latest flagship reasoning model with exceptional performance across coding, reasoning, and general writing.",
    pricing: { inputUsdPerMTok: 0.63, outputUsdPerMTok: 3.75 },
    defaultTemperature: 0.7,
    defaultTopP: 0.8,
  },
  {
    id: 'bare-text-mini',
    name: 'Bare Text Mini',
    contextLength: 16_000,
    maxCompletionTokens: 4_096,
    supportsReasoning: false,
    supportsVision: false,
    supportsWebSearch: false,
    description: null,
    pricing: null,
    defaultTemperature: null,
    defaultTopP: null,
  },
];

interface DemoArgs {
  activeId: string | null;
  loading?: boolean;
  error?: boolean;
  models?: Model[];
}

function Demo({ activeId, loading, error, models = SAMPLE_MODELS }: DemoArgs): React.ReactElement {
  const [active, setActive] = useState(activeId);
  const [highlighted, setHighlighted] = useState<string | null>(activeId);
  return (
    <div className="p-6" style={{ minWidth: 720 }}>
      <ModelPickerInline
        models={models}
        activeId={active}
        highlightedId={highlighted}
        onHighlightChange={setHighlighted}
        loading={loading}
        error={error}
        onUseModel={(id) => {
          setActive(id);
          setHighlighted(id);
        }}
      />
    </div>
  );
}

const meta = {
  title: 'Components/ModelPickerInline',
  component: Demo,
  parameters: { layout: 'fullscreen' },
} satisfies Meta<typeof Demo>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = { args: { activeId: 'llama-3.3-70b' } };
export const ActiveTopOfList: Story = { args: { activeId: 'zai-org-glm-5-1' } };
export const BareModelActive: Story = { args: { activeId: 'bare-text-mini' } };
export const NoActiveModel: Story = { args: { activeId: null } };
export const Loading: Story = { args: { activeId: null, loading: true, models: [] } };
export const ErrorState: Story = { args: { activeId: null, error: true, models: [] } };
export const Empty: Story = { args: { activeId: null, models: [] } };
