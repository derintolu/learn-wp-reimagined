import { describe, it, expect } from 'vitest';
import { createSqliteD1 } from '../../dev/sqliteD1';
import { ensureSchema } from '../../functions/_lib/db';
import {
  reserve,
  settle,
  capState,
  MONTH_CAP_MICROS,
  DAY_CAP_MICROS,
} from '../../functions/_lib/budget';

const MODEL = 'claude-sonnet-5-5'; // $2 in / $10 out per M
const NOW = new Date('2026-10-19T12:00:00Z');

async function fresh() {
  const db = createSqliteD1();
  await ensureSchema(db);
  return db;
}
async function seed(db: Awaited<ReturnType<typeof fresh>>, period: string, micros: number) {
  await db.prepare('INSERT INTO spend (period, usd_micros) VALUES (?, ?)').bind(period, micros).run();
}
async function get(db: Awaited<ReturnType<typeof fresh>>, period: string) {
  const r = await db
    .prepare('SELECT usd_micros FROM spend WHERE period = ?')
    .bind(period)
    .first<{ usd_micros: number }>();
  return Number(r?.usd_micros ?? 0);
}

describe('budget', () => {
  it('ensureSchema is idempotent', async () => {
    const db = await fresh();
    await ensureSchema(db);
  });

  it('refuses with month-cap when worst case would pass the month cap', async () => {
    const db = await fresh();
    await seed(db, '2026-10', 99_990_000);
    // 1000 in * $2 + 1800 out * $10 = 2000 + 18000 = 20000 micros = $0.02
    const r = await reserve(db, MODEL, 1000, 1800, NOW);
    expect(r).toEqual({ ok: false, reason: 'month-cap' });
    expect(await get(db, '2026-10')).toBe(99_990_000);
  });

  it('refuses with day-cap and rolls back the month increment', async () => {
    const db = await fresh();
    await seed(db, '2026-10-19', 9_995_000);
    const r = await reserve(db, MODEL, 1000, 1800, NOW);
    expect(r).toEqual({ ok: false, reason: 'day-cap' });
    expect(await get(db, '2026-10-19')).toBe(9_995_000);
    expect(await get(db, '2026-10')).toBe(0);
  });

  it('allows exactly up to the cap', async () => {
    const db = await fresh();
    await seed(db, '2026-10', MONTH_CAP_MICROS - 20_000);
    const r = await reserve(db, MODEL, 1000, 1800, NOW);
    expect(r.ok).toBe(true);
    expect(await get(db, '2026-10')).toBe(MONTH_CAP_MICROS);
  });

  it('ten concurrent reserves near the cap never overshoot', async () => {
    const db = await fresh();
    await seed(db, '2026-10', 99_900_000);
    // 0 in, 3000 out * $10 = 30000 micros = $0.03
    const rs = await Promise.all(
      Array.from({ length: 10 }, () => reserve(db, MODEL, 0, 3000, NOW)),
    );
    const okCount = rs.filter((r) => r.ok).length;
    expect(okCount).toBeLessThanOrEqual(3);
    expect(okCount).toBe(3);
    expect(await get(db, '2026-10')).toBeLessThanOrEqual(MONTH_CAP_MICROS);
    expect(await get(db, '2026-10-19')).toBe(90_000);
  });

  it('ten concurrent reserves on fresh rows all succeed without duplicate-key failures', async () => {
    const db = await fresh();
    const rs = await Promise.all(
      Array.from({ length: 10 }, () => reserve(db, MODEL, 0, 3000, NOW)),
    );
    expect(rs.every((r) => r.ok)).toBe(true);
    expect(await get(db, '2026-10')).toBe(300_000);
  });

  it('refuses an unknown model as month-cap, never free', async () => {
    const db = await fresh();
    expect(await reserve(db, 'mystery-model', 10, 10, NOW)).toEqual({
      ok: false,
      reason: 'month-cap',
    });
    expect(await get(db, '2026-10')).toBe(0);
  });

  it('refuses invalid token counts', async () => {
    const db = await fresh();
    expect(await reserve(db, MODEL, -1, 10, NOW)).toEqual({ ok: false, reason: 'month-cap' });
    expect(await reserve(db, MODEL, 10, NaN, NOW)).toEqual({ ok: false, reason: 'month-cap' });
  });

  it('rounds the worst case up', async () => {
    const db = await fresh();
    // 1 in token * $0.1 = 0.1 micro -> 1 micro
    const r = await reserve(db, 'claude-haiku-5-5', 1, 0, NOW);
    expect(r).toEqual({ ok: true, reservation: 1 });
    expect(await get(db, '2026-10')).toBe(1);
  });

  it('settle replaces the reservation with the actual cost', async () => {
    const db = await fresh();
    const r = await reserve(db, MODEL, 1000, 1800, NOW);
    if (!r.ok) throw new Error('expected ok');
    expect(r.reservation).toBe(20_000);
    await settle(db, r.reservation, MODEL, { inputTokens: 500, outputTokens: 100 }, NOW);
    // 500*2 + 100*10 = 2000 micros
    expect(await get(db, '2026-10')).toBe(2000);
    expect(await get(db, '2026-10-19')).toBe(2000);
  });

  it('settle with unknown model keeps the reservation charged', async () => {
    const db = await fresh();
    await seed(db, '2026-10', 5);
    await seed(db, '2026-10-19', 5);
    await settle(db, 0, 'mystery', { inputTokens: 1, outputTokens: 1 }, NOW);
    expect(await get(db, '2026-10')).toBe(5);
  });

  it('resets on the 1st UTC and at 00:00 UTC', async () => {
    const db = await fresh();
    await seed(db, '2026-10', MONTH_CAP_MICROS);
    await seed(db, '2026-10-31', DAY_CAP_MICROS);
    expect(await capState(db, new Date('2026-10-31T23:59:59Z'))).toBe('month-cap');
    expect(await capState(db, new Date('2026-11-01T00:00:00Z'))).toBe('ok');
    await seed(db, '2026-11', 1_000_000);
    await seed(db, '2026-11-01', DAY_CAP_MICROS);
    expect(await capState(db, new Date('2026-11-01T23:59:59Z'))).toBe('day-cap');
    expect(await capState(db, new Date('2026-11-02T00:00:00Z'))).toBe('ok');
    expect((await reserve(db, MODEL, 1, 1, new Date('2026-11-02T00:00:00Z'))).ok).toBe(true);
  });
});
