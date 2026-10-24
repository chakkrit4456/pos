import { describe, expect, it } from 'vitest';
import { connect, migrate, TABLE_NAMES } from '../src/index.js';

describe('sqlite migrations', () => {
  it('creates all tables and is re-runnable', async () => {
    const conn = await connect({ kind: 'sqlite', file: ':memory:' });
    const applied = await migrate(conn);
    expect(applied).toContain('0001_initial');
    expect(await migrate(conn)).toEqual([]);
    const tables = await conn.db.introspection.getTables();
    const names = tables.map((t) => t.name);
    for (const t of TABLE_NAMES) expect(names).toContain(t);
    await conn.close();
  });
});
