import { afterEach, describe, expect, it } from 'vitest';
import { useSessionStore } from '@/store/session';

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
