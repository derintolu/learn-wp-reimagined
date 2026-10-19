import type { Handler } from '../../_lib/env';
import { error, json } from '../../_lib/http';
import { ensureSchema } from '../../_lib/db';
import { spendNow, MONTH_CAP_MICROS, DAY_CAP_MICROS } from '../../_lib/budget';

function safeEqual(a: string, b: string): boolean {
  const x = new TextEncoder().encode(a);
  const y = new TextEncoder().encode(b);
  let diff = x.length ^ y.length;
  const n = Math.max(x.length, y.length);
  for (let i = 0; i < n; i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}

export const GET: Handler = async (req, { env }) => {
  const token = env.ADMIN_TOKEN;
  const header = req.headers.get('authorization') ?? '';
  const given = header.startsWith('Bearer ') ? header.slice(7) : '';
  // Unset/empty ADMIN_TOKEN always refuses; no comparison is ever "true" against nothing.
  if (!token || !given || !safeEqual(given, token)) {
    return error(401, 'unauthorized', 'Unauthorized.');
  }
  await ensureSchema(env.DB);
  const s = await spendNow(env.DB, new Date());
  return json({
    month: s.month / 1e6,
    day: s.day / 1e6,
    monthCap: MONTH_CAP_MICROS / 1e6,
    dayCap: DAY_CAP_MICROS / 1e6,
  });
};
