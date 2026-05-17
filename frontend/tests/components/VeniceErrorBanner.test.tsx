import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { VeniceErrorBanner } from '@/components/VeniceErrorBanner';
import { useSettingsModalStore } from '@/store/settingsModal';

describe('VeniceErrorBanner', () => {
  beforeEach(() => {
    useSettingsModalStore.getState().close();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders nothing when error is null', () => {
    const { container } = render(<VeniceErrorBanner error={null} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('venice_rate_limited: renders live countdown that ticks down', () => {
    render(
      <VeniceErrorBanner
        error={{ code: 'venice_rate_limited', message: 'Slow down', retryAfterSeconds: 5 }}
      />,
    );
    expect(screen.getByText(/Try again in 5s/)).toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(screen.getByText(/Try again in 4s/)).toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(4000);
    });
    expect(screen.queryByText(/Try again in/)).not.toBeInTheDocument();
  });

  it('venice_rate_limited with retryAfterSeconds=null: omits countdown', () => {
    render(
      <VeniceErrorBanner
        error={{ code: 'venice_rate_limited', message: 'Slow', retryAfterSeconds: null }}
      />,
    );
    expect(screen.queryByText(/Try again in/)).not.toBeInTheDocument();
  });

  it('venice_key_invalid: Open Settings button calls openWith("venice")', () => {
    render(<VeniceErrorBanner error={{ code: 'venice_key_invalid', message: 'Bad key' }} />);
    const btn = screen.getByRole('button', { name: /Open Settings/i });
    fireEvent.click(btn);
    expect(useSettingsModalStore.getState()).toMatchObject({
      open: true,
      initialTab: 'venice',
    });
  });

  it('venice_key_required: Open Settings button is present', () => {
    render(<VeniceErrorBanner error={{ code: 'venice_key_required', message: 'No key' }} />);
    expect(screen.getByRole('button', { name: /Open Settings/i })).toBeInTheDocument();
  });

  it('venice_insufficient_balance: external Top up link present with rel attrs', () => {
    render(
      <VeniceErrorBanner
        error={{ code: 'venice_insufficient_balance', message: 'Out of credits' }}
      />,
    );
    const link = screen.getByRole('link', { name: /Top up at venice\.ai/i });
    expect(link).toHaveAttribute('href', 'https://venice.ai/settings/api');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  });

  it('venice_unavailable: no special affordance — generic rendering only', () => {
    render(<VeniceErrorBanner error={{ code: 'venice_unavailable', message: 'Down' }} />);
    expect(screen.queryByRole('button', { name: /Open Settings/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Top up/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/Try again in/)).not.toBeInTheDocument();
  });

  it('renders veniceMessage line under the headline when present', () => {
    render(
      <VeniceErrorBanner
        error={{
          code: 'venice_error',
          message: 'Venice rejected the request.',
          veniceMessage: 'Invalid model id "foo".',
        }}
      />,
    );
    expect(screen.getByText(/Venice said: Invalid model id "foo"\./)).toBeInTheDocument();
  });

  it('omits the veniceMessage line when absent', () => {
    render(<VeniceErrorBanner error={{ code: 'venice_error', message: 'Failed' }} />);
    expect(screen.queryByText(/Venice said:/)).not.toBeInTheDocument();
  });

  it('truncates veniceMessage at 280 chars with ellipsis', () => {
    const long = 'x'.repeat(400);
    render(
      <VeniceErrorBanner
        error={{ code: 'venice_error', message: 'Failed', veniceMessage: long }}
      />,
    );
    const text = screen.getByText(/Venice said: /).textContent ?? '';
    expect(text.length).toBeLessThanOrEqual('Venice said: '.length + 281); // 280 + ellipsis
    expect(text).toMatch(/…$/);
  });

  it('calls onRetry when Retry clicked', () => {
    const onRetry = vi.fn();
    render(
      <VeniceErrorBanner
        error={{ code: 'venice_unavailable', message: 'Down' }}
        onRetry={onRetry}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /Retry/i }));
    expect(onRetry).toHaveBeenCalledOnce();
  });
});
