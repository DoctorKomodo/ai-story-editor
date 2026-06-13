// [X33] Inline master/detail model picker — embedded in the Settings → Models
// tab. Pure presentational; the caller wires `activeId` from settings and
// `onUseModel` to PATCH /users/me/settings.
//
// Layout: 240px rail (scrollable list of models) + flex-1 detail pane
// (capabilities, description, pricing/context grid, "Use this model" CTA).
import type { JSX } from 'react';
import { Button } from '@/design/primitives';
import type { Model } from '@/hooks/useModels';

export interface ModelPickerInlineProps {
  models: Model[];
  activeId: string | null;
  highlightedId: string | null;
  onHighlightChange: (id: string) => void;
  onUseModel: (id: string) => void;
  loading?: boolean;
  error?: boolean;
}

function formatCtx(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(0)}M`;
  if (n >= 1000) return `${Math.round(n / 1000)}k`;
  return String(n);
}

function formatUsd(usd: number): string {
  return `$${usd.toFixed(2)}`;
}

interface RailRowProps {
  model: Model;
  highlighted: boolean;
  active: boolean;
  onPreview: () => void;
}

function RailRow({ model, highlighted, active, onPreview }: RailRowProps): JSX.Element {
  return (
    <button
      type="button"
      onClick={onPreview}
      data-testid={`model-rail-${model.id}`}
      aria-current={highlighted ? 'true' : undefined}
      className={[
        'w-full text-left px-3 py-2.5 border-l-2 transition-colors',
        highlighted
          ? 'bg-bg-sunken border-l-ink'
          : 'bg-transparent border-l-transparent hover:bg-bg-sunken/60',
      ].join(' ')}
    >
      <div className="flex items-center gap-1.5">
        {active ? (
          <span
            role="img"
            aria-label="Currently in use"
            title="Currently in use"
            className="inline-block size-1.5 rounded-full bg-ink shrink-0"
          />
        ) : null}
        <span className="font-mono text-[12.5px] text-ink truncate">{model.name}</span>
      </div>
      <div className="mt-0.5 flex items-center justify-between gap-2">
        <span className="font-mono text-[10.5px] text-ink-4 tabular-nums truncate">
          {model.pricing != null
            ? `${formatUsd(model.pricing.inputUsdPerMTok)} · ${formatUsd(model.pricing.outputUsdPerMTok)}`
            : 'no price'}
        </span>
        <span className="font-mono text-[10px] uppercase tracking-[.06em] text-ink-3 shrink-0">
          {formatCtx(model.contextLength)}
        </span>
      </div>
    </button>
  );
}

interface CapabilityChipProps {
  label: string;
}

function CapabilityChip({ label }: CapabilityChipProps): JSX.Element {
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-[var(--radius)] border border-line text-[11px] text-ink-2 font-sans">
      <span aria-hidden="true" className="size-1 rounded-full bg-ink-3" />
      {label}
    </span>
  );
}

interface DetailPaneProps {
  model: Model;
  isActive: boolean;
  onUseModel: (id: string) => void;
}

function DetailPane({ model, isActive, onUseModel }: DetailPaneProps): JSX.Element {
  const capabilities: string[] = [];
  if (model.supportsReasoning) capabilities.push('Reasoning');
  if (model.supportsWebSearch) capabilities.push('Web search');

  return (
    <div className="flex flex-col gap-5 p-6 overflow-y-auto h-full">
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3
            data-testid="model-detail-name"
            className="m-0 font-serif text-[20px] leading-tight text-ink truncate"
          >
            {model.name}
          </h3>
          <code className="font-mono text-[11px] text-ink-4 tracking-tight">{model.id}</code>
        </div>
        <Button
          data-testid="model-detail-cta"
          variant={isActive ? 'ghost' : 'primary'}
          size="sm"
          disabled={isActive}
          onClick={() => {
            onUseModel(model.id);
          }}
        >
          {isActive ? 'Currently in use' : 'Use this model'}
        </Button>
      </header>

      {capabilities.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {capabilities.map((c) => (
            <CapabilityChip key={c} label={c} />
          ))}
        </div>
      ) : null}

      <p
        data-testid="model-detail-description"
        className="m-0 font-sans text-[13.5px] leading-[1.6] text-ink-2"
      >
        {model.description ?? (
          <span className="italic text-ink-4">No description provided by the model host.</span>
        )}
      </p>

      <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-2 text-[12px]">
        <dt className="font-sans text-ink-4">Context window</dt>
        <dd data-testid="model-detail-context" className="m-0 font-mono text-ink-2 tabular-nums">
          {formatCtx(model.contextLength)} tokens
        </dd>

        <dt className="font-sans text-ink-4">Input price</dt>
        <dd
          data-testid="model-detail-input-price"
          className="m-0 font-mono text-ink-2 tabular-nums"
        >
          {model.pricing != null ? `${formatUsd(model.pricing.inputUsdPerMTok)} / 1M tokens` : '—'}
        </dd>

        <dt className="font-sans text-ink-4">Output price</dt>
        <dd
          data-testid="model-detail-output-price"
          className="m-0 font-mono text-ink-2 tabular-nums"
        >
          {model.pricing != null ? `${formatUsd(model.pricing.outputUsdPerMTok)} / 1M tokens` : '—'}
        </dd>
      </dl>
    </div>
  );
}

function SkeletonRail(): JSX.Element {
  return (
    <div data-testid="model-rail-skeleton" className="flex flex-col gap-1 p-3">
      {Array.from({ length: 8 }).map((_, i) => (
        <div
          // biome-ignore lint/suspicious/noArrayIndexKey: skeleton rows are positional, never reordered
          key={i}
          className="h-9 rounded-[var(--radius)] bg-bg-sunken animate-pulse"
        />
      ))}
    </div>
  );
}

function ErrorFrame(): JSX.Element {
  return (
    <div className="grid place-items-center p-6 text-center text-[12.5px] text-ink-4 font-sans h-[360px] col-span-2">
      Couldn't load models. Try reopening Settings.
    </div>
  );
}

export function ModelPickerInline({
  models,
  activeId,
  highlightedId,
  onHighlightChange,
  onUseModel,
  loading = false,
  error = false,
}: ModelPickerInlineProps): JSX.Element {
  if (error) {
    return (
      <div className="grid grid-cols-[240px_1fr] min-h-[360px] rounded-[var(--radius)] border border-line bg-bg-elevated overflow-hidden">
        <ErrorFrame />
      </div>
    );
  }

  if (loading || models.length === 0) {
    return (
      <div className="grid grid-cols-[240px_1fr] min-h-[360px] rounded-[var(--radius)] border border-line bg-bg-elevated overflow-hidden">
        <div className="border-r border-line bg-bg-sunken/30">
          <SkeletonRail />
        </div>
        <div />
      </div>
    );
  }

  const highlighted = models.find((m) => m.id === highlightedId) ?? models[0] ?? null;
  if (highlighted == null) return <div />;

  return (
    <div className="grid grid-cols-[240px_1fr] min-h-[360px] rounded-[var(--radius)] border border-line bg-bg-elevated overflow-hidden">
      <div
        role="listbox"
        aria-label="Models"
        data-testid="model-rail"
        className="overflow-y-auto border-r border-line bg-bg-sunken/30 max-h-[420px]"
      >
        {models.map((m) => (
          <RailRow
            key={m.id}
            model={m}
            highlighted={m.id === highlighted.id}
            active={m.id === activeId}
            onPreview={() => {
              onHighlightChange(m.id);
            }}
          />
        ))}
      </div>

      <DetailPane
        model={highlighted}
        isActive={highlighted.id === activeId}
        onUseModel={onUseModel}
      />
    </div>
  );
}
