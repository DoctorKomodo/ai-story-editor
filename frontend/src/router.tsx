import { Navigate, Outlet, Route, Routes } from 'react-router-dom';
import { QueryClientProvider, type QueryClient } from '@tanstack/react-query';
import { useInitAuth } from '@/hooks/useAuth';
import { useSessionStore } from '@/store/session';
import { queryClient } from '@/lib/queryClient';
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

export interface AppRouterProps {
  /**
   * Optional QueryClient override. Tests should pass a fresh
   * `createQueryClient()` per render to avoid cross-test cache bleed through
   * the module-level singleton. Production (`App.tsx`) omits the prop and
   * uses the singleton.
   */
  queryClient?: QueryClient;
}

export function AppRouter({ queryClient: clientOverride }: AppRouterProps = {}): JSX.Element {
  useInitAuth();
  // TanStack Query lives here (rather than higher up in App.tsx) so tests that
  // mount <AppRouter /> directly under <MemoryRouter> automatically get the
  // query cache without having to wrap every render site.
  const client = clientOverride ?? queryClient;
  return (
    <QueryClientProvider client={client}>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/register" element={<RegisterPage />} />
        <Route element={<RequireAuth />}>
          <Route path="/" element={<DashboardPage />} />
          <Route path="/stories/:id" element={<EditorPage />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </QueryClientProvider>
  );
}
