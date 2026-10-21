import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createSqliteD1 } from '../../dev/sqliteD1';
import {
  D1RecordStore,
  MCP_TTL_MS,
  RECORD_MAX_CHARS,
  ensureMcpSchema,
  handleKey,
  sweepExpired,
} from '../../functions/_lib/mcp/recordStore';
import { GET as sweep } from '../../functions/api/mcp-sweep';
import { StoreConflictError, StoreError, newHandle, newRecord, type LearningRecord } from '../../vendor/learning-mcp/core/index.ts';
import type { D1Like, Env } from '../../functions/_lib/env';

let db: D1Like;
let t: number;
const now = () => t;
const rec = (n = 0): LearningRecord => {
  const r = newRecord({ now: () => '2026-10-20T12:00:00.000Z', uuid: () => '00000000-0000-4000-8000-000000000001' });
  return { ...r, createdAt: `2026-10-20T12:00:0${n}.000Z` };
};
const row = (h: string) => db.prepare('SELECT * FROM mcp_records WHERE h = ?').bind(h).first<{ h: string; body: string; ver: number; touched: number }>();

beforeEach(async () => {
  db = createSqliteD1();
  t = Date.parse('2026-10-20T12:00:00Z');
  await ensureMcpSchema(db);
});

describe('D1RecordStore', () => {
  it('round-trips a record; the key is the handle hash and the row never contains the handle', async () => {
    const h = newHandle();
    await new D1RecordStore(db, now).put(h, rec());
    expect(await new D1RecordStore(db, now).get(h)).toEqual(rec());
    const key = await handleKey(h);
    expect(key).toMatch(/^[0-9a-f]{64}$/);
    const r = await row(key);
    expect(r).toBeTruthy();
    expect(JSON.stringify(r)).not.toContain(h);
    expect(await row(h)).toBeNull();
  });

  it('a stale writer gets StoreConflictError and the first write stands', async () => {
    const h = newHandle();
    await new D1RecordStore(db, now).put(h, rec(0));
    const a = new D1RecordStore(db, now);
    const b = new D1RecordStore(db, now);
    await a.get(h);
    await b.get(h);
    await a.put(h, rec(1));
    await expect(b.put(h, rec(2))).rejects.toBeInstanceOf(StoreConflictError);
    expect(await new D1RecordStore(db, now).get(h)).toEqual(rec(1));
  });

  it('two inserts of one new handle: exactly one wins', async () => {
    const h = newHandle();
    const results = await Promise.allSettled([new D1RecordStore(db, now).put(h, rec(1)), new D1RecordStore(db, now).put(h, rec(2))]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const lost = results.find((r) => r.status === 'rejected') as PromiseRejectedResult;
    expect(lost.reason).toBeInstanceOf(StoreConflictError);
  });

  it('several puts in one request succeed', async () => {
    const h = newHandle();
    const s = new D1RecordStore(db, now);
    await s.put(h, rec(1));
    await s.put(h, rec(2));
    await s.get(h);
    await s.put(h, rec(3));
    expect((await row(await handleKey(h)))!.ver).toBe(3);
    expect(await new D1RecordStore(db, now).get(h)).toEqual(rec(3));
  });

  it('expires after 30 days without use, and refreshes on use', async () => {
    const h = newHandle();
    await new D1RecordStore(db, now).put(h, rec());
    const key = await handleKey(h);
    t += 29 * 24 * 3600_000;
    expect(await new D1RecordStore(db, now).get(h)).toEqual(rec());
    expect(Number((await row(key))!.touched)).toBe(t);
    t += MCP_TTL_MS + 1;
    expect(await new D1RecordStore(db, now).get(h)).toBeUndefined();
    expect(await row(key)).toBeNull();
  });

  it('a corrupt body reads as undefined and logs no handle or hash', async () => {
    const h = newHandle();
    const key = await handleKey(h);
    await db.prepare('INSERT INTO mcp_records (h, body, ver, touched) VALUES (?, ?, 1, ?)').bind(key, '{"format":"nope"}', t).run();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(await new D1RecordStore(db, now).get(h)).toBeUndefined();
    expect(warn).toHaveBeenCalledWith('mcp record unreadable');
    expect(JSON.stringify(warn.mock.calls)).not.toContain(key);
    expect(JSON.stringify(warn.mock.calls)).not.toContain(h);
    warn.mockRestore();
  });

  it('refuses a record over the size cap with a public StoreError', async () => {
    const big = { ...rec(), courses: { x: { courseVersion: '1', registration: 'r', completedLessons: [], caughtBugs: [], files: { a: 'x'.repeat(RECORD_MAX_CHARS) } } } };
    const err = await new D1RecordStore(db, now).put(newHandle(), big).catch((e) => e);
    expect(err).toBeInstanceOf(StoreError);
    expect(err).not.toBeInstanceOf(StoreConflictError);
    expect(err.message).toBe('this record has reached its size limit; export it with get_record to keep it');
  });

  it('delete returns true, then false', async () => {
    const h = newHandle();
    await new D1RecordStore(db, now).put(h, rec());
    expect(await new D1RecordStore(db, now).delete(h)).toBe(true);
    expect(await new D1RecordStore(db, now).delete(h)).toBe(false);
  });

  it('sweepExpired deletes only rows older than the TTL', async () => {
    const old = newHandle();
    await new D1RecordStore(db, now).put(old, rec());
    t += MCP_TTL_MS;
    const fresh = newHandle();
    await new D1RecordStore(db, now).put(fresh, rec());
    t += 1;
    expect(await sweepExpired(db, t)).toBe(1);
    expect(await row(await handleKey(old))).toBeNull();
    expect(await row(await handleKey(fresh))).not.toBeNull();
  });

  it('uses no upsert syntax', () => {
    const src = readFileSync('functions/_lib/mcp/recordStore.ts', 'utf8');
    const sql = [...src.matchAll(/prepare\(\s*'([^']*)'/g)].map((m) => m[1]);
    expect(sql.length).toBeGreaterThanOrEqual(7);
    for (const s of sql) expect(s).not.toMatch(/ON CONFLICT|ON DUPLICATE|REPLACE INTO|UPSERT|INSERT OR/i);
  });
});

describe('GET /api/mcp-sweep', () => {
  const call = (env: Partial<Env>, auth?: string) =>
    sweep(new Request('http://x/api/mcp-sweep', { headers: auth ? { authorization: auth } : {} }), { params: {}, env: { DB: db, ...env } as Env });

  it('is 503 when CRON_SECRET is not set, and 401 without the right bearer token', async () => {
    expect((await call({}, 'Bearer x')).status).toBe(503);
    expect((await call({ CRON_SECRET: 's3cret-value' })).status).toBe(401);
    expect((await call({ CRON_SECRET: 's3cret-value' }, 'Bearer wrong')).status).toBe(401);
    expect((await call({ CRON_SECRET: 's3cret-value' }, 's3cret-value')).status).toBe(401);
  });

  it('deletes stale rows with the right token', async () => {
    await new D1RecordStore(db, () => Date.now() - MCP_TTL_MS - 60_000).put(newHandle(), rec());
    const r = await call({ CRON_SECRET: 's3cret-value' }, 'Bearer s3cret-value');
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ deleted: 1 });
  });
});
