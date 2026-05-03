import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DevErrorOverlay } from '@/components/DevErrorOverlay';
import { setDebugMode } from '@/lib/debug';
import { useErrorStore } from '@/store/errors';

afterEach(() => {
  act(() => {
    useErrorStore.getState().clear();
  });
  setDebugMode(false);
  vi.unstubAllEnvs();
});

describe('<DevErrorOverlay>', () => {
  it('renders nothing when there are no errors', () => {
    vi.stubEnv('DEV', true);
    setDebugMode(true);
    const { container } = render(<DevErrorOverlay />);
    expect(container.firstChild).toBeNull();
  });

  it('renders a stack of all errors in debug mode', () => {
    vi.stubEnv('DEV', true);
    setDebugMode(true);
    act(() => {
      useErrorStore.getState().push({
        severity: 'error',
        source: 'ai.complete',
        code: 'venice_key_invalid',
        message: 'first',
      });
      useErrorStore.getState().push({
        severity: 'warn',
        source: 'chat.send',
        code: 'no_model',
        message: 'second',
      });
    });
    render(<DevErrorOverlay />);
    expect(screen.getAllByTestId('dev-error-row')).toHaveLength(2);
    expect(screen.getByText(/first/)).toBeInTheDocument();
    expect(screen.getByText(/second/)).toBeInTheDocument();
  });

  it('renders only the latest severity:error as a strip in prod mode', () => {
    vi.stubEnv('DEV', false);
    setDebugMode(false);
    act(() => {
      useErrorStore.getState().push({
        severity: 'warn',
        source: 'x',
        code: null,
        message: 'old warn',
      });
      useErrorStore.getState().push({
        severity: 'error',
        source: 'x',
        code: null,
        message: 'fresh error',
      });
      useErrorStore.getState().push({
        severity: 'info',
        source: 'x',
        code: null,
        message: 'newer info',
      });
    });
    render(<DevErrorOverlay />);
    const rows = screen.queryAllByTestId('dev-error-row');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toHaveTextContent('fresh error');
  });

  it('Dismiss removes a single entry', async () => {
    vi.stubEnv('DEV', true);
    setDebugMode(true);
    let id = '';
    act(() => {
      id = useErrorStore.getState().push({
        severity: 'error',
        source: 'x',
        code: null,
        message: 'gone',
      });
    });
    render(<DevErrorOverlay />);
    await userEvent.click(screen.getByTestId(`dismiss-${id}`));
    expect(screen.queryAllByTestId('dev-error-row')).toHaveLength(0);
  });

  it('Clear all empties the store', async () => {
    vi.stubEnv('DEV', true);
    setDebugMode(true);
    act(() => {
      useErrorStore.getState().push({ severity: 'error', source: 'x', code: null, message: 'a' });
      useErrorStore.getState().push({ severity: 'error', source: 'x', code: null, message: 'b' });
    });
    render(<DevErrorOverlay />);
    await userEvent.click(screen.getByRole('button', { name: /clear all/i }));
    expect(useErrorStore.getState().errors).toEqual([]);
  });
});
