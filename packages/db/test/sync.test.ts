import { describe, expect, it } from 'vitest';
import { connect, dropSyncTriggers, enqueueAll, installSyncTriggers, migrate, SYNC_TABLES } from '../src/index.js';

describe('sync change capture (sqlite)', () => {
  it('records insert/update/delete only while triggers are installed', async () => {
    const conn = await connect({ kind: 'sqlite', file: ':memory:' });
    await migrate(conn);
    const db = conn.db;
    const outbox = () => db.selectFrom('sync_outbox').select(['tbl', 'row_id']).orderBy('seq').execute();
    const cat = { id: 'c1', parent_id: null, name: 'A', color: '', sort: 0, station: null, active: 1 };

    await db.insertInto('categories').values(cat).execute();
    expect(await outbox()).toEqual([]);

    await installSyncTriggers(conn);
    await installSyncTriggers(conn); // idempotent
    await db.updateTable('categories').set({ name: 'B' }).where('id', '=', 'c1').execute();
    await db.insertInto('categories').values({ ...cat, id: 'c2' }).execute();
    await db.deleteFrom('categories').where('id', '=', 'c1').execute();
    await db.insertInto('sequences').values({ id: 's', value: 1 }).execute(); // local-only table
    expect(await outbox()).toEqual([
      { tbl: 'categories', row_id: 'c1' },
      { tbl: 'categories', row_id: 'c2' },
      { tbl: 'categories', row_id: 'c1' },
    ]);

    await db.deleteFrom('sync_outbox').execute();
    await enqueueAll(conn);
    expect(await outbox()).toEqual([{ tbl: 'categories', row_id: 'c2' }]);

    await dropSyncTriggers(conn);
    await db.insertInto('categories').values({ ...cat, id: 'c3' }).execute();
    expect((await outbox()).length).toBe(1);
    expect(SYNC_TABLES).not.toContain('refresh_tokens');
    await conn.close();
  });
});
