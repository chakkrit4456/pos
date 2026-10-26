import { generateKeyPairSync } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildCloud, type CloudServer } from '../src/app.js';
import { hashPassword, nowIso, uuid } from '../src/auth.js';

export interface Caller {
  <T = unknown>(method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE', url: string, body?: unknown, token?: string): Promise<{ status: number; body: T }>;
}

/** A throwaway license signing key pair (the real vendor key never appears in tests). */
export function licenseKeys() {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  return { privateKey: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(), publicKey: publicKey.export({ type: 'spki', format: 'pem' }).toString() };
}

export async function createCloud(opts: { licenses?: boolean } = {}): Promise<{ server: CloudServer; call: Caller; keys: ReturnType<typeof licenseKeys>; close(): Promise<void> }> {
  const keys = licenseKeys();
  const dir = mkdtempSync(join(tmpdir(), 'flexpos-cloud-'));
  const server = await buildCloud(
    { port: 0, host: '127.0.0.1', databaseUrl: 'pglite:memory', jwtSecret: 'x'.repeat(40), webDir: null, logFile: null, licensePrivateKey: opts.licenses === false ? null : keys.privateKey, licensePublicKey: keys.publicKey, dataDir: dir },
    { watchers: false },
  );
  const call: Caller = async (method, url, body, token) => {
    const res = await server.app.inject({ method, url, payload: body === undefined ? undefined : (body as object), headers: token ? { authorization: `Bearer ${token}` } : {} });
    let parsed: unknown = res.body;
    try {
      parsed = JSON.parse(res.body);
    } catch {
      /* non-json */
    }
    return { status: res.statusCode, body: parsed as never };
  };
  return {
    server,
    call,
    keys,
    async close() {
      await server.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

export async function addSuperadmin(server: CloudServer, email: string, password: string) {
  await server.ctx.db.insertInto('cloud_users').values({ id: uuid(), email, name: 'Root', password_hash: await hashPassword(password), is_superadmin: 1, disabled: 0, created_at: nowIso(), last_login_at: null }).execute();
}

/** Rows as a POS would push them for one small store with two sales today. */
export function storeRows(storeName: string, today: string) {
  const branch = 'b0000000-0000-0000-0000-000000000001';
  const user = 'u0000000-0000-0000-0000-000000000001';
  const cat = 'c0000000-0000-0000-0000-000000000001';
  const prod = 'p0000000-0000-0000-0000-000000000001';
  const sale = (id: string, total: number) => ({ id, doc_no: `R-${id.slice(-4)}`, type: 'sale', status: 'completed', branch_id: branch, user_id: user, subtotal: total, vatable: total, vat: Math.round((total * 7) / 107), total, cost_total: 2000, paid: total, promotions: '[]', pricing: '{}', note: '', biz_date: today, hour: 10, created_at: `${today}T03:00:00.000Z` });
  const line = (id: string, saleId: string, net: number) => ({ id, sale_id: saleId, product_id: prod, category_id: cat, name: 'ลาเต้', sku: 'L1', qty: 1, base_qty: 1, unit_price: net, gross: net, net, modifiers: '[]', note: '' });
  return {
    settings: { rows: [{ id: 'app', data: JSON.stringify({ store: { name: storeName } }), updated_at: nowIso() }], deleted: [] },
    branches: { rows: [{ id: branch, code: 'HQ', name: 'สาขาหลัก', address: '', phone: '', tax_branch_no: '', active: 1, created_at: nowIso() }], deleted: [] },
    users: { rows: [{ id: user, username: 'owner', name: 'เจ้าของ', password_hash: '$argon2id$secret', pin_hash: 'abc', role_id: 'r1', branch_id: null, active: 1, created_at: nowIso() }], deleted: [] },
    categories: { rows: [{ id: cat, name: 'กาแฟ', color: '#000', sort: 0, active: 1 }], deleted: [] },
    products: { rows: [{ id: prod, sku: 'L1', name: 'ลาเต้', category_id: cat, kind: 'standard', unit: 'แก้ว', price: 6000, cost: 2000, color: '', image: '', custom: '{}', created_at: nowIso(), updated_at: nowIso() }], deleted: [] },
    sales: { rows: [sale('s0000000-0000-0000-0000-000000000001', 6000), sale('s0000000-0000-0000-0000-000000000002', 12000)], deleted: [] },
    sale_lines: { rows: [line('l0000000-0000-0000-0000-000000000001', 's0000000-0000-0000-0000-000000000001', 6000), line('l0000000-0000-0000-0000-000000000002', 's0000000-0000-0000-0000-000000000002', 12000)], deleted: [] },
  };
}

export const ids = { product: 'p0000000-0000-0000-0000-000000000001' };
