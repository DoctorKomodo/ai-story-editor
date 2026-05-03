import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ThinkingDots } from '@/design/ThinkingDots';

describe('<ThinkingDots />', () => {
  it('renders a status region with the default "Thinking" label', () => {
    render(<ThinkingDots />);
    const region = screen.getByRole('status', { name: 'Thinking' });
    expect(region).toBeInTheDocument();
    expect(region).toHaveAttribute('data-testid', 'thinking-dots');
  });

  it('renders three .think-dot spans', () => {
    const { container } = render(<ThinkingDots />);
    const dots = container.querySelectorAll('.think-dot');
    expect(dots).toHaveLength(3);
  });

  it('staggers the animation-delay on each dot (0ms / 150ms / 300ms)', () => {
    const { container } = render(<ThinkingDots />);
    const dots = container.querySelectorAll<HTMLElement>('.think-dot');
    expect(dots[0].style.animationDelay).toBe('0ms');
    expect(dots[1].style.animationDelay).toBe('150ms');
    expect(dots[2].style.animationDelay).toBe('300ms');
  });

  it('accepts a custom label and forwards a className for layout', () => {
    render(<ThinkingDots label="Generating" className="ml-auto" />);
    const region = screen.getByRole('status', { name: 'Generating' });
    expect(region.className).toContain('ml-auto');
  });
});
