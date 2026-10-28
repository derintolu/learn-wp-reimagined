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

/** Sensei enrolments made for session learners (Task 25); one row per learner and path. */
export async function ensureEnrolmentSchema(db: D1Like): Promise<void> {
  await db
    .prepare(
      'CREATE TABLE IF NOT EXISTS enrolments (wp_user_id BIGINT, course_key VARCHAR(64), created BIGINT, PRIMARY KEY (wp_user_id, course_key))',
    )
    .run();
}

const courseCacheReady = new WeakSet<D1Like>();

/** The last good course package from the Learning Ledger (Task 19), one row per course; body is the bundle as JSON. */
export async function ensureCourseCacheSchema(db: D1Like): Promise<void> {
  if (courseCacheReady.has(db)) return;
  await db
    .prepare(
      'CREATE TABLE IF NOT EXISTS course_cache (course_id VARCHAR(64) PRIMARY KEY, etag VARCHAR(80), version INT, body MEDIUMTEXT, fetched BIGINT, hooks_done INT)',
    )
    .run();
  await db.prepare('CREATE TABLE IF NOT EXISTS ping_nonces (nonce VARCHAR(80) PRIMARY KEY, seen BIGINT)').run();
  courseCacheReady.add(db);
}

const recordReady = new WeakSet<D1Like>();

/**
 * The official-record tables (Task 30), kept out of ensureSchema so routes pay for them only with
 * SERVER_FLAGS.lrsShadow on. lrs_outbox is a queue of statements for the LRS (rows are deleted once stored);
 * au_sessions holds each learner's open cmi5 AU session; shadow_facts the learning facts decided per day;
 * official_outcomes the defined completed, passed and waived already sent (at most once per registration);
 * lrs_imports the course package ETags already imported. Also adds sessions.registration.
 */
export async function ensureRecordSchema(db: D1Like): Promise<void> {
  if (recordReady.has(db)) return;
  await db
    .prepare('CREATE TABLE IF NOT EXISTS lrs_outbox (statement_id VARCHAR(36) PRIMARY KEY, actor_name VARCHAR(64) NULL, body TEXT, created BIGINT, attempts INT, next_at BIGINT)')
    .run();
  await db
    .prepare(
      'CREATE TABLE IF NOT EXISTS au_sessions (actor_name VARCHAR(64), au_key VARCHAR(120), session_id VARCHAR(36), started BIGINT, last BIGINT, PRIMARY KEY (actor_name, au_key))',
    )
    .run();
  await db
    .prepare('CREATE TABLE IF NOT EXISTS shadow_facts (day VARCHAR(10), actor_name VARCHAR(64), lesson_id VARCHAR(120), kind VARCHAR(12))')
    .run();
  await db
    .prepare(
      'CREATE TABLE IF NOT EXISTS official_outcomes (actor_name VARCHAR(64), activity_id VARCHAR(200), verb VARCHAR(12), event_id VARCHAR(64), PRIMARY KEY (actor_name, activity_id, verb))',
    )
    .run();
  await db.prepare('CREATE TABLE IF NOT EXISTS lrs_imports (etag VARCHAR(200) PRIMARY KEY, imported BIGINT)').run();
  await ensureSchema(db);
  try {
    await db.prepare('ALTER TABLE sessions ADD COLUMN registration VARCHAR(36) NULL').run();
  } catch (e) {
    // Already added (SQLite "duplicate column name", MySQL 1060 "Duplicate column name").
    if (!/duplicate column/i.test(String((e as { message?: unknown })?.message ?? e))) throw e;
  }
  recordReady.add(db);
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
