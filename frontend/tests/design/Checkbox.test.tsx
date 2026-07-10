import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { Checkbox } from '@/design/primitives';

describe('Checkbox', () => {
  it('renders a checkbox input carrying the base classes', () => {
    render(<Checkbox aria-label="agree" />);
    const box = screen.getByRole('checkbox', { name: 'agree' });
    expect(box).toHaveAttribute('type', 'checkbox');
    expect(box.className).toMatch(/accent-accent/);
    expect(box.className).toMatch(/w-4/);
  });

  it('reflects checked and fires onChange', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Checkbox checked={false} onChange={onChange} aria-label="agree" />);
    await user.click(screen.getByRole('checkbox', { name: 'agree' }));
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it('does not fire onChange while disabled', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Checkbox checked={false} disabled onChange={onChange} aria-label="agree" />);
    await user.click(screen.getByRole('checkbox', { name: 'agree' }));
    expect(onChange).not.toHaveBeenCalled();
  });

  it('forwards data-testid, id, and aria-describedby, and merges className', () => {
    render(
      <Checkbox
        id="cb1"
        data-testid="cb-test"
        aria-describedby="hint1"
        className="mt-0.5"
        aria-label="agree"
      />,
    );
    const box = screen.getByTestId('cb-test');
    expect(box).toHaveAttribute('id', 'cb1');
    expect(box).toHaveAttribute('aria-describedby', 'hint1');
    expect(box.className).toMatch(/accent-accent/); // base kept
    expect(box.className).toMatch(/mt-0\.5/); // caller class merged, not replaced
  });
});
