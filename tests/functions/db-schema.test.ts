import { describe, expect, it, vi } from 'vitest';
import { createSqliteD1 } from '../../dev/sqliteD1';
import { ensureEnrolmentSchema, ensureOAuthSchema, ensureSchema } from '../../functions/_lib/db';
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

  it('creates its tables once per database: later calls make no round trip', async () => {
    const db = createSqliteD1();
    const seen: string[] = [];
    const spy: D1Like = { ...db, prepare: (sql: string) => (seen.push(sql), db.prepare(sql)) } as D1Like;
    await ensureSchema(spy);
    const first = seen.length;
    expect(first).toBeGreaterThan(0);
    await ensureSchema(spy);
    await ensureEnrolmentSchema(spy);
    const withEnrolments = seen.length;
    await ensureEnrolmentSchema(spy);
    expect(seen.length).toBe(withEnrolments);
    expect(withEnrolments).toBe(first + 1);
  });

  it('creates the OAuth tables once per database', async () => {
    const db = createSqliteD1();
    const seen: string[] = [];
    const spy: D1Like = { ...db, prepare: (sql: string) => (seen.push(sql), db.prepare(sql)) } as D1Like;
    await ensureOAuthSchema(spy);
    const first = seen.length;
    await ensureOAuthSchema(spy);
    expect(first).toBe(3);
    expect(seen).toHaveLength(first);
    expect(await tableExists(db, 'oauth_tokens')).toBe(true);
  });

  it('a failed create is tried again on the next call', async () => {
    const db = createSqliteD1();
    let fail = true;
    const flaky: D1Like = {
      ...db,
      prepare: (sql: string) =>
        fail && sql.includes('TABLE IF NOT EXISTS sessions')
          ? ({ ...db.prepare('SELECT 1'), run: async () => { throw new Error('broker down'); } } as ReturnType<D1Like['prepare']>)
          : db.prepare(sql),
    } as D1Like;
    await expect(ensureSchema(flaky)).rejects.toThrow('broker down');
    fail = false;
    await ensureSchema(flaky);
    expect(await tableExists(db, 'sessions')).toBe(true);
  });

  it('a refused drop is logged, marked done for this isolate, and never fails ensureSchema', async () => {
    const db = createSqliteD1();
    let drops = 0;
    const refusing: D1Like = {
      ...db,
      prepare: (sql: string) => {
        if (sql.startsWith('DROP TABLE')) {
          drops++;
          return { ...db.prepare('SELECT 1'), run: async () => { throw new Error('DROP command denied to user'); } } as ReturnType<D1Like['prepare']>;
        }
        return db.prepare(sql);
      },
    } as D1Like;
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    await expect(ensureSchema(refusing)).resolves.toBeUndefined();
    expect(await tableExists(db, 'sessions')).toBe(true);
    expect(log).toHaveBeenCalledWith('mcp_records drop failed', 'DROP command denied to user');
    await ensureSchema(refusing);
    expect(drops).toBe(1);
    log.mockRestore();
  });
});
