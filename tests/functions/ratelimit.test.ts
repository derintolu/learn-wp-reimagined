import { describe, it, expect } from 'vitest';
import { createSqliteD1 } from '../../dev/sqliteD1';
import { ensureSchema } from '../../functions/_lib/db';
import { rateLimit } from '../../functions/_lib/ratelimit';

async function fresh() {
  const db = createSqliteD1();
  await ensureSchema(db);
  return db;
}

describe('rateLimit', () => {
  it('allows 30 calls, blocks the 31st, resets after the window', async () => {
    const db = await fresh();
    const t = 1_000_000;
    for (let i = 0; i < 30; i++) expect(await rateLimit(db, 'ip1', t + i)).toBe(true);
    expect(await rateLimit(db, 'ip1', t + 100)).toBe(false);
    expect(await rateLimit(db, 'ip2', t + 100)).toBe(true);
    expect(await rateLimit(db, 'ip1', t + 600_000)).toBe(true);
  });

  it('concurrent calls never exceed the limit', async () => {
    const db = await fresh();
    const rs = await Promise.all(
      Array.from({ length: 50 }, () => rateLimit(db, 'ip', 5_000)),
    );
    expect(rs.filter(Boolean).length).toBe(30);
  });

  it('handles keys longer than the column', async () => {
    const db = await fresh();
    expect(await rateLimit(db, 'x'.repeat(500), 1)).toBe(true);
  });

  it('rethrows non-duplicate errors on insert', async () => {
    const real = await fresh();
    const bad = {
      prepare(sql: string) {
        if (sql.startsWith('INSERT INTO hits')) {
          const st: any = { bind: () => st, run: async () => { throw new Error('connection reset'); } };
          return st;
        }
        return real.prepare(sql);
      },
    };
    await expect(rateLimit(bad, 'k', 1)).rejects.toThrow('connection reset');
  });
});
