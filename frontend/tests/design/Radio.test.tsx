import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { Radio, RadioGroup } from '@/design/primitives';

describe('Radio', () => {
  it('renders a radio input with the base classes', () => {
    render(<Radio name="g" value="a" aria-label="option a" />);
    const radio = screen.getByRole('radio', { name: 'option a' });
    expect(radio).toHaveAttribute('type', 'radio');
    expect(radio.className).toMatch(/accent-accent/);
  });
});

describe('RadioGroup', () => {
  const options = [
    { value: 'fork' as const, label: 'Fork', testId: 'opt-fork' },
    { value: 'blank' as const, label: 'Start blank', testId: 'opt-blank' },
  ];

  it('renders a labelled group with one radio per option and marks the selected one', () => {
    render(
      <RadioGroup
        name="mode"
        legend="Starting point"
        value="fork"
        onChange={vi.fn()}
        options={options}
      />,
    );
    const group = screen.getByRole('radiogroup', { name: 'Starting point' });
    expect(group).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Fork' })).toBeChecked();
    expect(screen.getByRole('radio', { name: 'Start blank' })).not.toBeChecked();
  });

  it('calls onChange with the selected value', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <RadioGroup
        name="mode"
        legend="Starting point"
        value="fork"
        onChange={onChange}
        options={options}
      />,
    );
    await user.click(screen.getByRole('radio', { name: 'Start blank' }));
    expect(onChange).toHaveBeenCalledWith('blank');
  });

  it('hides the legend visually when srOnlyLegend is set but keeps it accessible', () => {
    render(
      <RadioGroup
        name="mode"
        legend="Starting point"
        srOnlyLegend
        value="fork"
        onChange={vi.fn()}
        options={options}
      />,
    );
    // Still the accessible name of the group.
    expect(screen.getByRole('radiogroup', { name: 'Starting point' })).toBeInTheDocument();
    // Legend element carries sr-only.
    expect(screen.getByText('Starting point').className).toMatch(/sr-only/);
  });

  it('disables all radios when the group is disabled', () => {
    render(
      <RadioGroup
        name="mode"
        legend="Starting point"
        value="fork"
        onChange={vi.fn()}
        options={options}
        disabled
      />,
    );
    expect(screen.getByRole('radio', { name: 'Fork' })).toBeDisabled();
    expect(screen.getByRole('radio', { name: 'Start blank' })).toBeDisabled();
  });
});
