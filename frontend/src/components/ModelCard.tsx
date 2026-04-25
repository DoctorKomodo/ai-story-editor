import type { JSX } from 'react';
/**
 * [F42] Reusable radio-card for model picking.
 *
 * Used by:
 *   - [F42] ModelPicker modal — opened from the chat panel model bar ([F38]).
 *   - [F44] Settings → Models tab.
 *
 * The card is rendered as a single `<button role="radio">` so the
 * surrounding container can mark itself with `role="radiogroup"`. Selection
 * state lives on `aria-checked`, with the visual treatment being the
 * `border-ink` ring (vs `border-line` when unchecked).
 *
 * The Model type comes straight from `useModelsQuery` ([F13]). Stat rows
 * (params, speed, notes) are not part of that shape today; the component
 * gracefully omits them when absent so the card still renders cleanly with
 * just `id` + context length, matching the live data path. When the backend
 * starts returning richer metadata, no caller has to change.
 */
import type { Model } from '@/hooks/useModels';

export interface ModelCardProps {
  model: Model;
  selected: boolean;
  onSelect: (id: string) => void;
}

/**
 * Optional metadata fields the mockup hints at but the live `Model` type
 * doesn't yet carry. Read defensively via this widened view so we can light
 * them up later without churn.
 */
interface ModelExtras {
  displayName?: string;
  params?: string;
  speed?: string;
  notes?: string;
}

function formatContextLabel(n: number): string {
  if (n <= 0) return '';
  if (n >= 1000) {
    // e.g. 32768 -> "32k", 128000 -> "128k". Round to nearest thousand.
    const k = Math.round(n / 1000);
    return `${String(k)}k`;
  }
  return String(n);
}

function readExtras(model: Model): ModelExtras {
  // The live shape only has id/name/contextLength/supports*. Any future
  // metadata (params/speed/notes) will flow through unchanged via a wider
  // backend payload.
  return model as Model & ModelExtras;
}

export function ModelCard({ model, selected, onSelect }: ModelCardProps): JSX.Element {
  const extras = readExtras(model);
  const ctxLabel = formatContextLabel(model.contextLength);
  const display = extras.displayName ?? model.id ?? model.name;

  const statBits: string[] = [];
  if (extras.params != null && extras.params.length > 0) statBits.push(extras.params);
  if (extras.speed != null && extras.speed.length > 0) statBits.push(extras.speed);
  const hasStats = statBits.length > 0;
  const hasNotes = extras.notes != null && extras.notes.length > 0;

  const className = [
    'flex flex-col items-stretch w-full text-left p-3 rounded-[var(--radius)] border',
    selected ? 'border-ink' : 'border-line',
    'hover:border-line-2 cursor-pointer bg-bg-elevated transition-colors',
  ].join(' ');

  return (
    // biome-ignore lint/a11y/useSemanticElements: radio-card pattern — the card is an interactive multi-line composition, not a single <input type="radio">. ARIA-radio-on-button is the recognised composite-widget pattern.
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      data-testid={`model-card-${model.id}`}
      data-selected={selected ? 'true' : 'false'}
      onClick={() => {
        onSelect(model.id);
      }}
      className={className}
    >
      <div className="flex items-baseline gap-2">
        <span className="font-mono text-[13px] text-ink">{display}</span>
        {ctxLabel.length > 0 ? (
          <span
            data-testid={`model-card-${model.id}-ctx`}
            className="text-[10px] uppercase tracking-[.08em] font-mono px-1.5 py-0.5 rounded bg-bg border border-line text-ink-3 ml-auto"
          >
            {ctxLabel}
          </span>
        ) : null}
      </div>
      {hasStats ? (
        <div
          data-testid={`model-card-${model.id}-stats`}
          className="mt-1 font-mono text-[11px] text-ink-4"
        >
          {statBits.join(' · ')}
        </div>
      ) : null}
      {hasNotes ? (
        <div
          data-testid={`model-card-${model.id}-notes`}
          className="mt-1 font-sans text-[11.5px] text-ink-3"
        >
          {extras.notes}
        </div>
      ) : null}
    </button>
  );
}
