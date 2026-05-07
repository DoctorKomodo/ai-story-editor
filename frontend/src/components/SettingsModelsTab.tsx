// [X33] Settings → Models tab.
//
// Composition (top → bottom):
//   1. Inline master/detail model picker (<ModelPickerInline>) — selects the
//      default model used for chat and continuations. The "Use this model"
//      CTA in the detail pane PATCHes /users/me/settings { chat: { model } }.
//   2. Generation parameters — three sliders (temperature, topP, maxTokens)
//      showing the resolved value for the active model. Each tick PATCHes a
//      per-model override into settings.chat.overrides[modelId].
//
// [X33] Replaces the X27 trigger-button + modal flow with an inline picker
// living inside the tab.
// [X28] Sliders now show resolved values (override → venice-default →
// global-default) and write per-model overrides instead of flat top-level
// fields.
import type { ChangeEvent, JSX } from 'react';
import { useId } from 'react';
import { ModelPickerInline } from '@/components/ModelPickerInline';
import { type Model, useModelsQuery } from '@/hooks/useModels';
import { resolveChatParams, useUpdateUserSetting, useUserSettings } from '@/hooks/useUserSettings';
import { GLOBAL_TEXT_GEN_DEFAULTS } from '@/lib/textGenDefaults';

interface SliderRowProps {
  id: string;
  label: string;
  hint?: string;
  min: number;
  max: number;
  step: number;
  value: number;
  decimals: number;
  testId: string;
  onChange: (next: number) => void;
}

function SliderRow({
  id,
  label,
  hint,
  min,
  max,
  step,
  value,
  decimals,
  testId,
  onChange,
}: SliderRowProps): JSX.Element {
  return (
    <div className="flex flex-col gap-1" data-testid={`${testId}-row`}>
      <label htmlFor={id} className="flex items-baseline justify-between text-[12px]">
        <span className="font-medium text-ink-2">{label}</span>
        {hint != null ? <span className="text-ink-4 font-sans">{hint}</span> : null}
      </label>
      <div className="flex items-center gap-3">
        <input
          id={id}
          data-testid={testId}
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(e: ChangeEvent<HTMLInputElement>) => {
            const parsed = Number.parseFloat(e.target.value);
            if (!Number.isNaN(parsed)) onChange(parsed);
          }}
          className="flex-1"
        />
        <span
          data-testid={`${testId}-value`}
          className="font-mono text-[12px] text-ink-3 tabular-nums w-[64px] text-right"
        >
          {value.toFixed(decimals)}
        </span>
      </div>
    </div>
  );
}

export function SettingsModelsTab(): JSX.Element {
  const tempId = useId();
  const topPId = useId();
  const maxTokensId = useId();

  const settings = useUserSettings();
  const updateSetting = useUpdateUserSetting();
  const modelsQuery = useModelsQuery();

  const activeModelId = settings.chat.model;
  const activeModel: Model | undefined = modelsQuery.data?.find((m) => m.id === activeModelId);

  // Resolve the effective params for the active model. When no model is
  // selected (or models haven't loaded yet), fall back to global defaults.
  const resolvedParams = activeModel
    ? resolveChatParams(settings, activeModel)
    : {
        temperature: GLOBAL_TEXT_GEN_DEFAULTS.temperature,
        topP: GLOBAL_TEXT_GEN_DEFAULTS.topP,
        maxTokens: GLOBAL_TEXT_GEN_DEFAULTS.maxTokens,
      };

  const onTemperature = (v: number): void => {
    if (!activeModelId) return;
    const prev = settings.chat.overrides[activeModelId] ?? {};
    updateSetting.mutate({
      chat: {
        overrides: { ...settings.chat.overrides, [activeModelId]: { ...prev, temperature: v } },
      },
    });
  };
  const onTopP = (v: number): void => {
    if (!activeModelId) return;
    const prev = settings.chat.overrides[activeModelId] ?? {};
    updateSetting.mutate({
      chat: { overrides: { ...settings.chat.overrides, [activeModelId]: { ...prev, topP: v } } },
    });
  };
  const onMaxTokens = (v: number): void => {
    if (!activeModelId) return;
    const prev = settings.chat.overrides[activeModelId] ?? {};
    updateSetting.mutate({
      chat: {
        overrides: {
          ...settings.chat.overrides,
          [activeModelId]: { ...prev, maxTokens: Math.round(v) },
        },
      },
    });
  };

  return (
    <div className="flex flex-col gap-6">
      <section className="flex flex-col gap-3" data-testid="models-section-list">
        <p className="text-[12px] text-ink-4 font-sans">
          Pick the default model used for chat and continuations.
        </p>

        <ModelPickerInline
          models={modelsQuery.data ?? []}
          activeId={settings.chat.model}
          loading={modelsQuery.isLoading}
          error={modelsQuery.isError}
          onUseModel={(id) => {
            updateSetting.mutate({ chat: { model: id } });
          }}
        />
      </section>

      <section className="flex flex-col gap-3" data-testid="models-section-params">
        <header>
          <h3 className="m-0 font-serif text-[14px] font-medium text-ink">Generation parameters</h3>
          <p className="mt-[2px] text-[12px] text-ink-4 font-sans">
            Live tuning for the chat composer and continue-writing.
          </p>
        </header>

        <SliderRow
          id={tempId}
          label="Temperature"
          hint="Creativity vs. focus"
          min={0}
          max={2}
          step={0.05}
          value={resolvedParams.temperature}
          decimals={2}
          testId="param-temperature"
          onChange={onTemperature}
        />
        <SliderRow
          id={topPId}
          label="Top P"
          hint="Nucleus sampling"
          min={0}
          max={1}
          step={0.05}
          value={resolvedParams.topP}
          decimals={2}
          testId="param-top-p"
          onChange={onTopP}
        />
        <SliderRow
          id={maxTokensId}
          label="Max tokens"
          hint="Response length cap"
          min={1}
          max={32_000}
          step={64}
          value={resolvedParams.maxTokens}
          decimals={0}
          testId="param-max-tokens"
          onChange={onMaxTokens}
        />
      </section>
    </div>
  );
}
