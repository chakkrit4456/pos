import Dexie, { type Table } from 'dexie';
import type { Catalog, SaleInput } from '@flexpos/shared';
import { api, ApiError } from './api';

interface OutboxSale {
  id: string;
  payload: SaleInput;
  createdAt: string;
  attempts: number;
  lastError: string;
}
interface CacheRow {
  key: string;
  value: unknown;
  at: string;
}

class OfflineDb extends Dexie {
  outbox!: Table<OutboxSale, string>;
  cache!: Table<CacheRow, string>;
  constructor() {
    super('flexpos');
    this.version(1).stores({ outbox: 'id, createdAt', cache: 'key' });
  }
}

let db: OfflineDb | null = null;
function getDb(): OfflineDb | null {
  if (db) return db;
  try {
    db = new OfflineDb();
    return db;
  } catch {
    return null;
  }
}

export async function cacheCatalog(c: Catalog) {
  try {
    await getDb()?.cache.put({ key: 'catalog', value: c, at: new Date().toISOString() });
  } catch {
    /* storage may be unavailable (private mode) */
  }
}

export async function cachedCatalog(): Promise<Catalog | null> {
  try {
    const r = await getDb()?.cache.get('catalog');
    return (r?.value as Catalog) ?? null;
  } catch {
    return null;
  }
}

export async function queueSale(payload: SaleInput) {
  const d = getDb();
  if (!d) throw new Error('เครื่องนี้บันทึกข้อมูลออฟไลน์ไม่ได้');
  await d.outbox.put({ id: payload.id, payload, createdAt: payload.createdAt ?? new Date().toISOString(), attempts: 0, lastError: '' });
  notify();
}

export async function pendingCount(): Promise<number> {
  try {
    return (await getDb()?.outbox.count()) ?? 0;
  } catch {
    return 0;
  }
}

export async function pendingSales(): Promise<OutboxSale[]> {
  try {
    return (await getDb()?.outbox.orderBy('createdAt').toArray()) ?? [];
  } catch {
    return [];
  }
}

const listeners = new Set<(n: number) => void>();
async function notify() {
  const n = await pendingCount();
  listeners.forEach((l) => l(n));
}
export function onPendingChange(fn: (n: number) => void) {
  listeners.add(fn);
  void notify();
  return () => {
    listeners.delete(fn);
  };
}

let syncing = false;
/** Push queued sales to the server in order. Sales are idempotent by id, so retries are safe. */
export async function syncOutbox(): Promise<{ sent: number; failed: number }> {
  const d = getDb();
  if (!d || syncing) return { sent: 0, failed: 0 };
  syncing = true;
  let sent = 0;
  let failed = 0;
  try {
    const items = await d.outbox.orderBy('createdAt').limit(100).toArray();
    if (!items.length) return { sent, failed };
    const res = await api.post<{ results: { id: string; ok: boolean; error?: string }[] }>('/api/sync/sales', { sales: items.map((i) => i.payload) });
    for (const r of res.results) {
      if (r.ok) {
        await d.outbox.delete(r.id);
        sent++;
      } else {
        failed++;
        const it = items.find((i) => i.id === r.id);
        if (it) await d.outbox.put({ ...it, attempts: it.attempts + 1, lastError: r.error ?? '' });
      }
    }
  } catch (e) {
    if (!(e instanceof ApiError && e.isNetwork)) failed++;
  } finally {
    syncing = false;
    void notify();
  }
  return { sent, failed };
}

export async function discardPending(id: string) {
  await getDb()?.outbox.delete(id);
  void notify();
}

if (typeof window !== 'undefined') {
  setInterval(() => void syncOutbox(), 20_000);
  window.addEventListener('online', () => void syncOutbox());
}
