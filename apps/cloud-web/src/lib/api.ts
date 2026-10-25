import { t } from '@flexpos/shared';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
  }
}

export interface User {
  id: string;
  email: string;
  name: string;
  isSuperadmin: boolean;
}

interface Tokens {
  accessToken: string;
  refreshToken: string;
}

const KEY = 'flexpos.cloud.tokens';
const read = (): Tokens | null => {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as Tokens) : null;
  } catch {
    return null;
  }
};

let tokens = read();
const listeners = new Set<() => void>();

export const auth = {
  get accessToken() {
    return tokens?.accessToken ?? null;
  },
  get refreshToken() {
    return tokens?.refreshToken ?? null;
  },
  set(next: Tokens | null) {
    tokens = next;
    try {
      if (next) localStorage.setItem(KEY, JSON.stringify(next));
      else localStorage.removeItem(KEY);
    } catch {
      /* memory only */
    }
    listeners.forEach((l) => l());
  },
  onChange(fn: () => void) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
};

let refreshing: Promise<boolean> | null = null;
async function refresh(): Promise<boolean> {
  if (!tokens?.refreshToken) return false;
  refreshing ??= fetch('/api/auth/refresh', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ refreshToken: tokens.refreshToken }) })
    .then(async (r) => {
      if (!r.ok) {
        auth.set(null);
        return false;
      }
      const b = (await r.json()) as Tokens;
      auth.set({ accessToken: b.accessToken, refreshToken: b.refreshToken });
      return true;
    })
    .catch(() => false)
    .finally(() => (refreshing = null));
  return refreshing;
}

export async function request<T>(method: string, path: string, opts: { body?: unknown; query?: Record<string, string | number | boolean | undefined | null> } = {}, retried = false): Promise<T> {
  const qs = opts.query ? Object.entries(opts.query).filter(([, v]) => v !== undefined && v !== null && v !== '') : [];
  const url = path + (qs.length ? '?' + new URLSearchParams(qs.map(([k, v]) => [k, String(v)])).toString() : '');
  let res: Response;
  try {
    res = await fetch(url, {
      method,
      headers: { ...(opts.body !== undefined ? { 'content-type': 'application/json' } : {}), ...(tokens?.accessToken ? { authorization: `Bearer ${tokens.accessToken}` } : {}) },
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
    });
  } catch {
    throw new ApiError(0, 'network', t('เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ ตรวจสอบอินเทอร์เน็ตแล้วลองใหม่'));
  }
  if (res.status === 401 && !retried && path !== '/api/auth/login' && (await refresh())) return request<T>(method, path, opts, true);
  const text = await res.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    /* not json */
  }
  if (!res.ok) {
    const d = data as { error?: string; message?: string; details?: unknown } | null;
    if (res.status === 401) auth.set(null);
    throw new ApiError(res.status, d?.error ?? 'error', d?.message ?? t('เกิดข้อผิดพลาด ({0})', res.status), d?.details);
  }
  return data as T;
}

export const api = {
  get: <T>(p: string, query?: Record<string, string | number | boolean | undefined | null>) => request<T>('GET', p, { query }),
  post: <T>(p: string, body?: unknown) => request<T>('POST', p, { body: body ?? {} }),
  put: <T>(p: string, body?: unknown) => request<T>('PUT', p, { body: body ?? {} }),
  patch: <T>(p: string, body?: unknown) => request<T>('PATCH', p, { body: body ?? {} }),
  del: <T>(p: string) => request<T>('DELETE', p),
};

export const errorMessage = (e: unknown) => (e instanceof Error ? e.message : String(e));
