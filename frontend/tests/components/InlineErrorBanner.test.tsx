import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { InlineErrorBanner } from '@/components/InlineErrorBanner';
import { setDebugMode } from '@/lib/debug';

afterEach(() => {
  setDebugMode(false);
  vi.unstubAllEnvs();
});

describe('<InlineErrorBanner>', () => {
  it('renders nothing when error is null', () => {
    const { container } = render(<InlineErrorBanner error={null} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders code · message when error is set', () => {
    render(
      <InlineErrorBanner
        error={{ code: 'venice_key_invalid', message: 'Venice rejected the key.' }}
      />,
    );
    expect(screen.getByRole('alert')).toHaveTextContent('venice_key_invalid');
    expect(screen.getByRole('alert')).toHaveTextContent('Venice rejected the key.');
  });

  it('omits code prefix when code is null', () => {
    render(<InlineErrorBanner error={{ code: null, message: 'Plain message.' }} />);
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('Plain message.');
    expect(alert).not.toHaveTextContent('null');
  });

  it('fires onRetry when Retry is clicked', async () => {
    const onRetry = vi.fn();
    render(<InlineErrorBanner error={{ code: 'x', message: 'y' }} onRetry={onRetry} />);
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('shows a Show raw toggle in debug mode that reveals detail', async () => {
    vi.stubEnv('DEV', true);
    setDebugMode(true);
    render(
      <InlineErrorBanner
        error={{ code: 'x', message: 'y', detail: { foo: 1 }, httpStatus: 500 }}
      />,
    );
    const toggle = screen.getByRole('button', { name: /show raw/i });
    expect(screen.queryByTestId('inline-error-raw')).toBeNull();
    await userEvent.click(toggle);
    const raw = screen.getByTestId('inline-error-raw');
    expect(raw).toHaveTextContent('"foo": 1');
    expect(raw).toHaveTextContent('500');
  });

  it('omits Show raw toggle when not in debug mode', () => {
    vi.stubEnv('DEV', false);
    setDebugMode(false);
    render(<InlineErrorBanner error={{ code: 'x', message: 'y', detail: { foo: 1 } }} />);
    expect(screen.queryByRole('button', { name: /show raw/i })).toBeNull();
  });
});
