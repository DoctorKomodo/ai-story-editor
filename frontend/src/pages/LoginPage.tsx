import { Navigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { AuthForm } from '@/components/AuthForm';

export function LoginPage(): JSX.Element {
  const { user, login } = useAuth();

  if (user) return <Navigate to="/" replace />;

  return <AuthForm mode="login" onSubmit={login} />;
}
