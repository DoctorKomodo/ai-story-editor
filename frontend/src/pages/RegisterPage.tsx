import { Navigate } from 'react-router-dom';
import { AuthForm } from '@/components/AuthForm';
import { useAuth } from '@/hooks/useAuth';

export function RegisterPage(): JSX.Element {
  const { user, register } = useAuth();

  if (user) return <Navigate to="/" replace />;

  return <AuthForm mode="register" onSubmit={register} />;
}
