import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { App } from '@/App';
import { useSessionStore } from '@/store/session';

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

  it('renders the App via the @/ alias', async () => {
    // App mounts the router and kicks off initAuth which hits fetch.
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 401 })));
    render(<App />);
    expect(screen.getByRole('status')).toBeInTheDocument();
    // Wait for initAuth's refresh to settle so the post-render
    // clearSession() lands inside act.
    await waitFor(() => {
      expect(useSessionStore.getState().status).toBe('unauthenticated');
    });
    vi.unstubAllGlobals();
  });
});
