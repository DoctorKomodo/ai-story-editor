import { type QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { JSX } from 'react';
import { lazy, Suspense } from 'react';
import { Navigate, Outlet, Route, Routes } from 'react-router-dom';
import { ThemeApply } from '@/components/ThemeApply';
import { useInitAuth } from '@/hooks/useAuth';
import { useUserSettingsQuery } from '@/hooks/useUserSettings';
import { isDebugMode } from '@/lib/debug';
import { queryClient } from '@/lib/queryClient';
import { DashboardPage } from '@/pages/DashboardPage';
import { EditorPage } from '@/pages/EditorPage';
import { LoginPage } from '@/pages/LoginPage';
import { RegisterPage } from '@/pages/RegisterPage';
import { ResetPasswordPage } from '@/pages/ResetPasswordPage';
import { useSessionStore } from '@/store/session';

// Build-time gate: in prod builds (`vite build`), `import.meta.env.PROD` is
// the literal `true`, so this expression dead-code-eliminates the dynamic
// import entirely and the Devtools package is excluded from the bundle.
// In dev builds it resolves to a lazy component; runtime `isDebugMode()`
// decides whether to mount it. Trade-off: this disables the localStorage
// opt-in for *prod* builds (you can no longer flip Devtools on in a deployed
// prod build via `localStorage['inkwell:debug']='1'`). That feature was
// speculative; correct prod-bundle exclusion is non-speculative.
const ReactQueryDevtoolsLazy = import.meta.env.PROD
  ? null
  : lazy(() =>
      import('@tanstack/react-query-devtools').then((m) => ({
        default: m.ReactQueryDevtools,
      })),
    );

/**
 * Side-effect-only component that triggers the user-settings query as soon
 * as the user is authenticated, so the first render of editor / settings
 * surfaces uses backend data instead of `DEFAULT_SETTINGS`. Mounted as a
 * sibling of `<Routes>` inside the `<QueryClientProvider>`.
 */
function SettingsWarmup(): null {
  const status = useSessionStore((s) => s.status);
  useUserSettingsQuery({ enabled: status === 'authenticated' });
  return null;
}

function RequireAuth(): JSX.Element {
  const status = useSessionStore((s) => s.status);

  if (status === 'idle' || status === 'loading') {
    return (
      <div
        role="status"
        aria-live="polite"
        className="min-h-screen flex items-center justify-center"
      >
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
      <SettingsWarmup />
      <ThemeApply />
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/register" element={<RegisterPage />} />
        <Route path="/reset-password" element={<ResetPasswordPage />} />
        <Route element={<RequireAuth />}>
          <Route path="/" element={<DashboardPage />} />
          <Route path="/stories/:id" element={<EditorPage />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      {ReactQueryDevtoolsLazy && isDebugMode() ? (
        <Suspense fallback={null}>
          <ReactQueryDevtoolsLazy initialIsOpen={false} />
        </Suspense>
      ) : null}
    </QueryClientProvider>
  );
}
