import { describe, it, expect } from 'vitest';
import { createSqliteD1 } from '../../dev/sqliteD1';

describe('createSqliteD1', () => {
  it('supports prepare/bind/run/all/first', async () => {
    const db = createSqliteD1();
    await db.prepare('CREATE TABLE t (id INTEGER PRIMARY KEY, name TEXT)').run();
    const ins = await db.prepare('INSERT INTO t (name) VALUES (?)').bind('a').run();
    expect(ins.meta.changes).toBe(1);
    await db.prepare('INSERT INTO t (name) VALUES (?)').bind('b').run();

    const { results } = await db.prepare('SELECT name FROM t ORDER BY id').all<{ name: string }>();
    expect(results).toEqual([{ name: 'a' }, { name: 'b' }]);

    const one = await db.prepare('SELECT name FROM t WHERE name = ?').bind('b').first<{ name: string }>();
    expect(one).toEqual({ name: 'b' });
    const none = await db.prepare('SELECT name FROM t WHERE name = ?').bind('zzz').first();
    expect(none).toBeNull();
  });
});
