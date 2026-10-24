import { describe, expect, it } from 'vitest';
import { connect, migrate, TABLE_NAMES, type ConnectionConfig } from '../src/index.js';

const targets: [string, ConnectionConfig | null][] = [
  ['postgres', process.env.TEST_PG ? { kind: 'postgres', host: '127.0.0.1', port: 54329, user: 'flexpos', password: 'flexpos', database: 'flexpos', ssl: false } : null],
  ['mysql', process.env.TEST_MYSQL ? { kind: 'mysql', host: '127.0.0.1', port: 33069, user: 'flexpos', password: 'flexpos', database: 'flexpos', ssl: false } : null],
];

for (const [name, cfg] of targets) {
  describe.skipIf(!cfg)(`${name} migrations`, () => {
    it('creates all tables, re-runnable, round-trips money and text', async () => {
      const conn = await connect(cfg!);
      await migrate(conn);
      expect(await migrate(conn)).toEqual([]);
      const names = (await conn.db.introspection.getTables()).map((t) => t.name);
      for (const t of TABLE_NAMES) expect(names).toContain(t);
      await conn.db.deleteFrom('sequences').where('id', '=', 't').execute();
      await conn.db.insertInto('sequences').values({ id: 't', value: 9_000_000_000 }).execute();
      const r = await conn.db.selectFrom('sequences').select('value').where('id', '=', 't').executeTakeFirstOrThrow();
      expect(r.value).toBe(9_000_000_000);
      await conn.db.deleteFrom('sequences').where('id', '=', 't').execute();
      await conn.close();
    }, 60_000);
  });
}
