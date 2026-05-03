// [F44] Settings → Models tab.
//
// Composition (top → bottom):
//   1. Model list — `<ModelCard>` (from [F42]) inside a `radiogroup`.
//      Click PATCHes `/api/users/me/settings` `{ chat: { model } }` via
//      useUpdateUserSetting; the wrapper handles the optimistic cache
//      update so the radio reflects the choice immediately ([B11]).
//   2. Generation parameters — three sliders (temperature, topP, maxTokens)
//      bound to `settings.chat`. Each tick PATCHes; the optimistic update
//      keeps the slider responsive. The old frequencyPenalty slider was
//      dropped — the backend chat shape ([B11]) doesn't carry it, and the
//      UI was a no-op write to a Zustand-only field.
//   3. System prompt — per-story textarea, only rendered when an
//      `activeStoryId` is set. Reads via `useStoryQuery`, writes via
//      `useUpdateStoryMutation` on blur (the existing PATCH that [V13] +
//      [B2] already accept `systemPrompt` on).
import type { ChangeEvent, JSX } from 'react';
import { useEffect, useId, useRef, useState } from 'react';
import { ModelCard } from '@/components/ModelCard';
import { useModelsQuery } from '@/hooks/useModels';
import { useStoryQuery, useUpdateStoryMutation } from '@/hooks/useStories';
import { useUpdateUserSetting, useUserSettings } from '@/hooks/useUserSettings';
import { useActiveStoryStore } from '@/store/activeStory';

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
  const promptId = useId();

  const settings = useUserSettings();
  const updateSetting = useUpdateUserSetting();
  const modelsQuery = useModelsQuery();

  // --- Model list -------------------------------------------------------

  const modelId = settings.chat.model;
  const handleSelectModel = (id: string): void => {
    updateSetting.mutate({ chat: { model: id } });
  };

  // --- Generation parameters -------------------------------------------

  // Each slider tick PATCHes synchronously. The optimistic cache update
  // inside useUpdateUserSetting keeps the slider responsive (re-renders
  // immediately from the new cache value); only the network call is per-tick.
  // Acceptable for the local-server dev case; if PATCH frequency becomes an
  // issue in production, add a `mutateDebounced` variant to
  // useUpdateUserSetting and wrap these calls.
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
              className="font-serif w-full min-h-[120px] p-3 border border-line rounded-[var(--radius)] bg-bg focus:outline-none focus:border-ink-3"
            />
          </div>
        )}
      </section>
    </div>
  );
}
