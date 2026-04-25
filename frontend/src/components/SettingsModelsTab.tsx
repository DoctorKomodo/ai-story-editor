// [F44] Settings → Models tab.
//
// Composition (top → bottom):
//   1. Model list — `<ModelCard>` (from [F42]) inside a `radiogroup`.
//      Click sets `useModelStore` AND PATCHes `/api/users/me/settings`
//      `{ chat: { model } }` so the choice survives across sessions ([B11]).
//   2. Generation parameters — four sliders bound to `useParamsStore`
//      ([F22]). Three of them (temperature, topP, maxTokens) also persist
//      to user settings; `frequencyPenalty` stays local because the backend
//      settings shape ([B11]) doesn't carry it yet.
//   3. System prompt — per-story textarea, only rendered when an
//      `activeStoryId` is set. Reads via `useStoryQuery`, writes via
//      `useUpdateStoryMutation` on blur (the existing PATCH that [V13] +
//      [B2] already accept `systemPrompt` on).
//
// Slider PATCHes are debounced (200ms) so a drag doesn't fire dozens of
// requests; the textarea writes on blur (no debounce needed). Both store
// updates are immediate so the UI stays responsive while the network
// catches up.
import type { ChangeEvent, JSX } from 'react';
import { useEffect, useId, useRef, useState } from 'react';
import { ModelCard } from '@/components/ModelCard';
import { useModelsQuery } from '@/hooks/useModels';
import { useStoryQuery, useUpdateStoryMutation } from '@/hooks/useStories';
import { useUpdateUserSettingsMutation, useUserSettingsQuery } from '@/hooks/useUserSettings';
import { useActiveStoryStore } from '@/store/activeStory';
import { useModelStore } from '@/store/model';
import { useParamsStore } from '@/store/params';

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

// Tiny ref-based debouncer. Keeping it inline (rather than a shared hook)
// because the only consumer in the tree is this tab and the contract is
// trivial. Cancels in-flight timers on unmount so a closing modal doesn't
// fire a stray PATCH.
function useDebouncedCallback<A extends unknown[]>(
  fn: (...args: A) => void,
  delayMs: number,
): (...args: A) => void {
  const fnRef = useRef(fn);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    fnRef.current = fn;
  }, [fn]);

  useEffect(() => {
    return () => {
      if (timerRef.current != null) clearTimeout(timerRef.current);
    };
  }, []);

  return (...args: A): void => {
    if (timerRef.current != null) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      fnRef.current(...args);
    }, delayMs);
  };
}

export function SettingsModelsTab(): JSX.Element {
  const tempId = useId();
  const topPId = useId();
  const maxTokensId = useId();
  const freqId = useId();
  const promptId = useId();

  // --- Model list -------------------------------------------------------

  const modelId = useModelStore((s) => s.modelId);
  const setModelId = useModelStore((s) => s.setModelId);

  const modelsQuery = useModelsQuery();
  const settingsQuery = useUserSettingsQuery();
  const updateSettings = useUpdateUserSettingsMutation();

  const handleSelectModel = (id: string): void => {
    setModelId(id);
    updateSettings.mutate({ chat: { model: id } });
  };

  // --- Generation parameters -------------------------------------------

  const params = useParamsStore((s) => s.params);
  const setParams = useParamsStore((s) => s.setParams);

  // Debounced PATCH for the three server-backed slider params. Refs (not
  // closures over `params`) are read inside the timer so a fast drag
  // sends the *latest* values, not whatever was current when the first
  // change fired.
  const paramsRef = useRef(params);
  useEffect(() => {
    paramsRef.current = params;
  }, [params]);

  const flushParams = useDebouncedCallback((): void => {
    const p = paramsRef.current;
    updateSettings.mutate({
      chat: {
        temperature: p.temperature,
        topP: p.topP,
        maxTokens: p.maxTokens,
      },
    });
  }, 200);

  const onTemperature = (v: number): void => {
    setParams({ temperature: v });
    flushParams();
  };
  const onTopP = (v: number): void => {
    setParams({ topP: v });
    flushParams();
  };
  const onMaxTokens = (v: number): void => {
    setParams({ maxTokens: Math.round(v) });
    flushParams();
  };
  // TODO: backend `chat` settings ([B11]) doesn't yet carry frequencyPenalty.
  // Keep it client-only until the schema lands; no PATCH on change.
  const onFrequencyPenalty = (v: number): void => {
    setParams({ frequencyPenalty: v });
  };

  // --- System prompt (per-story) ---------------------------------------

  const activeStoryId = useActiveStoryStore((s) => s.activeStoryId);
  const storyQuery = useStoryQuery(activeStoryId ?? undefined);
  const updateStory = useUpdateStoryMutation();

  const [promptDraft, setPromptDraft] = useState('');
  // Re-seed the textarea whenever the active story (or its server-side
  // systemPrompt) changes. Without this, switching stories would leave a
  // stale draft on screen.
  const lastSeededRef = useRef<{ id: string | null; value: string | null }>({
    id: null,
    value: null,
  });
  useEffect(() => {
    const id = activeStoryId;
    const fresh = storyQuery.data?.systemPrompt ?? null;
    if (lastSeededRef.current.id !== id || lastSeededRef.current.value !== fresh) {
      lastSeededRef.current = { id, value: fresh };
      setPromptDraft(fresh ?? '');
    }
  }, [activeStoryId, storyQuery.data?.systemPrompt]);

  const handlePromptBlur = (): void => {
    if (activeStoryId == null) return;
    const trimmed = promptDraft.trim();
    const next = trimmed.length === 0 ? null : promptDraft;
    const current = storyQuery.data?.systemPrompt ?? null;
    if (next === current) return;
    updateStory.mutate({ id: activeStoryId, input: { systemPrompt: next } });
  };

  // --- Render -----------------------------------------------------------

  const models = modelsQuery.data;
  const settingsLoading = !settingsQuery.data;

  return (
    <div className="flex flex-col gap-6">
      <section className="flex flex-col gap-3" data-testid="models-section-list">
        <header>
          <h3 className="m-0 font-serif text-[14px] font-medium text-ink">Model</h3>
          <p className="mt-[2px] text-[12px] text-ink-4 font-sans">
            Pick the default model used for chat and continuations.
          </p>
        </header>

        <div
          role="radiogroup"
          aria-label="Select model"
          data-testid="models-radiogroup"
          className="grid gap-2"
        >
          {modelsQuery.isLoading ? (
            <div className="py-6 text-center font-mono text-[12px] text-ink-4">Loading models…</div>
          ) : modelsQuery.isError ? (
            <div
              role="alert"
              className="py-6 text-center font-mono text-[12px] text-[color:var(--danger)]"
            >
              {modelsQuery.error instanceof Error
                ? modelsQuery.error.message
                : 'Failed to load models.'}
            </div>
          ) : !models || models.length === 0 ? (
            <div className="py-6 text-center font-mono text-[12px] text-ink-4">
              No models available
            </div>
          ) : (
            models.map((m) => (
              <ModelCard
                key={m.id}
                model={m}
                selected={m.id === modelId}
                onSelect={handleSelectModel}
              />
            ))
          )}
        </div>
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
        <SliderRow
          id={freqId}
          label="Frequency penalty"
          hint="Reduce repetition"
          min={0}
          max={2}
          step={0.05}
          value={params.frequencyPenalty}
          decimals={2}
          testId="param-frequency-penalty"
          onChange={onFrequencyPenalty}
        />

        {settingsLoading ? (
          <span className="font-mono text-[11px] text-ink-4" data-testid="params-loading">
            Loading saved values…
          </span>
        ) : null}
      </section>

      <section className="flex flex-col gap-3" data-testid="models-section-system-prompt">
        <header>
          <h3 className="m-0 font-serif text-[14px] font-medium text-ink">System prompt</h3>
          <p className="mt-[2px] text-[12px] text-ink-4 font-sans">
            Per-story override for the default creative-writing prompt.
          </p>
        </header>

        {activeStoryId == null ? (
          <div
            data-testid="system-prompt-empty"
            className="py-4 px-3 border border-line rounded-[var(--radius)] bg-bg text-[12px] font-sans text-ink-4"
          >
            Pick a story to set a custom system prompt.
          </div>
        ) : (
          <div className="flex flex-col gap-1">
            <label htmlFor={promptId} className="sr-only">
              System prompt
            </label>
            <textarea
              id={promptId}
              data-testid="system-prompt-textarea"
              value={promptDraft}
              placeholder="Default creative writing prompt…"
              spellCheck={false}
              onChange={(e) => {
                setPromptDraft(e.target.value);
              }}
              onBlur={handlePromptBlur}
              className="font-serif w-full min-h-[120px] p-3 border border-line rounded-[var(--radius)] bg-bg focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
            />
          </div>
        )}
      </section>
    </div>
  );
}
