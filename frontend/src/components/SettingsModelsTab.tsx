// [F44 / X27] Settings → Models tab.
//
// Composition (top → bottom):
//   1. Model trigger — a single button showing the currently-selected model
//      (Venice mark · name · ctx chip · chevron). Clicking fires
//      `onOpenModelPicker`, which the parent (SettingsModal → EditorPage)
//      wires into the same <ModelPicker /> the chat-panel model bar opens.
//   2. Generation parameters — three sliders (temperature, topP, maxTokens)
//      bound to `settings.chat`. Each tick PATCHes; the optimistic update
//      keeps the slider responsive.
//
// [X27] The previous inline <ModelCard> radiogroup was retired so this tab
// stays compact as the Venice model list grows. Selection now happens inside
// the picker modal.
import type { ChangeEvent, JSX } from 'react';
import { useId } from 'react';
import { formatCtxLabel } from '@/components/ChatPanel';
import { type Model, useModelsQuery } from '@/hooks/useModels';
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

function VeniceMark(): JSX.Element {
  return (
    <svg
      data-testid="settings-model-trigger-mark"
      width="14"
      height="14"
      viewBox="0 0 18 18"
      aria-hidden="true"
    >
      <rect x="0" y="0" width="18" height="18" fill="currentColor" />
      <text
        x="9"
        y="14"
        textAnchor="middle"
        fontFamily="var(--serif), Georgia, serif"
        fontSize="13"
        fill="var(--bg)"
      >
        V
      </text>
    </svg>
  );
}

function ChevronDownIcon(): JSX.Element {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className="text-ink-4"
    >
      <polyline points="6 9 12 15 18 9" />
    </svg>
  );
}

export interface SettingsModelsTabProps {
  onOpenModelPicker: () => void;
}

export function SettingsModelsTab({ onOpenModelPicker }: SettingsModelsTabProps): JSX.Element {
  const tempId = useId();
  const topPId = useId();
  const maxTokensId = useId();

  const settings = useUserSettings();
  const updateSetting = useUpdateUserSetting();
  const modelsQuery = useModelsQuery();

  // --- Model trigger ----------------------------------------------------

  const modelId = settings.chat.model;
  const selectedModel: Model | undefined = modelsQuery.data?.find((m) => m.id === modelId);
  const triggerLabel = selectedModel?.name ?? selectedModel?.id ?? 'Pick a model';
  const ctxLabel = selectedModel ? formatCtxLabel(selectedModel.contextLength) : '';

  // --- Generation parameters -------------------------------------------

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

  // --- Render -----------------------------------------------------------

  return (
    <div className="flex flex-col gap-6">
      <section className="flex flex-col gap-3" data-testid="models-section-list">
        <header>
          <h3 className="m-0 font-serif text-[14px] font-medium text-ink">Model</h3>
          <p className="mt-[2px] text-[12px] text-ink-4 font-sans">
            Pick the default model used for chat and continuations.
          </p>
        </header>

        <button
          type="button"
          data-testid="settings-model-trigger"
          onClick={onOpenModelPicker}
          aria-label="Open model picker"
          className="flex items-center gap-1.5 hover:bg-[var(--surface-hover)] px-2 py-1 rounded-[var(--radius)] bg-[var(--bg-sunken)] border border-line"
        >
          <VeniceMark />
          <span className="font-mono text-[12px] text-ink truncate flex-1 min-w-0 text-left">
            {triggerLabel}
          </span>
          {selectedModel && ctxLabel.length > 0 && ctxLabel !== '—' ? (
            <span
              data-testid="settings-model-trigger-ctx"
              className="text-[10px] uppercase font-mono px-1.5 py-0.5 rounded bg-bg border border-line text-ink-3"
            >
              {ctxLabel}
            </span>
          ) : null}
          <ChevronDownIcon />
        </button>
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
          max={8000}
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
