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
  await db
    .prepare(
      'CREATE TABLE IF NOT EXISTS decisions (id VARCHAR(40) PRIMARY KEY, lesson_id VARCHAR(120), outcome VARCHAR(10), created BIGINT, used INT, used_by VARCHAR(64))',
    )
    .run();
}

/** True only for duplicate-key errors (SQLite UNIQUE constraint, MySQL 1062 / ER_DUP_ENTRY). */
export function isDuplicateKey(e: unknown): boolean {
  const err = e as { message?: unknown; code?: unknown; errno?: unknown } | null;
  const msg = String(err?.message ?? e);
  const code = String(err?.code ?? '');
  return (
    /UNIQUE constraint failed|SQLITE_CONSTRAINT|Duplicate entry|ER_DUP_ENTRY/i.test(msg + ' ' + code) ||
    err?.errno === 1062 ||
    /\b1062\b/.test(code)
  );
}
