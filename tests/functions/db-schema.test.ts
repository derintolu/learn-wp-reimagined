import { describe, expect, it } from 'vitest';
import { createSqliteD1 } from '../../dev/sqliteD1';
import { ensureSchema } from '../../functions/_lib/db';
import type { D1Like } from '../../functions/_lib/env';

const tableExists = async (db: D1Like, name: string) => !!(await db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").bind(name).first());

describe('ensureSchema: the relay table goes (Task 52)', () => {
  it('drops mcp_records once per database, and a missing table is fine', async () => {
    const db = createSqliteD1();
    await db.prepare('CREATE TABLE mcp_records (h VARCHAR(64) PRIMARY KEY, body MEDIUMTEXT NOT NULL, ver INT NOT NULL, touched BIGINT NOT NULL)').run();
    await ensureSchema(db);
    expect(await tableExists(db, 'mcp_records')).toBe(false);
    expect(await tableExists(db, 'sessions')).toBe(true);
    const fresh = createSqliteD1();
    await expect(ensureSchema(fresh)).resolves.toBeUndefined();
  });

  it('runs the drop only on the first call for a database', async () => {
    const db = createSqliteD1();
    const seen: string[] = [];
    const spy: D1Like = { ...db, prepare: (sql: string) => (seen.push(sql), db.prepare(sql)) } as D1Like;
    await ensureSchema(spy);
    await ensureSchema(spy);
    expect(seen.filter((s) => s.startsWith('DROP TABLE')).length).toBe(1);
  });
});
