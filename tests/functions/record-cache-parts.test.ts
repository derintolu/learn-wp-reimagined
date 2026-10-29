import { describe, expect, it } from 'vitest';
import { createSqliteD1 } from '../../dev/sqliteD1';
import type { Env } from '../../functions/_lib/env';
import { invalidateRecordCache, readCachedRecord, writeCachedRecord, RECORD_CACHE_TTL_MS } from '../../functions/_lib/record/read';

/** A D1 over SQLite that refuses any statement over 65,536 bytes (text plus bound values), like Spacefast's broker. */
function brokerLimited(real: Env['DB'], log: { max: number }): Env['DB'] {
  const wrap = (sql: string, v: unknown[]) => {
    const check = () => {
      const n = Buffer.byteLength(sql) + v.reduce<number>((a, x) => a + (typeof x === 'string' ? Buffer.byteLength(x) : 8), 0);
      log.max = Math.max(log.max, n);
      if (n > 65_536) throw new Error(`Database operation is ${n} bytes; the limit is 65536.`);
    };
    const q = real.prepare(sql).bind(...v);
    return { bind: (...nv: unknown[]) => wrap(sql, nv), run: async () => (check(), q.run()), first: async () => (check(), q.first()), all: async () => (check(), q.all()) };
  };
  return { prepare: (sql: string) => wrap(sql, []) } as unknown as Env['DB'];
}

const NOW = Date.UTC(2026, 9, 28, 12);
const projection = (n: number) => JSON.stringify({ items: 'café € '.repeat(n) });

describe('record_cache stores the projection in parts under the broker limit', () => {
  it('round-trips a 200 KB projection', async () => {
    const log = { max: 0 };
    const env = { DB: brokerLimited(createSqliteD1(), log) } as Env;
    const body = projection(30_000);
    expect(Buffer.byteLength(body)).toBeGreaterThan(200_000);
    await writeCachedRecord(env, 'abc', body, NOW);
    expect(log.max).toBeLessThanOrEqual(65_536);
    expect(await readCachedRecord(env, 'abc', NOW + 1000)).toBe(body);
    expect(await readCachedRecord(env, 'abc', NOW + RECORD_CACHE_TTL_MS)).toBeNull();
  });

  it('a rewrite replaces the earlier version, and invalidation removes everything', async () => {
    const env = { DB: createSqliteD1() } as Env;
    await writeCachedRecord(env, 'abc', projection(10_000), NOW);
    await writeCachedRecord(env, 'abc', '{"v":2}', NOW + 10);
    expect(await readCachedRecord(env, 'abc', NOW + 11)).toBe('{"v":2}');
    expect((await env.DB.prepare('SELECT DISTINCT at FROM record_cache_parts').all()).results).toHaveLength(1);
    await invalidateRecordCache(env, 'abc');
    expect(await readCachedRecord(env, 'abc', NOW + 11)).toBeNull();
    expect((await env.DB.prepare('SELECT * FROM record_cache_parts').all()).results).toEqual([]);
  });

  it('a missing or broken body is a cache miss', async () => {
    const env = { DB: createSqliteD1() } as Env;
    await writeCachedRecord(env, 'abc', '{"v":1}', NOW);
    await env.DB.prepare('UPDATE record_cache_parts SET part = ?').bind('{"v":').run();
    expect(await readCachedRecord(env, 'abc', NOW + 1)).toBeNull();
    await env.DB.prepare('DELETE FROM record_cache_parts').run();
    expect(await readCachedRecord(env, 'abc', NOW + 1)).toBeNull();
  });
});
