import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Modal, ModalBody, ModalHeader } from '@/design/primitives';

/**
 * [X25] Modal centring + entrance-animation regression guard.
 *
 * The original bug: the Modal card carried both `t-modal-in` (whose keyframe
 * animated `transform: translate(-50%, -50%)`) and Tailwind v4's
 * `-translate-x-1/2 -translate-y-1/2` utilities (which compile to the
 * `translate` CSS *longhand*). The two compose at the engine level, so during
 * the 180ms animation the card was double-translated to (-100%, -100%) — i.e.
 * the upper-left of viewport centre — and snapped back when the animation
 * ended (because the keyframe has no `forwards` fill-mode, so its `transform`
 * reverted and only the Tailwind `translate` utility remained).
 *
 * Fix: the Modal card no longer applies any centring transform itself — it
 * relies on the backdrop's `flex items-center justify-center`. The keyframe
 * was simplified to `translateY(8px) scale(.98) → translateY(0) scale(1)`,
 * which is purely an entrance offset and never collides with positioning.
 *
 * jsdom can't run CSS animations, so we assert the structural conditions that
 * make the bug impossible by construction:
 *   1. The Modal card's class string must NOT carry `-translate-x-1/2` /
 *      `-translate-y-1/2` / `top-1/2` / `left-1/2` / `fixed`.
 *   2. The `t-modal-in` keyframe in `index.css` must NOT contain
 *      `translate(-50%, -50%)` (in any spacing).
 */

const CSS = readFileSync(resolve(__dirname, '../../src/index.css'), 'utf8');

describe('[X25] Modal centring regression guard', () => {
  it('the Modal card does not layer Tailwind centring utilities on top of t-modal-in', () => {
    render(
      <Modal open onClose={() => {}} labelledBy="t" testId="probe">
        <ModalHeader titleId="t" title="probe" />
        <ModalBody>body</ModalBody>
      </Modal>,
    );
    const card = screen.getByTestId('probe');
    const cls = card.className;

    expect(cls).toContain('t-modal-in');
    // Centring is the backdrop flex container's job — the card must not
    // re-introduce these utilities or the X25 double-translate returns.
    expect(cls).not.toContain('-translate-x-1/2');
    expect(cls).not.toContain('-translate-y-1/2');
    expect(cls).not.toContain('top-1/2');
    expect(cls).not.toContain('left-1/2');
    expect(cls).not.toMatch(/(^|\s)fixed(\s|$)/);
  });

  it('t-modal-in keyframes do not include a centring translate(-50%, -50%)', () => {
    // Pull only the inkwell-modal-in keyframes block (the popover keyframes
    // legitimately use translateY, but neither should ever use translate(-50…).
    const match = CSS.match(/@keyframes\s+inkwell-modal-in\s*\{[\s\S]*?\n\}/);
    expect(match).not.toBeNull();
    const block = match![0];
    expect(block).not.toMatch(/translate\(\s*-50%/);
    // Sanity: the entrance offset is still translateY(8px).
    expect(block).toMatch(/translateY\(\s*8px\s*\)/);
  });
});
