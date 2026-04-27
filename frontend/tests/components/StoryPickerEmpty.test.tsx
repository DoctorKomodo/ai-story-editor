// [F64] Hero rendered inside StoryPicker when stories.length === 0.

import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { StoryPickerEmpty } from '@/components/StoryPickerEmpty';

describe('StoryPickerEmpty (F64)', () => {
  it('renders the brand mark, headline, and supporting line', () => {
    render(<StoryPickerEmpty />);
    expect(screen.getByRole('heading', { name: /your stories live here/i })).toBeInTheDocument();
    expect(screen.getByText(/start a new project/i)).toBeInTheDocument();
    expect(screen.getByTestId('story-picker-empty')).toBeInTheDocument();
  });
});
