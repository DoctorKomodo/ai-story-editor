import { Navigate, Outlet, Route, Routes } from 'react-router-dom';
import { useInitAuth } from '@/hooks/useAuth';
import { useSessionStore } from '@/store/session';
import { LoginPage } from '@/pages/LoginPage';
import { RegisterPage } from '@/pages/RegisterPage';
import { DashboardPage } from '@/pages/DashboardPage';
import { EditorPage } from '@/pages/EditorPage';

function RequireAuth(): JSX.Element {
  const status = useSessionStore((s) => s.status);

  if (status === 'idle' || status === 'loading') {
    return (
      <div role="status" aria-live="polite" className="min-h-screen flex items-center justify-center">
        Loading…
      </div>
    );
  }
  if (status === 'unauthenticated') {
    return <Navigate to="/login" replace />;
  }
  return <Outlet />;
}

export function AppRouter(): JSX.Element {
  useInitAuth();
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/register" element={<RegisterPage />} />
      <Route element={<RequireAuth />}>
        <Route path="/" element={<DashboardPage />} />
        <Route path="/stories/:id" element={<EditorPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
