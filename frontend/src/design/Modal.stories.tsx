import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import {
  Button,
  Field,
  Input,
  Modal,
  ModalBody,
  ModalFooter,
  ModalHeader,
  useId,
} from './primitives';

function ModalDemo({
  size = 'md',
  dismissable = true,
  role = 'dialog',
}: {
  size?: 'sm' | 'md' | 'lg' | 'xl';
  dismissable?: boolean;
  role?: 'dialog' | 'alertdialog';
}) {
  const [open, setOpen] = useState(true);
  const titleId = useId();
  const nameId = useId();
  return (
    <>
      <Button variant="ghost" onClick={() => setOpen(true)}>
        Reopen modal
      </Button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        labelledBy={titleId}
        size={size}
        dismissable={dismissable}
        role={role}
      >
        <ModalHeader
          titleId={titleId}
          title="Edit character"
          onClose={dismissable ? () => setOpen(false) : undefined}
        />
        <ModalBody>
          <Field htmlFor={nameId} label="Name" hint="Required">
            <Input id={nameId} defaultValue="Lyra" />
          </Field>
        </ModalBody>
        <ModalFooter>
          <Button variant="ghost" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button variant="primary" onClick={() => setOpen(false)}>
            Save
          </Button>
        </ModalFooter>
      </Modal>
    </>
  );
}

const meta = {
  title: 'Primitives/Modal',
  component: ModalDemo,
} satisfies Meta<typeof ModalDemo>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = { args: {} };
export const Small: Story = { args: { size: 'sm' } };
export const Large: Story = { args: { size: 'lg' } };
export const NotDismissable: Story = { args: { dismissable: false } };
export const AlertDialog: Story = {
  args: { role: 'alertdialog', size: 'sm', dismissable: false },
};
