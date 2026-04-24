import { Navigate } from 'react-router-dom';
import { AuthForm } from '@/components/AuthForm';
import { useAuth } from '@/hooks/useAuth';

export function LoginPage(): JSX.Element {
  const { user, login } = useAuth();

  if (user) return <Navigate to="/" replace />;

  return <AuthForm mode="login" onSubmit={login} />;
}
