import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type React from 'react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { ResetPasswordForm } from '@/components/ResetPasswordForm';

describe('<ResetPasswordForm>', () => {
  function setup(overrides: Partial<React.ComponentProps<typeof ResetPasswordForm>> = {}) {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(
      <MemoryRouter>
        <ResetPasswordForm onSubmit={onSubmit} {...overrides} />
      </MemoryRouter>,
    );
    return { onSubmit };
  }

  it('renders the four required fields and the submit button', () => {
    setup();
    expect(screen.getByRole('heading', { name: /reset your password/i })).toBeInTheDocument();
    expect(screen.getByLabelText(/^username$/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/recovery code/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/^new password$/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/confirm new password/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /reset password/i })).toBeInTheDocument();
  });

  it('disables submit until all fields are valid', async () => {
    const user = userEvent.setup();
    const { onSubmit } = setup();

    const submit = screen.getByRole('button', { name: /reset password/i });
    expect(submit).toBeDisabled();

    await user.type(screen.getByLabelText(/^username$/i), 'alice');
    expect(submit).toBeDisabled();
    await user.type(screen.getByLabelText(/recovery code/i), 'horse-battery-staple');
    expect(submit).toBeDisabled();
    await user.type(screen.getByLabelText(/^new password$/i), 'hunter2hunter2');
    expect(submit).toBeDisabled();
    await user.type(screen.getByLabelText(/confirm new password/i), 'hunter2hunter2');
    expect(submit).not.toBeDisabled();

    await user.click(submit);
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it('shows "Passwords do not match" when confirm differs from newPassword', async () => {
    const user = userEvent.setup();
    setup();

    await user.type(screen.getByLabelText(/^username$/i), 'alice');
    await user.type(screen.getByLabelText(/recovery code/i), 'horse-battery-staple');
    await user.type(screen.getByLabelText(/^new password$/i), 'hunter2hunter2');
    await user.type(screen.getByLabelText(/confirm new password/i), 'different');
    await user.tab();

    expect(screen.getByText(/passwords do not match/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /reset password/i })).toBeDisabled();
  });

  it('rejects a username that violates /^[a-z0-9_-]{3,32}$/', async () => {
    const user = userEvent.setup();
    setup();

    await user.type(screen.getByLabelText(/^username$/i), 'BadName!');
    await user.tab();

    const usernameInput = screen.getByLabelText(/^username$/i);
    expect(usernameInput).toHaveAttribute('aria-invalid', 'true');
  });

  it('rejects a new password shorter than 8 characters', async () => {
    const user = userEvent.setup();
    setup();

    await user.type(screen.getByLabelText(/^new password$/i), 'short');
    await user.tab();

    const pwInput = screen.getByLabelText(/^new password$/i);
    expect(pwInput).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByText(/at least 8/i)).toBeInTheDocument();
  });

  it('collapses whitespace and trims the recovery code before passing it to onSubmit', async () => {
    const user = userEvent.setup();
    const { onSubmit } = setup();

    await user.type(screen.getByLabelText(/^username$/i), 'alice');
    // userEvent.type doesn't insert literal newlines — paste instead.
    await user.click(screen.getByLabelText(/recovery code/i));
    await user.paste('  horse-battery\n  staple   correct  \n');
    await user.type(screen.getByLabelText(/^new password$/i), 'hunter2hunter2');
    await user.type(screen.getByLabelText(/confirm new password/i), 'hunter2hunter2');
    await user.click(screen.getByRole('button', { name: /reset password/i }));

    expect(onSubmit).toHaveBeenCalledWith({
      username: 'alice',
      recoveryCode: 'horse-battery staple correct',
      newPassword: 'hunter2hunter2',
    });
  });

  it('lowercases and trims the username before passing it to onSubmit', async () => {
    const user = userEvent.setup();
    const { onSubmit } = setup();

    await user.type(screen.getByLabelText(/^username$/i), '  Alice  ');
    await user.tab();
    await user.type(screen.getByLabelText(/recovery code/i), 'horse-battery-staple');
    await user.type(screen.getByLabelText(/^new password$/i), 'hunter2hunter2');
    await user.type(screen.getByLabelText(/confirm new password/i), 'hunter2hunter2');
    await user.click(screen.getByRole('button', { name: /reset password/i }));

    expect(onSubmit).toHaveBeenCalledWith({
      username: 'alice',
      recoveryCode: 'horse-battery-staple',
      newPassword: 'hunter2hunter2',
    });
  });

  it('renders a server error passed via the errorMessage prop', () => {
    setup({ errorMessage: 'Invalid username, recovery code, or both.' });
    expect(screen.getByRole('alert')).toHaveTextContent(/invalid username, recovery code/i);
  });

  it('shows the pending label while pending=true and disables submit', () => {
    setup({ pending: true });
    const submit = screen.getByRole('button', { name: /resetting/i });
    expect(submit).toBeDisabled();
  });
});
