import type { JSX } from 'react';
import { type Model, useModelsQuery } from '@/hooks/useModels';
import { useUserSettings } from '@/hooks/useUserSettings';

export interface ModelFooterProps {
  onOpenModelPicker?: () => void;
}

function VeniceMark(): JSX.Element {
  return (
    <svg
      data-testid="venice-mark"
      width="18"
      height="18"
      viewBox="0 0 18 18"
      aria-hidden="true"
      className="flex-shrink-0"
    >
      <rect width="18" height="18" rx="3" fill="var(--ink)" />
      <text
        x="9"
        y="13"
        textAnchor="middle"
        fontFamily="var(--serif)"
        fontStyle="italic"
        fontSize="12"
        fontWeight="500"
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

export function formatCtxLabel(contextLength: number): string {
  if (contextLength <= 0) return '—';
  if (contextLength >= 1000) return `${String(Math.round(contextLength / 1000))}k`;
  return String(contextLength);
}

export function ModelFooter({ onOpenModelPicker }: ModelFooterProps): JSX.Element {
  const settings = useUserSettings();
  const modelId = settings.chat.model;
  const { data: models } = useModelsQuery();
  const selectedModel: Model | undefined = models?.find((m) => m.id === modelId);
  const modelName = selectedModel?.name ?? 'No model';
  const ctxLabel = selectedModel ? formatCtxLabel(selectedModel.contextLength) : '—';

  return (
    <div
      className="bg-[var(--bg-sunken)] border-t border-line px-3.5 py-2 flex items-center gap-2"
      data-testid="model-footer"
    >
      <span className="text-[10px] uppercase tracking-[.08em] text-ink-4 font-sans">MODEL</span>
      <button
        type="button"
        onClick={onOpenModelPicker}
        aria-label="Open model picker"
        className="flex items-center gap-1.5 px-2 py-1 rounded-[var(--radius)] flex-1 min-w-0 hover:bg-[var(--surface-hover)] text-left"
      >
        <VeniceMark />
        <span className="font-mono text-[12px] text-ink truncate flex-1 min-w-0">{modelName}</span>
        <span
          className="text-[10px] uppercase font-mono px-1.5 py-0.5 rounded bg-bg border border-line text-ink-3"
          data-testid="ctx-chip"
        >
          {ctxLabel}
        </span>
        <ChevronDownIcon />
      </button>
    </div>
  );
}
