// [X33] Settings → Models tab.
//
// Composition (top → bottom):
//   1. Inline master/detail model picker (<ModelPickerInline>) — selects the
//      default model used for chat and continuations. The "Use this model"
//      CTA in the detail pane PATCHes /users/me/settings { chat: { model } }.
//   2. Generation parameters — three sliders (temperature, topP, maxTokens)
//      bound to settings.chat. Each tick PATCHes; the optimistic update
//      keeps the slider responsive.
//
// [X33] Replaces the X27 trigger-button + modal flow with an inline picker
// living inside the tab.
import type { ChangeEvent, JSX } from 'react';
import { useId } from 'react';
import { ModelPickerInline } from '@/components/ModelPickerInline';
import { useModelsQuery } from '@/hooks/useModels';
import { useUpdateUserSetting, useUserSettings } from '@/hooks/useUserSettings';

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

  const params = settings.chat;
  const onTemperature = (v: number): void => {
    updateSetting.mutate({ chat: { temperature: v } });
  };
  const onTopP = (v: number): void => {
    updateSetting.mutate({ chat: { topP: v } });
  };
  const onMaxTokens = (v: number): void => {
    updateSetting.mutate({ chat: { maxTokens: Math.round(v) } });
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
          value={params.temperature}
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
          value={params.topP}
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
          value={params.maxTokens}
          decimals={0}
          testId="param-max-tokens"
          onChange={onMaxTokens}
        />
      </section>
    </div>
  );
}
