import type { JSX } from 'react';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ResetPasswordForm, type ResetPasswordFormValues } from '@/components/ResetPasswordForm';
import { useAuth } from '@/hooks/useAuth';
import { ApiError } from '@/lib/api';

const ERROR_INVALID_CREDS = 'Invalid username, recovery code, or both.';
const ERROR_RATE_LIMITED = 'Too many attempts. Try again in a minute.';
const ERROR_GENERIC = 'Something went wrong. Please try again.';

function mapResetError(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.status === 401) return ERROR_INVALID_CREDS;
    if (err.status === 429) return ERROR_RATE_LIMITED;
    // 400 from Zod surfaces the server's message — useful for debugging
    // genuine bad requests, doesn't leak anything sensitive.
    if (err.status === 400) return err.message || ERROR_GENERIC;
    return ERROR_GENERIC;
  }
  return ERROR_GENERIC;
}

export function ResetPasswordPage(): JSX.Element {
  const { resetPassword } = useAuth();
  const navigate = useNavigate();
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const handleSubmit = async (values: ResetPasswordFormValues): Promise<void> => {
    setErrorMessage(null);
    setPending(true);
    try {
      await resetPassword(values);
      navigate('/login', { replace: true, state: { resetSuccess: true } });
    } catch (err) {
      setErrorMessage(mapResetError(err));
    } finally {
      setPending(false);
    }
  };

  return (
    <ResetPasswordForm onSubmit={handleSubmit} errorMessage={errorMessage} pending={pending} />
  );
}
