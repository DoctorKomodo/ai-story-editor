import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { AuthForm } from '@/components/AuthForm';

describe('AuthForm register', () => {
  it('register: requires a Display name field', () => {
    render(
      <MemoryRouter>
        <AuthForm mode="register" onSubmit={vi.fn()} />
      </MemoryRouter>,
    );
    expect(screen.getByLabelText(/display name/i)).toBeInTheDocument();
  });

  it('register: blocks submit until display name, username, and password are valid', async () => {
    const onSubmit = vi.fn();
    render(
      <MemoryRouter>
        <AuthForm mode="register" onSubmit={onSubmit} />
      </MemoryRouter>,
    );
    const submit = screen.getByRole('button', { name: /create account/i });
    expect(submit).toBeDisabled();

    await userEvent.type(screen.getByLabelText(/username/i), 'someuser');
    await userEvent.type(screen.getByLabelText(/^password$/i), 'pw-long-enough');
    expect(submit).toBeDisabled(); // still disabled — display name missing

    await userEvent.type(screen.getByLabelText(/display name/i), 'Display Name');
    expect(submit).toBeEnabled();
  });

  it('register: submits trimmed display name', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(
      <MemoryRouter>
        <AuthForm mode="register" onSubmit={onSubmit} />
      </MemoryRouter>,
    );
    await userEvent.type(screen.getByLabelText(/display name/i), '   Trimmed   ');
    await userEvent.type(screen.getByLabelText(/username/i), 'someuser');
    await userEvent.type(screen.getByLabelText(/^password$/i), 'pw-long-enough');
    await userEvent.click(screen.getByRole('button', { name: /create account/i }));
    expect(onSubmit).toHaveBeenCalledWith({
      name: 'Trimmed',
      username: 'someuser',
      password: 'pw-long-enough',
    });
  });
});

describe('AuthForm login', () => {
  it('login: does not render Display name field', () => {
    render(
      <MemoryRouter>
        <AuthForm mode="login" onSubmit={vi.fn()} />
      </MemoryRouter>,
    );
    expect(screen.queryByLabelText(/display name/i)).not.toBeInTheDocument();
  });
});

describe('AuthForm footer', () => {
  it('shows the real app version and not the old hardcoded footer', () => {
    render(
      <MemoryRouter>
        <AuthForm mode="login" onSubmit={vi.fn()} />
      </MemoryRouter>,
    );
    expect(screen.getByText(/^v\d+\.\d+\.\d+/)).toBeInTheDocument();
    expect(screen.queryByText(/Self-hosted/)).not.toBeInTheDocument();
    expect(screen.queryByText(/inkwell-01/)).not.toBeInTheDocument();
  });
});
