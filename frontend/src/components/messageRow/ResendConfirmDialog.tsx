import { type JSX, useId } from 'react';
import { Button, Modal, ModalBody, ModalFooter, ModalHeader } from '@/design/primitives';

export interface ResendConfirmDialogProps {
  count: number;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ResendConfirmDialog({
  count,
  onConfirm,
  onCancel,
}: ResendConfirmDialogProps): JSX.Element {
  const titleId = useId();
  return (
    <Modal
      open
      onClose={onCancel}
      labelledBy={titleId}
      size="sm"
      role="alertdialog"
      testId="resend-confirm"
    >
      <ModalHeader titleId={titleId} title="Regenerate from here?" />
      <ModalBody>
        <p className="text-[13px] text-ink-2">
          {`This will delete ${String(count)} ${count === 1 ? 'message' : 'messages'} below and regenerate the reply.`}
        </p>
      </ModalBody>
      <ModalFooter>
        <Button variant="ghost" size="sm" onClick={onCancel}>
          Cancel
        </Button>
        <Button variant="primary" size="sm" onClick={onConfirm}>
          Regenerate
        </Button>
      </ModalFooter>
    </Modal>
  );
}
