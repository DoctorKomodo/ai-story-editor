import { Navigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { AuthForm } from '@/components/AuthForm';

export function RegisterPage(): JSX.Element {
  const { user, register } = useAuth();

  if (user) return <Navigate to="/" replace />;

  return <AuthForm mode="register" onSubmit={register} />;
}
