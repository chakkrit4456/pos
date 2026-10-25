import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const store = new Map<string, string>();
beforeEach(() => {
  store.clear();
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  });
});

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe('token refresh across tabs', () => {
  it('adopts tokens another tab rotated instead of logging out', async () => {
    store.set('flexpos.tokens', JSON.stringify({ accessToken: 'a1', refreshToken: 'r1' }));
    const { api, auth } = await import('./api');
    // another tab refreshed first: r1 is now revoked, a2/r2 are current
    store.set('flexpos.tokens', JSON.stringify({ accessToken: 'a2', refreshToken: 'r2' }));
    vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
      if (url === '/api/auth/refresh') return json(401, { error: 'unauthorized' });
      const h = init.headers as Record<string, string>;
      return h.authorization === 'Bearer a2' ? json(200, { ok: true }) : json(401, { error: 'unauthorized' });
    });
    await expect(api.get('/api/me')).resolves.toEqual({ ok: true });
    expect(auth.refreshToken).toBe('r2');
    expect(store.has('flexpos.tokens')).toBe(true);
  });

  it('still logs out when the refresh token is really invalid', async () => {
    store.set('flexpos.tokens', JSON.stringify({ accessToken: 'a1', refreshToken: 'r1' }));
    const { api, auth } = await import('./api');
    vi.stubGlobal('fetch', async () => json(401, { error: 'unauthorized' }));
    await expect(api.get('/api/me')).rejects.toMatchObject({ status: 401 });
    expect(auth.accessToken).toBeNull();
    expect(store.has('flexpos.tokens')).toBe(false);
  });
});
