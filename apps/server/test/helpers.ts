import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { buildServer, type FlexServer } from '../src/app.js';

export interface TestApp {
  server: FlexServer;
  token: string;
  call<T = unknown>(method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE', url: string, body?: unknown, headers?: Record<string, string>): Promise<{ status: number; body: T }>;
  close(): Promise<void>;
}

export type DbTarget = { kind: 'sqlite' } | { kind: 'postgres' | 'mysql'; host: string; port: number; user: string; password: string; database: string; ssl: boolean };

/** Boot a fresh server, configure the DB, and complete setup with sample data. */
export async function createTestApp(db: DbTarget = { kind: 'sqlite' }, businessType = 'cafe'): Promise<TestApp> {
  const dir = mkdtempSync(join(tmpdir(), 'flexpos-test-'));
  const server = await buildServer({ dataDir: dir, webDir: null, workers: false });
  let token = '';
  const call: TestApp['call'] = async (method, url, body, headers = {}) => {
    const res = await server.app.inject({
      method,
      url,
      payload: body === undefined ? undefined : (body as object),
      headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), 'x-register': 'POS-T', ...headers },
    });
    const text = res.body;
    let parsed: unknown = text;
    try {
      parsed = JSON.parse(text);
    } catch {
      /* non-json */
    }
    return { status: res.statusCode, body: parsed as never };
  };
  const dbRes = await call('POST', '/api/setup/db', db.kind === 'sqlite' ? { kind: 'sqlite', file: join(dir, 'test.db') } : db);
  if (dbRes.status !== 200) throw new Error(`db setup failed: ${JSON.stringify(dbRes.body)}`);
  if (db.kind !== 'sqlite') {
    // Shared external databases: wipe previous test data.
    const { TABLE_NAMES } = await import('@flexpos/db');
    for (const t of TABLE_NAMES) await server.ctx.db.deleteFrom(t as never).execute();
  }
  const setup = await call<{ accessToken: string }>('POST', '/api/setup/complete', {
    language: 'th',
    store: { name: 'ร้านทดสอบ', branchName: 'สาขาหลัก', address: '1 ถนนทดสอบ', taxId: '0105561234567', phone: '021234567', promptPayId: '0812345678' },
    businessType,
    tax: { vatEnabled: true, vatRate: 7, pricesIncludeVat: true, serviceChargeRate: 0 },
    owner: { name: 'เจ้าของ ทดสอบ', username: 'owner', password: 'password123', pin: '1234' },
    sampleData: true,
  });
  if (setup.status !== 200) throw new Error(`setup failed: ${JSON.stringify(setup.body)}`);
  token = setup.body.accessToken;
  return {
    server,
    get token() {
      return token;
    },
    call,
    async close() {
      await server.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

export const newId = () => randomUUID();
