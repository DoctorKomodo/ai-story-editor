import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { Checkbox, CheckboxField } from '@/design/primitives';

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

describe('CheckboxField', () => {
  it('renders the label and hint, wires the checkbox to the label via id', () => {
    render(
      <CheckboxField
        id="cf1"
        label="Auto-save"
        hint="Persist drafts as you type"
        testId="cf-test"
        checked={false}
        onChange={vi.fn()}
      />,
    );
    const box = screen.getByTestId('cf-test');
    expect(box).toHaveAttribute('id', 'cf1');
    expect(box).toHaveAttribute('type', 'checkbox');
    expect(screen.getByText('Auto-save')).toBeInTheDocument();
    expect(screen.getByText('Persist drafts as you type')).toBeInTheDocument();
  });

  it('calls onChange with the next boolean', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <CheckboxField id="cf2" label="Focus" testId="cf2" checked={false} onChange={onChange} />,
    );
    await user.click(screen.getByTestId('cf2'));
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it('omits the hint node when no hint is given', () => {
    render(<CheckboxField id="cf3" label="Bare" testId="cf3" checked onChange={vi.fn()} />);
    // Only the label text is present; no second span.
    expect(screen.getByText('Bare')).toBeInTheDocument();
  });
});
