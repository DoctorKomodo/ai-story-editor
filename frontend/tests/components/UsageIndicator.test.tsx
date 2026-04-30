import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { formatRequests, formatTokens, UsageIndicator } from '@/components/UsageIndicator';

describe('F16 · UsageIndicator component', () => {
  it('returns null when usage is null', () => {
    const { container } = render(<UsageIndicator usage={null} />);
    expect(container.firstChild).toBeNull();
  });

  it('returns null when both fields are null', () => {
    const { container } = render(
      <UsageIndicator usage={{ remainingRequests: null, remainingTokens: null }} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it('renders both fields with the canonical separator', () => {
    render(<UsageIndicator usage={{ remainingRequests: 482, remainingTokens: 1_200_000 }} />);
    const status = screen.getByRole('status', { name: /venice usage/i });
    expect(status).toHaveTextContent('482 requests / 1.2M tokens remaining');
  });

  it('formats requests with a K suffix and omits the separator when tokens are absent', () => {
    render(<UsageIndicator usage={{ remainingRequests: 1250, remainingTokens: null }} />);
    const status = screen.getByRole('status', { name: /venice usage/i });
    expect(status).toHaveTextContent('1.3K requests remaining');
    expect(status.textContent ?? '').not.toContain('/');
  });

  it('formats tokens with an M suffix when only tokens are present', () => {
    render(<UsageIndicator usage={{ remainingRequests: null, remainingTokens: 2_500_000 }} />);
    const status = screen.getByRole('status', { name: /venice usage/i });
    expect(status).toHaveTextContent('2.5M tokens remaining');
    expect(status.textContent ?? '').not.toContain('/');
  });

  it('formats tokens with a K suffix (rounded integer) when only tokens are present', () => {
    render(<UsageIndicator usage={{ remainingRequests: null, remainingTokens: 482_000 }} />);
    const status = screen.getByRole('status', { name: /venice usage/i });
    expect(status).toHaveTextContent('482K tokens remaining');
  });
});

describe('F16 · UsageIndicator design tokens', () => {
  it('renders with the design-system token classes (no raw Tailwind colors)', () => {
    render(<UsageIndicator usage={{ remainingRequests: 482, remainingTokens: 1_200_000 }} />);
    const status = screen.getByTestId('usage-indicator');
    expect(status).toHaveClass('text-ink-3');
    expect(status).toHaveClass('font-mono');
    expect(status.className).not.toMatch(/\b(neutral|red|blue|gray|slate)-\d/);
  });
});

describe('F16 · formatters', () => {
  it('formatRequests renders sub-1000 as plain integers', () => {
    expect(formatRequests(482)).toBe('482');
  });

  it('formatRequests renders >=1000 with a K suffix rounded to 1 decimal', () => {
    expect(formatRequests(1250)).toBe('1.3K');
    expect(formatRequests(10_000)).toBe('10.0K');
  });

  it('formatTokens handles the three magnitude bands', () => {
    expect(formatTokens(950)).toBe('950');
    expect(formatTokens(482_000)).toBe('482K');
    expect(formatTokens(2_500_000)).toBe('2.5M');
  });

  it('formatTokens promotes to M when K-rounding overflows past 999K', () => {
    expect(formatTokens(999_500)).toBe('1.0M');
    expect(formatTokens(999_999)).toBe('1.0M');
  });
});
