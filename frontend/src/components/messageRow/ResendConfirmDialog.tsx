import type { JSX } from 'react';
import { ConfirmDialog } from '@/design/primitives';

export interface ResendConfirmDialogProps {
  count: number;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * Thin wrapper over the ConfirmDialog primitive. Kept as a named component
 * because it owns the message-count pluralization and ChatSceneTab imports it.
 */
export function ResendConfirmDialog({
  count,
  onConfirm,
  onCancel,
}: ResendConfirmDialogProps): JSX.Element {
  return (
    <ConfirmDialog
      open
      title="Regenerate from here?"
      body={`This will delete ${String(count)} ${count === 1 ? 'message' : 'messages'} below and regenerate the reply.`}
      confirmLabel="Regenerate"
      confirmVariant="primary"
      onConfirm={onConfirm}
      onCancel={onCancel}
      testId="resend-confirm"
    />
  );
}
