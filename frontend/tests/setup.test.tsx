import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { App } from '@/App';

describe('test setup', () => {
  it('jsdom provides a document', () => {
    expect(typeof document).toBe('object');
    expect(document.body).toBeInstanceOf(HTMLElement);
  });

  it('jest-dom matchers are registered', () => {
    document.body.innerHTML = '<button disabled>Save</button>';
    const btn = document.querySelector('button')!;
    expect(btn).toBeDisabled();
    expect(btn).toHaveTextContent('Save');
  });

  it('renders the App via the @/ alias', () => {
    render(<App />);
    expect(screen.getByRole('heading', { name: /story editor/i })).toBeVisible();
  });
});
