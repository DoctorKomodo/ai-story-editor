import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { SummaryStateIcon } from '@/components/SummaryStateIcon';

describe('SummaryStateIcon', () => {
  it('renders aria-label per state — missing', () => {
    render(<SummaryStateIcon state="missing" onClick={() => {}} ariaPressed={false} />);
    expect(screen.getByRole('button')).toHaveAccessibleName(/no summary yet/i);
  });

  it('renders aria-label per state — current', () => {
    render(<SummaryStateIcon state="current" onClick={() => {}} ariaPressed={false} />);
    expect(screen.getByRole('button')).toHaveAccessibleName(/summary present/i);
  });

  it('renders aria-label per state — stale', () => {
    render(<SummaryStateIcon state="stale" onClick={() => {}} ariaPressed={false} />);
    expect(screen.getByRole('button')).toHaveAccessibleName(/summary possibly stale/i);
  });

  it('renders aria-label per state — generating', () => {
    render(<SummaryStateIcon state="generating" onClick={() => {}} ariaPressed={false} />);
    expect(screen.getByRole('button')).toHaveAccessibleName(/generating summary/i);
  });

  it('renders aria-label per state — corrupted', () => {
    render(<SummaryStateIcon state="corrupted" onClick={() => {}} ariaPressed={false} />);
    expect(screen.getByRole('button')).toHaveAccessibleName(/summary unreadable/i);
  });

  it('click does not bubble (stopPropagation)', () => {
    const rowClick = vi.fn();
    const iconClick = vi.fn();
    render(
      <button type="button" onClick={rowClick}>
        <SummaryStateIcon state="current" onClick={iconClick} ariaPressed={false} />
      </button>,
    );
    fireEvent.click(screen.getByLabelText(/summary present/i));
    expect(iconClick).toHaveBeenCalledOnce();
    expect(rowClick).not.toHaveBeenCalled();
  });

  it('forwards ariaPressed to the button', () => {
    render(<SummaryStateIcon state="current" onClick={() => {}} ariaPressed={true} />);
    expect(screen.getByRole('button')).toHaveAttribute('aria-pressed', 'true');
  });
});
