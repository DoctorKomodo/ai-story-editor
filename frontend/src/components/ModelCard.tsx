import type { JSX } from 'react';
/**
 * [F42] Reusable radio-card for model picking.
 *
 * Used by:
 *   - [F42] ModelPicker modal — opened from the chat panel model bar ([F38])
 *     and from the [X27] Settings → Models trigger.
 *
 * The card is rendered as a single `<button role="radio">` so the
 * surrounding container can mark itself with `role="radiogroup"`. Selection
 * state lives on `aria-checked`, with the visual treatment being the
 * `border-ink` ring (vs `border-line` when unchecked).
 *
 * [X27] Row 1 carries the display name, an optional price pill (USD per
 * 1M tokens), and a context-length chip. Row 2 — when at least one of
 * reasoning / web-search / description is present — carries the capability
 * labels and the model description as prose. supportsVision is deliberately
 * not surfaced; the app has no vision-capable surface.
 */
import type { Model } from '@/hooks/useModels';

export interface ModelCardProps {
  model: Model;
  selected: boolean;
  onSelect: (id: string) => void;
}

function formatContextLabel(n: number): string {
  if (n <= 0) return '';
  if (n >= 1000) {
    const k = Math.round(n / 1000);
    return `${String(k)}k`;
  }
  return String(n);
}

function formatPriceShort(usdPerM: number): string {
  return `$${usdPerM.toFixed(2)}`;
}

function formatPriceLong(usdPerM: number, side: 'input' | 'output'): string {
  return `$${usdPerM.toFixed(2)} USD per 1M ${side} tokens`;
}

export function ModelCard({ model, selected, onSelect }: ModelCardProps): JSX.Element {
  const ctxLabel = formatContextLabel(model.contextLength);
  const display = model.id ?? model.name;

  const capabilityLabels: string[] = [];
  if (model.supportsReasoning) capabilityLabels.push('Reasoning');
  if (model.supportsWebSearch) capabilityLabels.push('Web search');

  const hasDescription = model.description != null && model.description.length > 0;
  const hasCapabilities = capabilityLabels.length > 0;
  const hasRow2 = hasCapabilities || hasDescription;

  const row2Parts: string[] = [];
  if (hasCapabilities) row2Parts.push(capabilityLabels.join(' · '));
  if (hasDescription) row2Parts.push(model.description as string);
  const row2Text = row2Parts.join(' · ');

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
        {model.pricing != null ? (
          <span
            data-testid={`model-card-${model.id}-price`}
            title={`${formatPriceLong(model.pricing.inputUsdPerMTok, 'input')} · ${formatPriceLong(model.pricing.outputUsdPerMTok, 'output')}`}
            className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-bg border border-line text-ink-3 ml-auto"
          >
            {`${formatPriceShort(model.pricing.inputUsdPerMTok)} in · ${formatPriceShort(model.pricing.outputUsdPerMTok)} out`}
          </span>
        ) : null}
        {ctxLabel.length > 0 ? (
          <span
            data-testid={`model-card-${model.id}-ctx`}
            className={[
              'text-[10px] uppercase tracking-[.08em] font-mono px-1.5 py-0.5 rounded bg-bg border border-line text-ink-3',
              model.pricing != null ? '' : 'ml-auto',
            ].join(' ')}
          >
            {ctxLabel}
          </span>
        ) : null}
      </div>
      {hasRow2 ? (
        <div
          data-testid={`model-card-${model.id}-desc`}
          className="mt-1 font-sans text-[11.5px] text-ink-3 line-clamp-2"
        >
          {row2Text}
        </div>
      ) : null}
    </button>
  );
}
