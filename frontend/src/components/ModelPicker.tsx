import type { JSX } from 'react';
/**
 * [F42] Model Picker modal.
 *
 * Opens from the chat panel model bar trigger ([F38] — `onOpenModelPicker`).
 * Renders a 480px centered card with a scrollable radio-card list of every
 * model returned by `useModelsQuery` ([F13]). Selecting a card writes the
 * choice to `useModelStore` and closes the modal.
 *
 * The radio-card itself is `<ModelCard>`, exported separately so the
 * Settings → Models tab ([F44]) can reuse it.
 */
import { type MouseEvent, useEffect, useId, useRef } from 'react';
import { ModelCard } from '@/components/ModelCard';
import { useModelsQuery } from '@/hooks/useModels';
import { useModelStore } from '@/store/model';

export interface ModelPickerProps {
  open: boolean;
  onClose: () => void;
}

function CloseIcon(): JSX.Element {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M18 6L6 18" />
      <path d="M6 6l12 12" />
    </svg>
  );
}

export function ModelPicker({ open, onClose }: ModelPickerProps): JSX.Element | null {
  const headingId = useId();
  const closeBtnRef = useRef<HTMLButtonElement | null>(null);

  const modelId = useModelStore((s) => s.modelId);
  const setModelId = useModelStore((s) => s.setModelId);

  const { data: models, isLoading, isError, error } = useModelsQuery();

  // Focus the close button when the modal opens.
  useEffect(() => {
    if (!open) return;
    const id = window.setTimeout(() => {
      closeBtnRef.current?.focus();
    }, 0);
    return () => {
      window.clearTimeout(id);
    };
  }, [open]);

  // Escape closes the modal.
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', handler);
    return () => {
      window.removeEventListener('keydown', handler);
    };
  }, [open, onClose]);

  if (!open) return null;

  const handleBackdropMouseDown = (e: MouseEvent<HTMLDivElement>): void => {
    if (e.target === e.currentTarget) onClose();
  };

  const handleSelect = (id: string): void => {
    setModelId(id);
    onClose();
  };

  return (
    <div
      role="presentation"
      data-testid="model-picker-backdrop"
      onMouseDown={handleBackdropMouseDown}
      className="fixed inset-0 z-50 grid place-items-center bg-[rgba(20,18,12,.4)] backdrop-blur-[3px]"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={headingId}
        data-testid="model-picker"
        className="w-[480px] max-w-[94vw] max-h-[80vh] flex flex-col overflow-hidden rounded-[var(--radius-lg)] border border-line-2 bg-bg-elevated shadow-pop"
      >
        <header className="px-[18px] py-[14px] border-b border-line flex items-center justify-between">
          <h2
            id={headingId}
            className="m-0 font-serif text-[18px] font-medium text-ink tracking-[-0.005em]"
          >
            Pick a model
          </h2>
          <button
            ref={closeBtnRef}
            type="button"
            className="icon-btn"
            onClick={onClose}
            aria-label="Close"
            data-testid="model-picker-close"
          >
            <CloseIcon />
          </button>
        </header>

        <div
          role="radiogroup"
          aria-label="Model"
          data-testid="model-picker-body"
          className="flex-1 overflow-y-auto p-3 flex flex-col gap-2"
        >
          {isLoading ? (
            <div className="py-8 text-center font-mono text-[12px] text-ink-4">Loading models…</div>
          ) : isError ? (
            <div
              role="alert"
              className="py-8 text-center font-mono text-[12px] text-[color:var(--danger)]"
            >
              {error instanceof Error ? error.message : 'Failed to load models.'}
            </div>
          ) : !models || models.length === 0 ? (
            <div className="py-8 text-center font-mono text-[12px] text-ink-4">
              No models available
            </div>
          ) : (
            models.map((m) => (
              <ModelCard key={m.id} model={m} selected={m.id === modelId} onSelect={handleSelect} />
            ))
          )}
        </div>
      </div>
    </div>
  );
}
