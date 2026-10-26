import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api, auth, type User } from './api';

interface SessionValue {
  user: User | null;
  loading: boolean;
  login(username: string, password: string): Promise<void>;
  setUser(u: User): void;
  logout(): Promise<void>;
}

const Ctx = createContext<SessionValue | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(!!auth.accessToken);

  useEffect(() => {
    if (!auth.accessToken) return;
    api
      .get<User>('/api/auth/me')
      .then(setUser)
      .catch(() => setUser(null))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    const off = auth.onChange(() => {
      if (!auth.accessToken) setUser(null);
    });
    return () => void off();
  }, []);

  const login = useCallback(async (username: string, password: string) => {
    const r = await api.post<{ accessToken: string; refreshToken: string; user: User }>('/api/auth/login', { username, password });
    auth.set({ accessToken: r.accessToken, refreshToken: r.refreshToken });
    qc.clear();
    setUser(r.user);
  }, [qc]);

  const logout = useCallback(async () => {
    await api.post('/api/auth/logout', { refreshToken: auth.refreshToken }).catch(() => undefined);
    auth.set(null);
    qc.clear();
    setUser(null);
  }, [qc]);

  return <Ctx.Provider value={{ user, loading, login, logout, setUser }}>{children}</Ctx.Provider>;
}

export function useSession() {
  const v = useContext(Ctx);
  if (!v) throw new Error('SessionProvider missing');
  return v;
}
