import type { D1Like } from './env';
import type { Usage } from './providers/types';
import { PRICES } from './config';
import { isDuplicateKey } from './db';

export const MONTH_CAP_MICROS = 100_000_000;
export const DAY_CAP_MICROS = 10_000_000;

/** The exact periods charged by `reserve`; `settle` adjusts these rows, whatever the time is now. */
export interface Reservation {
  micros: number;
  month: string;
  day: string;
}

type Refusal = { ok: false; reason: 'month-cap' | 'day-cap' };

const pad = (n: number) => String(n).padStart(2, '0');
function periods(now: Date): { month: string; day: string } {
  const month = `${now.getUTCFullYear()}-${pad(now.getUTCMonth() + 1)}`;
  return { month, day: `${month}-${pad(now.getUTCDate())}` };
}

/** Micro-dollars (= USD per M tokens * tokens), or null for an unknown model / bad counts. */
function costMicros(
  model: string,
  inTok: number,
  outTok: number,
  round: (n: number) => number,
): number | null {
  const p = Object.prototype.hasOwnProperty.call(PRICES, model) ? PRICES[model] : undefined;
  if (!p) return null;
  if (![inTok, outTok].every((n) => Number.isFinite(n) && n >= 0)) return null;
  // toFixed trims float noise (e.g. 0.35*1000 = 350.00000000000006) before rounding.
  return round(Number((inTok * p.inPerM + outTok * p.outPerM).toFixed(6)));
}

// Creates the row if missing. Another request may insert it first; that duplicate-key
// error is expected and ignored, the conditional UPDATE below is what enforces the cap.
async function ensureRow(db: D1Like, period: string): Promise<void> {
  const row = await db.prepare('SELECT usd_micros FROM spend WHERE period = ?').bind(period).first();
  if (row) return;
  try {
    await db.prepare('INSERT INTO spend (period, usd_micros) VALUES (?, 0)').bind(period).run();
  } catch (e) {
    if (!isDuplicateKey(e)) throw e;
    // concurrent insert won the race
  }
}

async function tryAdd(db: D1Like, period: string, add: number, cap: number): Promise<boolean> {
  const r = await db
    .prepare('UPDATE spend SET usd_micros = usd_micros + ? WHERE period = ? AND usd_micros + ? <= ?')
    .bind(add, period, add, cap)
    .run();
  return r.meta.changes === 1;
}

// Clamped at 0 so a row can never go negative (which would widen the cap).
async function add(db: D1Like, period: string, delta: number): Promise<void> {
  await db
    .prepare(
      'UPDATE spend SET usd_micros = CASE WHEN usd_micros + ? < 0 THEN 0 ELSE usd_micros + ? END WHERE period = ?',
    )
    .bind(delta, delta, period)
    .run();
}

/**
 * Reserves the worst-case cost (rounded UP) on the month and day rows atomically via
 * conditional UPDATEs. An unknown model (or invalid token counts) is refused as
 * `month-cap`; it is never treated as free.
 */
export async function reserve(
  db: D1Like,
  model: string,
  maxInputTokens: number,
  maxTokens: number,
  now: Date,
): Promise<{ ok: true; reservation: Reservation } | Refusal> {
  const cost = costMicros(model, maxInputTokens, maxTokens, Math.ceil);
  if (cost === null) return { ok: false, reason: 'month-cap' };
  const { month, day } = periods(now);
  if (cost === 0) {
    // MySQL counts changed rows, not matched rows, so a +0 UPDATE would look like a refusal.
    const s = await spendNow(db, now);
    if (s.month > MONTH_CAP_MICROS) return { ok: false, reason: 'month-cap' };
    if (s.day > DAY_CAP_MICROS) return { ok: false, reason: 'day-cap' };
    return { ok: true, reservation: { micros: 0, month, day } };
  }
  await ensureRow(db, month);
  await ensureRow(db, day);
  if (!(await tryAdd(db, month, cost, MONTH_CAP_MICROS))) return { ok: false, reason: 'month-cap' };
  if (!(await tryAdd(db, day, cost, DAY_CAP_MICROS))) {
    await add(db, month, -cost);
    return { ok: false, reason: 'day-cap' };
  }
  return { ok: true, reservation: { micros: cost, month, day } };
}

/**
 * Replaces the reservation with the actual cost on the exact month/day rows it charged.
 * Must be called exactly once per reservation. Unknown model keeps the reservation charged.
 */
export async function settle(
  db: D1Like,
  reservation: Reservation,
  model: string,
  usage: Usage,
): Promise<void> {
  const actual = costMicros(model, usage.inputTokens, usage.outputTokens, Math.ceil);
  if (actual === null) return;
  const delta = actual - reservation.micros;
  if (delta === 0) return;
  const { month, day } = reservation;
  await ensureRow(db, month);
  await ensureRow(db, day);
  await add(db, month, delta);
  await add(db, day, delta);
}

export async function spendNow(db: D1Like, now: Date): Promise<{ month: number; day: number }> {
  const { month, day } = periods(now);
  const get = async (p: string) =>
    Number(
      (await db.prepare('SELECT usd_micros FROM spend WHERE period = ?').bind(p).first<{ usd_micros: number }>())
        ?.usd_micros ?? 0,
    );
  return { month: await get(month), day: await get(day) };
}

export async function capState(db: D1Like, now: Date): Promise<'ok' | 'month-cap' | 'day-cap'> {
  const s = await spendNow(db, now);
  if (s.month >= MONTH_CAP_MICROS) return 'month-cap';
  if (s.day >= DAY_CAP_MICROS) return 'day-cap';
  return 'ok';
}
