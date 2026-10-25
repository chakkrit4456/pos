import type { AuthResponse } from '@flexpos/shared';
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
  get isNetwork() {
    return this.status === 0;
  }
}

const TOKENS_KEY = 'flexpos.tokens';

interface Tokens {
  accessToken: string;
  refreshToken: string;
}

function readTokens(): Tokens | null {
  try {
    const raw = localStorage.getItem(TOKENS_KEY);
    return raw ? (JSON.parse(raw) as Tokens) : null;
  } catch {
    return null;
  }
}

let tokens: Tokens | null = readTokens();
const listeners = new Set<() => void>();

// Other tabs/windows rotate the shared refresh token; follow their updates instead of holding a stale copy.
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (e) => {
    if (e.key !== TOKENS_KEY) return;
    tokens = readTokens();
    listeners.forEach((l) => l());
  });
}

export const auth = {
  get accessToken() {
    return tokens?.accessToken ?? null;
  },
  set(t: Tokens | null) {
    tokens = t;
    try {
      if (t) localStorage.setItem(TOKENS_KEY, JSON.stringify(t));
      else localStorage.removeItem(TOKENS_KEY);
    } catch {
      /* storage unavailable: keep in memory */
    }
    listeners.forEach((l) => l());
  },
  onChange(fn: () => void) {
    listeners.add(fn);
    return () => {
      listeners.delete(fn);
    };
  },
  get refreshToken() {
    return tokens?.refreshToken ?? null;
  },
};

/** Per-device register name, used to scope shifts to a till. */
export function registerName(): string {
  try {
    return localStorage.getItem('flexpos.register') || 'POS-1';
  } catch {
    return 'POS-1';
  }
}
export function setRegisterName(name: string) {
  try {
    localStorage.setItem('flexpos.register', name.trim() || 'POS-1');
  } catch {
    /* ignore */
  }
}
export function branchHeader(): string | null {
  try {
    return localStorage.getItem('flexpos.branch');
  } catch {
    return null;
  }
}
export function setBranchHeader(id: string | null) {
  try {
    if (id) localStorage.setItem('flexpos.branch', id);
    else localStorage.removeItem('flexpos.branch');
  } catch {
    /* ignore */
  }
}

let refreshing: Promise<boolean> | null = null;
async function refresh(): Promise<boolean> {
  const stored = readTokens();
  if (stored && stored.accessToken !== tokens?.accessToken) {
    tokens = stored;
    return true;
  }
  const rt = auth.refreshToken;
  if (!rt) return false;
  refreshing ??= (async () => {
    try {
      const res = await fetch('/api/auth/refresh', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ refreshToken: rt }),
      });
      if (!res.ok) {
        // Another tab may have rotated the token first: adopt its newer pair rather than logging everyone out.
        const latest = readTokens();
        if (latest && latest.refreshToken !== rt) {
          tokens = latest;
          return true;
        }
        auth.set(null);
        return false;
      }
      const data = (await res.json()) as AuthResponse;
      auth.set({ accessToken: data.accessToken, refreshToken: data.refreshToken });
      return true;
    } catch {
      return false;
    } finally {
      setTimeout(() => (refreshing = null), 0);
    }
  })();
  return refreshing;
}

export interface RequestOptions {
  method?: string;
  body?: unknown;
  query?: Record<string, string | number | boolean | null | undefined>;
  form?: FormData;
  raw?: boolean;
  signal?: AbortSignal;
}

function buildUrl(path: string, query?: RequestOptions['query']) {
  if (!query) return path;
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) if (v !== undefined && v !== null && v !== '') p.set(k, String(v));
  const s = p.toString();
  return s ? `${path}?${s}` : path;
}

export async function request<T>(path: string, opts: RequestOptions = {}, retried = false): Promise<T> {
  const headers: Record<string, string> = { 'x-register': registerName() };
  const b = branchHeader();
  if (b) headers['x-branch-id'] = b;
  if (auth.accessToken) headers.authorization = `Bearer ${auth.accessToken}`;
  let body: BodyInit | undefined;
  if (opts.form) body = opts.form;
  else if (opts.body !== undefined) {
    headers['content-type'] = 'application/json';
    body = JSON.stringify(opts.body);
  }
  let res: Response;
  try {
    res = await fetch(buildUrl(path, opts.query), { method: opts.method ?? (body ? 'POST' : 'GET'), headers, body, signal: opts.signal });
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw e;
    throw new ApiError(0, 'network', t('เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ ตรวจสอบเครือข่ายหรือว่าเครื่อง Host เปิดอยู่'));
  }
  if (res.status === 401 && !retried && auth.refreshToken && !path.startsWith('/api/auth/')) {
    if (await refresh()) return request<T>(path, opts, true);
  }
  if (!res.ok) {
    let msg = t('เกิดข้อผิดพลาด ({0})', res.status);
    let code = 'error';
    let details: unknown;
    try {
      const j = (await res.json()) as { message?: string; error?: string; details?: unknown };
      msg = j.message ?? msg;
      code = j.error ?? code;
      details = j.details;
    } catch {
      /* not json */
    }
    if (res.status === 401 && !path.startsWith('/api/auth/')) auth.set(null);
    throw new ApiError(res.status, code, msg, details);
  }
  if (opts.raw) return res as unknown as T;
  if (res.status === 204) return undefined as T;
  const ct = res.headers.get('content-type') ?? '';
  return (ct.includes('application/json') ? await res.json() : await res.text()) as T;
}

export const api = {
  get: <T>(path: string, query?: RequestOptions['query']) => request<T>(path, { query }),
  post: <T>(path: string, body?: unknown, query?: RequestOptions['query']) => request<T>(path, { method: 'POST', body: body ?? {}, query }),
  put: <T>(path: string, body?: unknown) => request<T>(path, { method: 'PUT', body: body ?? {} }),
  patch: <T>(path: string, body?: unknown) => request<T>(path, { method: 'PATCH', body: body ?? {} }),
  del: <T>(path: string) => request<T>(path, { method: 'DELETE' }),
  upload: <T>(path: string, file: File, query?: RequestOptions['query']) => {
    const form = new FormData();
    form.append('file', file);
    return request<T>(path, { method: 'POST', form, query });
  },
  /** Download a file response (export) and save it with the server-provided name. */
  async download(path: string, query?: RequestOptions['query'], fallbackName = 'download') {
    const res = await request<Response>(path, { query, raw: true });
    const cd = res.headers.get('content-disposition') ?? '';
    const name = /filename="([^"]+)"/.exec(cd)?.[1] ?? fallbackName;
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  },
};

export function errorMessage(e: unknown): string {
  if (e instanceof ApiError) return e.message;
  if (e instanceof Error) return e.message;
  return t('เกิดข้อผิดพลาด กรุณาลองใหม่');
}
