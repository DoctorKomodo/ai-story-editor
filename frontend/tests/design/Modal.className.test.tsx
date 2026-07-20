import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Modal, ModalBody, ModalHeader } from '@/design/primitives';

// NOTE: assert on whitespace-split TOKENS, never substring — `max-h-[82vh]`
// CONTAINS the substring `h-[82vh]`, so `.toContain('h-[82vh]')` would
// false-match the built-in cap and prove nothing. Token membership
// distinguishes the `h-[82vh]` class from `max-h-[82vh]`.
describe('Modal className passthrough', () => {
  it('merges a caller className onto the card without dropping the built-ins', () => {
    render(
      <Modal open onClose={() => {}} labelledBy="t" testId="probe" className="h-[82vh]">
        <ModalHeader titleId="t" title="probe" />
        <ModalBody>body</ModalBody>
      </Modal>,
    );
    const tokens = screen.getByTestId('probe').className.split(/\s+/);
    expect(tokens).toContain('h-[82vh]'); // caller class present as its own token
    expect(tokens).toContain('max-h-[82vh]'); // built-in cap retained
    expect(tokens).toContain('flex'); // built-in retained
  });

  it('omitting className leaves the built-in card classes intact and adds no fixed height', () => {
    render(
      <Modal open onClose={() => {}} labelledBy="t" testId="probe2">
        <ModalHeader titleId="t" title="probe" />
        <ModalBody>body</ModalBody>
      </Modal>,
    );
    const tokens = screen.getByTestId('probe2').className.split(/\s+/);
    expect(tokens).toContain('max-h-[82vh]'); // built-in cap still there
    expect(tokens).not.toContain('h-[82vh]'); // no fixed-height token leaked in
  });
});
