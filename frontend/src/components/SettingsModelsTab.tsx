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
// fields. Reset button clears the active model's overrides back to defaults.
import type { ChangeEvent, JSX } from 'react';
import { useEffect, useId, useMemo, useState } from 'react';
import { ModelPickerInline } from '@/components/ModelPickerInline';
import { Checkbox, CloseIcon, IconButton, Input } from '@/design/primitives';
import { type Model, useModelsQuery } from '@/hooks/useModels';
import { resolveChatParams, useUpdateUserSetting, useUserSettings } from '@/hooks/useUserSettings';
import { GLOBAL_TEXT_GEN_DEFAULTS, MAX_OUTPUT_TOKENS_CEILING } from '@/lib/textGenDefaults';

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
  disabled?: boolean;
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
  disabled,
  onChange,
}: SliderRowProps): JSX.Element {
  return (
    <div className="flex flex-col gap-1" data-testid={`${testId}-row`}>
      <label
        htmlFor={id}
        className={`flex items-baseline justify-between text-[12px] ${disabled ? 'opacity-50' : ''}`}
      >
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
          disabled={disabled}
          onChange={(e: ChangeEvent<HTMLInputElement>) => {
            const parsed = Number.parseFloat(e.target.value);
            if (!Number.isNaN(parsed)) onChange(parsed);
          }}
          className="flex-1 disabled:opacity-50"
        />
        <span
          data-testid={`${testId}-value`}
          className={`font-mono text-[12px] text-ink-3 tabular-nums w-[64px] text-right ${disabled ? 'opacity-50' : ''}`}
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
  const reasoningId = useId();

  const settings = useUserSettings();
  const updateSetting = useUpdateUserSetting();
  const modelsQuery = useModelsQuery();

  const models = modelsQuery.data ?? [];

  const [highlightedId, setHighlightedId] = useState<string | null>(null);

  const [query, setQuery] = useState('');
  const q = query.trim().toLowerCase();
  const filtered = useMemo(
    () =>
      q === ''
        ? models
        : models.filter(
            (m) =>
              m.name.toLowerCase().includes(q) ||
              m.id.toLowerCase().includes(q) ||
              (m.description?.toLowerCase().includes(q) ?? false),
          ),
    [models, q],
  );

  useEffect(() => {
    if (filtered.length === 0) return; // keep prev; highlightedModel resolves to undefined
    setHighlightedId((prev) => {
      if (prev != null && filtered.some((m) => m.id === prev)) return prev; // keep if visible
      if (q === '') {
        const saved = settings.chat.model;
        if (saved != null && filtered.some((m) => m.id === saved)) return saved;
      }
      return filtered[0].id; // query active (or default absent) → first match
    });
  }, [settings.chat.model, filtered, q]);

  const highlightedModel: Model | undefined =
    filtered.find((m) => m.id === highlightedId) ?? filtered[0];

  const slidersDisabled = highlightedModel == null;

  // Resolve the effective params for the highlighted model. When no model is
  // selected (or models haven't loaded yet), fall back to global defaults.
  const resolvedParams = highlightedModel
    ? resolveChatParams(settings, highlightedModel)
    : {
        temperature: GLOBAL_TEXT_GEN_DEFAULTS.temperature,
        topP: GLOBAL_TEXT_GEN_DEFAULTS.topP,
        maxTokens: GLOBAL_TEXT_GEN_DEFAULTS.maxTokens,
        source: {
          temperature: 'global-default' as const,
          topP: 'global-default' as const,
          maxTokens: 'global-default' as const,
        },
        overridden: { temperature: false, topP: false, maxTokens: false },
      };

  const hasAnyOverride =
    resolvedParams.overridden.temperature ||
    resolvedParams.overridden.topP ||
    resolvedParams.overridden.maxTokens;

  const onReset = (): void => {
    if (!highlightedId) return;
    updateSetting.mutate({
      chat: {
        overrides: { ...settings.chat.overrides, [highlightedId]: {} },
      },
    });
  };

  const resetTooltip = useMemo((): string | undefined => {
    if (!highlightedModel) return undefined;
    const venice =
      highlightedModel.defaultTemperature !== null || highlightedModel.defaultTopP !== null;
    if (venice) {
      const parts: string[] = [];
      if (highlightedModel.defaultTemperature !== null)
        parts.push(`temp ${highlightedModel.defaultTemperature}`);
      if (highlightedModel.defaultTopP !== null) parts.push(`topP ${highlightedModel.defaultTopP}`);
      return `Reverts to ${highlightedModel.name} defaults from Venice (${parts.join(', ')})`;
    }
    return 'Reverts to general defaults';
  }, [highlightedModel]);

  const onTemperature = (v: number): void => {
    if (!highlightedId) return;
    const prev = settings.chat.overrides[highlightedId] ?? {};
    updateSetting.mutate({
      chat: {
        overrides: { ...settings.chat.overrides, [highlightedId]: { ...prev, temperature: v } },
      },
    });
  };
  const onTopP = (v: number): void => {
    if (!highlightedId) return;
    const prev = settings.chat.overrides[highlightedId] ?? {};
    updateSetting.mutate({
      chat: { overrides: { ...settings.chat.overrides, [highlightedId]: { ...prev, topP: v } } },
    });
  };
  const onMaxTokens = (v: number): void => {
    if (!highlightedId) return;
    const prev = settings.chat.overrides[highlightedId] ?? {};
    updateSetting.mutate({
      chat: {
        overrides: {
          ...settings.chat.overrides,
          [highlightedId]: { ...prev, maxTokens: Math.round(v) },
        },
      },
    });
  };

  const reasoningSupported = highlightedModel?.supportsReasoning === true;
  const reasoningOn =
    reasoningSupported && (settings.chat.overrides[highlightedId ?? '']?.reasoning ?? true);
  const onReasoning = (next: boolean): void => {
    if (!highlightedId) return;
    const prev = settings.chat.overrides[highlightedId] ?? {};
    updateSetting.mutate({
      chat: {
        overrides: { ...settings.chat.overrides, [highlightedId]: { ...prev, reasoning: next } },
      },
    });
  };

  return (
    <div className="flex flex-col gap-6">
      <section className="flex flex-col gap-3" data-testid="models-section-list">
        <div className="relative">
          <Input
            data-testid="models-search"
            type="text"
            font="sans"
            placeholder="Search models…"
            aria-label="Search models"
            className="pr-8"
            value={query}
            onChange={(e: ChangeEvent<HTMLInputElement>) => {
              setQuery(e.target.value);
            }}
          />
          {query !== '' ? (
            <IconButton
              testId="models-search-clear"
              ariaLabel="Clear search"
              size="md"
              className="absolute right-1 top-1/2 -translate-y-1/2"
              onClick={() => {
                setQuery('');
              }}
            >
              <CloseIcon />
            </IconButton>
          ) : null}
        </div>

        <p className="text-[12px] text-ink-4 font-sans">
          Pick the default model used for chat and continuations.
        </p>

        <ModelPickerInline
          models={filtered}
          activeId={settings.chat.model}
          highlightedId={highlightedId}
          onHighlightChange={setHighlightedId}
          loading={modelsQuery.isLoading}
          error={modelsQuery.isError}
          emptyMessage={query.trim() ? `No models match “${query.trim()}”` : undefined}
          onUseModel={(id) => {
            updateSetting.mutate({ chat: { model: id } });
          }}
        />
      </section>

      <section className="flex flex-col gap-3" data-testid="models-section-params">
        <header className="flex items-center justify-between">
          <div>
            <h3 className="m-0 font-serif text-[14px] font-medium text-ink">
              Generation parameters
            </h3>
            <p className="mt-[2px] text-[12px] text-ink-4 font-sans">
              {slidersDisabled
                ? 'Pick a model above to tune its parameters.'
                : 'Live tuning for the chat composer and continue-writing.'}
            </p>
          </div>
          <button
            type="button"
            onClick={onReset}
            disabled={slidersDisabled || !hasAnyOverride}
            title={resetTooltip}
            className="text-[12px] font-sans text-ink-3 disabled:opacity-50 hover:text-ink"
            data-testid="param-reset"
          >
            Reset to defaults
          </button>
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
          disabled={slidersDisabled}
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
          disabled={slidersDisabled}
          onChange={onTopP}
        />
        <SliderRow
          id={maxTokensId}
          label="Max tokens"
          hint="Response length cap"
          min={1}
          max={
            highlightedModel
              ? Math.min(highlightedModel.maxCompletionTokens, MAX_OUTPUT_TOKENS_CEILING)
              : MAX_OUTPUT_TOKENS_CEILING
          }
          step={64}
          value={resolvedParams.maxTokens}
          decimals={0}
          testId="param-max-tokens"
          disabled={slidersDisabled}
          onChange={onMaxTokens}
        />
        <label
          htmlFor={reasoningId}
          className={`flex items-center gap-2 text-[12px] ${!reasoningSupported ? 'opacity-50' : ''}`}
        >
          <Checkbox
            id={reasoningId}
            data-testid="param-reasoning"
            checked={reasoningOn}
            disabled={slidersDisabled || !reasoningSupported}
            onChange={(e) => onReasoning(e.target.checked)}
          />
          <span className="font-medium text-ink-2">Reasoning</span>
          {!reasoningSupported ? (
            <span className="text-ink-4 font-sans">Not supported by this model</span>
          ) : null}
        </label>
      </section>
    </div>
  );
}
