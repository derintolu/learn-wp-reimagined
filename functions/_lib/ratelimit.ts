import type { D1Like } from './env';
import { isDuplicateKey } from './db';

/**
 * Fixed-window limiter. Every state change is a conditional UPDATE checked via
 * meta.changes, so concurrent callers cannot exceed `limit` per window.
 */
export async function rateLimit(
  db: D1Like,
  key: string,
  now: number,
  limit = 30,
  windowMs = 600_000,
): Promise<boolean> {
  const k = key.slice(0, 80);
  for (let attempt = 0; attempt < 5; attempt++) {
    const row = await db
      .prepare('SELECT window_start, n FROM hits WHERE k = ?')
      .bind(k)
      .first<{ window_start: number; n: number }>();
    if (!row) {
      try {
        await db
          .prepare('INSERT INTO hits (k, window_start, n) VALUES (?, ?, 1)')
          .bind(k, now)
          .run();
        return true;
      } catch (e) {
        if (!isDuplicateKey(e)) throw e;
        continue; // concurrent insert won; re-read
      }
    }
    const start = Number(row.window_start);
    if (now - start >= windowMs) {
      const r = await db
        .prepare('UPDATE hits SET window_start = ?, n = 1 WHERE k = ? AND window_start = ?')
        .bind(now, k, start)
        .run();
      if (r.meta.changes === 1) return true;
      continue;
    }
    const r = await db
      .prepare('UPDATE hits SET n = n + 1 WHERE k = ? AND window_start = ? AND n < ?')
      .bind(k, start, limit)
      .run();
    if (r.meta.changes === 1) return true;
    // Blocked, unless the window changed under us.
    const again = await db
      .prepare('SELECT window_start FROM hits WHERE k = ?')
      .bind(k)
      .first<{ window_start: number }>();
    if (again && Number(again.window_start) === start) return false;
  }
  return false;
}
