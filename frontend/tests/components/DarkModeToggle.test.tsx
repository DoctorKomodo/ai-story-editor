import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { DarkModeToggle } from '@/components/DarkModeToggle';

describe('DarkModeToggle (F21) · design tokens', () => {
  it('renders with the design-system token classes (no raw Tailwind colors, no `dark:` overrides)', () => {
    render(<DarkModeToggle />);
    const toggle = screen.getByTestId('dark-mode-toggle');
    expect(toggle.className).not.toMatch(/\b(neutral|red|blue|gray|slate)-\d/);
    expect(toggle.className).not.toMatch(/\bdark:/);
  });
});
