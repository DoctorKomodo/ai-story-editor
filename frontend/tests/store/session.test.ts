import { afterEach, describe, expect, it } from 'vitest';
import { handleUnauthorizedAccess, useSessionStore } from '@/store/session';

afterEach(() => {
  useSessionStore.getState().clearSession();
});

describe('useSessionStore.clearSession', () => {
  it('clearSession({ expired: true }) sets sessionExpired flag', () => {
    useSessionStore.setState({
      user: { id: 'a', username: 'a', name: 'A' },
      status: 'authenticated',
      sessionExpired: false,
    });

    useSessionStore.getState().clearSession({ expired: true });

    expect(useSessionStore.getState().sessionExpired).toBe(true);
    expect(useSessionStore.getState().user).toBeNull();
    expect(useSessionStore.getState().status).toBe('unauthenticated');
  });

  it('clearSession() defaults sessionExpired to false', () => {
    useSessionStore.setState({
      user: { id: 'a', username: 'a', name: 'A' },
      status: 'authenticated',
      sessionExpired: true,
    });

    useSessionStore.getState().clearSession();

    expect(useSessionStore.getState().sessionExpired).toBe(false);
    expect(useSessionStore.getState().user).toBeNull();
    expect(useSessionStore.getState().status).toBe('unauthenticated');
  });

  it('clearSession({ expired: false }) explicitly keeps sessionExpired false', () => {
    useSessionStore.setState({
      user: { id: 'a', username: 'a', name: 'A' },
      status: 'authenticated',
      sessionExpired: true,
    });

    useSessionStore.getState().clearSession({ expired: false });

    expect(useSessionStore.getState().sessionExpired).toBe(false);
  });
});

describe('handleUnauthorizedAccess', () => {
  it('does NOT set sessionExpired when status is not authenticated (login-401 guard)', () => {
    useSessionStore.setState({
      user: null,
      status: 'unauthenticated',
      sessionExpired: false,
    });

    handleUnauthorizedAccess();

    expect(useSessionStore.getState().sessionExpired).toBe(false);
    expect(useSessionStore.getState().status).toBe('unauthenticated');
  });

  it('does NOT set sessionExpired when status is idle', () => {
    useSessionStore.setState({ user: null, status: 'idle', sessionExpired: false });

    handleUnauthorizedAccess();

    expect(useSessionStore.getState().sessionExpired).toBe(false);
  });

  it('does NOT set sessionExpired when status is loading (cold-boot /auth/me guard)', () => {
    useSessionStore.setState({ user: null, status: 'loading', sessionExpired: false });

    handleUnauthorizedAccess();

    expect(useSessionStore.getState().sessionExpired).toBe(false);
  });

  it('sets sessionExpired and clears session when status is authenticated (mid-session 401)', () => {
    useSessionStore.setState({
      user: { id: 'u1', username: 'alice', name: 'Alice' },
      status: 'authenticated',
      sessionExpired: false,
    });

    handleUnauthorizedAccess();

    expect(useSessionStore.getState().sessionExpired).toBe(true);
    expect(useSessionStore.getState().user).toBeNull();
    expect(useSessionStore.getState().status).toBe('unauthenticated');
  });
});
