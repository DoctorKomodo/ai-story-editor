import type { JSX } from 'react';
/**
 * [F42] Model Picker modal.
 *
 * Opens from the chat panel model bar trigger ([F38] — `onOpenModelPicker`).
 * Selecting a card writes the choice to `useModelStore` and closes the modal.
 *
 * The radio-card itself is `<ModelCard>`, exported separately so the
 * Settings → Models tab ([F44]) can reuse it.
 *
 * [X22] Ported onto the `<Modal>` primitive — backdrop, Escape, click-outside,
 * focus management, and close-X chrome all live in the primitive now.
 */
import { useId } from 'react';
import { ModelCard } from '@/components/ModelCard';
import { Modal, ModalBody, ModalHeader } from '@/design/primitives';
import { useModelsQuery } from '@/hooks/useModels';
import { useUpdateUserSetting, useUserSettings } from '@/hooks/useUserSettings';

export interface ModelPickerProps {
  open: boolean;
  onClose: () => void;
}

export function ModelPicker({ open, onClose }: ModelPickerProps): JSX.Element | null {
  const headingId = useId();

  const modelId = useUserSettings().chat.model;
  const updateSetting = useUpdateUserSetting();

  const { data: models, isLoading, isError, error } = useModelsQuery();

  // Writing through useUpdateUserSetting PATCHes the backend, so a model
  // pick syncs across devices instead of staying in browser-local state.
  const handleSelect = (id: string): void => {
    updateSetting.mutate({ chat: { model: id } });
    onClose();
  };

  return (
    <Modal open={open} onClose={onClose} labelledBy={headingId} size="md" testId="model-picker">
      <ModalHeader
        titleId={headingId}
        title="Pick a model"
        onClose={onClose}
        closeTestId="model-picker-close"
      />
      <ModalBody
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
      </ModalBody>
    </Modal>
  );
}
