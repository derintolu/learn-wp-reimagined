import type { D1Like } from './env';

// Portable SQL: runs on SQLite (tests) and MySQL (Spacefast broker).
export async function ensureSchema(db: D1Like): Promise<void> {
  await db
    .prepare('CREATE TABLE IF NOT EXISTS spend (period VARCHAR(10) PRIMARY KEY, usd_micros BIGINT)')
    .run();
  await db
    .prepare(
      'CREATE TABLE IF NOT EXISTS hits (k VARCHAR(80) PRIMARY KEY, window_start BIGINT, n INT)',
    )
    .run();
}
