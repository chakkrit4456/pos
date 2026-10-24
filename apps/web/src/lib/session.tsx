import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { AuthResponse, Permission, SessionUser } from '@flexpos/shared';
import { api, auth } from './api';

interface SessionValue {
  user: SessionUser | null;
  loading: boolean;
  locked: boolean;
  login(username: string, password: string): Promise<void>;
  loginPin(pin: string): Promise<void>;
  accept(r: AuthResponse): void;
  logout(): Promise<void>;
  lock(): void;
  can(p: Permission): boolean;
}

const Ctx = createContext<SessionValue | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [loading, setLoading] = useState(!!auth.accessToken);
  const [locked, setLocked] = useState(false);
  const qc = useQueryClient();

  useEffect(() => {
    if (!auth.accessToken) return;
    api
      .get<SessionUser>('/api/auth/me')
      .then(setUser)
      .catch(() => auth.set(null))
      .finally(() => setLoading(false));
  }, []);

  useEffect(
    () =>
      auth.onChange(() => {
        if (!auth.accessToken) setUser(null);
      }),
    [],
  );

  const accept = useCallback(
    (r: AuthResponse) => {
      auth.set({ accessToken: r.accessToken, refreshToken: r.refreshToken });
      setUser(r.user);
      setLocked(false);
      qc.invalidateQueries();
    },
    [qc],
  );

  const value = useMemo<SessionValue>(
    () => ({
      user,
      loading,
      locked,
      async login(username, password) {
        accept(await api.post<AuthResponse>('/api/auth/login', { username, password }));
      },
      async loginPin(pin) {
        accept(await api.post<AuthResponse>('/api/auth/pin', { pin }));
      },
      accept,
      async logout() {
        const rt = auth.refreshToken;
        auth.set(null);
        setUser(null);
        setLocked(false);
        qc.clear();
        if (rt) await api.post('/api/auth/logout', { refreshToken: rt }).catch(() => undefined);
      },
      lock() {
        setLocked(true);
      },
      can(p) {
        return !!user?.permissions.includes(p);
      },
    }),
    [user, loading, locked, accept, qc],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useSession(): SessionValue {
  const v = useContext(Ctx);
  if (!v) throw new Error('useSession outside provider');
  return v;
}
