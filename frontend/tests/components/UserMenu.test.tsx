import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { UserMenu } from '@/components/UserMenu';

describe('F17/F26 · UserMenu component', () => {
  it('renders the avatar with the username initial as its accessible label', () => {
    render(<UserMenu username="alice" onSignOut={vi.fn()} balance={null} />);
    const toggle = screen.getByRole('button', { name: 'alice' });
    expect(toggle).toBeInTheDocument();
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(toggle).toHaveTextContent('A');
  });

  it('clicking the toggle opens the menu and reveals the balance + Sign out button', async () => {
    render(<UserMenu username="alice" onSignOut={vi.fn()} balance={{ credits: 10, diem: 500 }} />);
    const toggle = screen.getByRole('button', { name: 'alice' });
    await userEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('menu', { name: /user menu/i })).toBeInTheDocument();
    expect(screen.getByText('USD: $10.00')).toBeInTheDocument();
    expect(screen.getByText('Diem: 500')).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: /sign out/i })).toBeInTheDocument();
  });

  it('renders the @username header in the open menu', async () => {
    render(<UserMenu username="alice" onSignOut={vi.fn()} balance={null} />);
    await userEvent.click(screen.getByRole('button', { name: 'alice' }));
    expect(screen.getByText('@alice')).toBeInTheDocument();
  });

  it('renders Settings, Your stories, Account & privacy, and Sign out menu items', async () => {
    render(<UserMenu username="alice" onSignOut={vi.fn()} balance={null} />);
    await userEvent.click(screen.getByRole('button', { name: 'alice' }));
    expect(screen.getByRole('menuitem', { name: /^settings$/i })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: /your stories/i })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: /account & privacy/i })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: /sign out/i })).toBeInTheDocument();
  });

  it('pressing Escape closes the menu', async () => {
    render(<UserMenu username="alice" onSignOut={vi.fn()} balance={{ credits: 10, diem: 500 }} />);
    const toggle = screen.getByRole('button', { name: 'alice' });
    await userEvent.click(toggle);
    expect(screen.queryByRole('menu', { name: /user menu/i })).toBeInTheDocument();

    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('menu', { name: /user menu/i })).not.toBeInTheDocument();
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
  });

  it('clicking outside closes the menu', async () => {
    render(
      <div>
        <button type="button" data-testid="outside">
          Outside
        </button>
        <UserMenu username="alice" onSignOut={vi.fn()} balance={{ credits: 10, diem: 500 }} />
      </div>,
    );
    const toggle = screen.getByRole('button', { name: 'alice' });
    await userEvent.click(toggle);
    expect(screen.queryByRole('menu', { name: /user menu/i })).toBeInTheDocument();

    const outside = screen.getByTestId('outside');
    await userEvent.click(outside);
    expect(screen.queryByRole('menu', { name: /user menu/i })).not.toBeInTheDocument();
  });

  it('clicking Sign out fires the onSignOut callback', async () => {
    const onSignOut = vi.fn();
    render(
      <UserMenu username="alice" onSignOut={onSignOut} balance={{ credits: 10, diem: 500 }} />,
    );
    const toggle = screen.getByRole('button', { name: 'alice' });
    await userEvent.click(toggle);

    const signOut = screen.getByRole('menuitem', { name: /sign out/i });
    await userEvent.click(signOut);
    expect(onSignOut).toHaveBeenCalledTimes(1);
  });

  it('clicking Settings fires onOpenSettings if provided', async () => {
    const onOpenSettings = vi.fn();
    render(
      <UserMenu
        username="alice"
        onSignOut={vi.fn()}
        balance={null}
        onOpenSettings={onOpenSettings}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'alice' }));
    await userEvent.click(screen.getByRole('menuitem', { name: /^settings$/i }));
    expect(onOpenSettings).toHaveBeenCalledTimes(1);
  });
});
