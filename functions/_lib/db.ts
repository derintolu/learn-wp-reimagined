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
  await db
    .prepare(
      'CREATE TABLE IF NOT EXISTS sessions (sid_hash VARCHAR(64) PRIMARY KEY, actor_name VARCHAR(64), wp_user_id BIGINT NULL, created BIGINT, touched BIGINT)',
    )
    .run();
}

/**
 * The MCP authorization server's tables, kept out of ensureSchema so other routes do not pay for them.
 * Codes, request ids, browser bindings and tokens are stored as SHA-256 hex only.
 * oauth_codes holds pending authorization requests (kind 'request') and authorization codes (kind 'code').
 * oauth_tokens holds access and refresh tokens (kind 'access' | 'refresh'); one grant shares a family_id.
 */
export async function ensureOAuthSchema(db: D1Like): Promise<void> {
  await db
    .prepare(
      'CREATE TABLE IF NOT EXISTS oauth_clients (client_id VARCHAR(64) PRIMARY KEY, client_name VARCHAR(200) NULL, redirect_uris TEXT, created BIGINT)',
    )
    .run();
  await db
    .prepare(
      'CREATE TABLE IF NOT EXISTS oauth_codes (code_hash VARCHAR(64) PRIMARY KEY, kind VARCHAR(10), client_id VARCHAR(64), redirect_uri TEXT, code_challenge VARCHAR(64), state TEXT NULL, browser_hash VARCHAR(64) NULL, family_id VARCHAR(64) NULL, actor_name VARCHAR(64) NULL, wp_user_id BIGINT NULL, registration VARCHAR(120) NULL, created BIGINT, expires BIGINT, used INT)',
    )
    .run();
  await db
    .prepare(
      'CREATE TABLE IF NOT EXISTS oauth_tokens (token_hash VARCHAR(64) PRIMARY KEY, kind VARCHAR(10), family_id VARCHAR(64), client_id VARCHAR(64), actor_name VARCHAR(64), wp_user_id BIGINT, registration VARCHAR(120), created BIGINT, expires BIGINT, used INT)',
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
