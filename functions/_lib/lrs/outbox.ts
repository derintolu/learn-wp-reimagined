// The LRS outbox: official statements wait in env.DB until the LRS has stored them. A queue, not a record:
// rows are deleted once stored. Statement ids derive from the client eventId, so a re-enqueued id is a no-op
// (the first body wins, ruling R7) and a re-sent statement is the identical one.
import type { Env } from '../env';
import { ensureRecordSchema, isDuplicateKey } from '../db';
import { SERVER_FLAGS } from '../config';
import { invalidateRecordCache } from '../record/read';
import { LrsClient, LrsError, LrsUnavailable } from './client';
import type { XapiStatement } from '../../../vendor/course-xapi-mcp/core/xapi/types';

export const DRAIN_BATCH = 50;
/** Wait before the next try after the 1st, 2nd, 3rd and every later failure. */
export const BACKOFF_MINUTES = [1, 5, 15, 60] as const;
/**
 * What the shadow record may add to /api/events (ruling R22): the registration lookup and the inline drain
 * share this budget; the 5-minute cron takes the rest.
 */
export const INLINE_DRAIN_BUDGET_MS = 800;
/** A statement the LRS refuses (4xx) is given up after this many attempts and kept, dead-lettered. */
export const DEAD_LETTER_AFTER = 5;
/** next_at of a dead-lettered row: never due, not counted as left. */
export const DEAD_LETTER_AT = Number.MAX_SAFE_INTEGER;

interface Row {
  statement_id: string;
  actor_name: string | null;
  body: string;
  attempts: number | string;
}

/**
 * Queues statements, due at once (`next_at = now`). `created` orders them for the drain: `now + seq + i`,
 * so a caller queuing several groups in one request passes the count already queued as `seq`.
 */
export async function enqueue(env: Env, statements: XapiStatement[], now = Date.now(), seq = 0): Promise<void> {
  if (statements.length === 0) return;
  await ensureRecordSchema(env.DB);
  for (const [i, s] of statements.entries()) {
    try {
      await env.DB
        .prepare('INSERT INTO lrs_outbox (statement_id, actor_name, body, created, attempts, next_at) VALUES (?, ?, ?, ?, 0, ?)')
        .bind(s.id, s.actor?.account?.name ?? null, JSON.stringify(s), now + seq + i, now)
        .run();
    } catch (e) {
      if (!isDuplicateKey(e)) throw e;
    }
  }
}

/** The rows are stored at the LRS: delete them, and drop the cached official record of each learner they belong to. */
async function remove(env: Env, rows: Row[]): Promise<void> {
  await env.DB
    .prepare(`DELETE FROM lrs_outbox WHERE statement_id IN (${rows.map(() => '?').join(', ')})`)
    .bind(...rows.map((r) => r.statement_id))
    .run();
  if (SERVER_FLAGS.officialRecord) {
    for (const a of new Set(rows.map((r) => r.actor_name))) if (a) await invalidateRecordCache(env, a);
  }
}

/** A statement the LRS refused: backed off, or dead-lettered once it has had DEAD_LETTER_AFTER attempts. */
async function refused(env: Env, r: Row, e: LrsError, now: number): Promise<void> {
  if (Number(r.attempts) + 1 < DEAD_LETTER_AFTER) return backOff(env, [r], now);
  console.error('lrs statement dead-lettered', r.statement_id, e.status);
  await env.DB.prepare('UPDATE lrs_outbox SET attempts = attempts + 1, next_at = ? WHERE statement_id = ?').bind(DEAD_LETTER_AT, r.statement_id).run();
}

async function backOff(env: Env, rows: Row[], now: number): Promise<void> {
  for (const r of rows) {
    const attempts = Number(r.attempts) + 1;
    const wait = BACKOFF_MINUTES[Math.min(attempts, BACKOFF_MINUTES.length) - 1] * 60_000;
    await env.DB.prepare('UPDATE lrs_outbox SET attempts = ?, next_at = ? WHERE statement_id = ?').bind(attempts, now + wait, r.statement_id).run();
  }
}

/**
 * Sends due rows, oldest first, in batches of DRAIN_BATCH, starting no new batch once `budgetMs` has passed.
 * A batch the LRS refuses (4xx) is retried one statement at a time, so one bad statement holds back only itself;
 * a statement refused DEAD_LETTER_AFTER times is dead-lettered (kept, never sent again).
 * When the LRS is unavailable the batch backs off and the drain stops. Other errors propagate.
 */
export async function drain(env: Env, now: number, budgetMs: number): Promise<{ sent: number; left: number }> {
  await ensureRecordSchema(env.DB);
  const client = new LrsClient(env);
  const started = Date.now();
  let sent = 0;
  while (Date.now() - started < budgetMs) {
    const { results: rows } = await env.DB
      // A literal LIMIT: some MySQL drivers quote a bound LIMIT value.
      .prepare(`SELECT statement_id, actor_name, body, attempts FROM lrs_outbox WHERE next_at <= ? ORDER BY created, statement_id LIMIT ${DRAIN_BATCH}`)
      .bind(now)
      .all<Row>();
    if (rows.length === 0) break;
    try {
      await client.postStatements(rows.map((r) => JSON.parse(r.body)));
      await remove(env, rows);
      sent += rows.length;
      continue;
    } catch (e) {
      if (e instanceof LrsUnavailable) {
        await backOff(env, rows, now);
        break;
      }
      if (!(e instanceof LrsError)) throw e;
    }
    for (const [i, r] of rows.entries()) {
      try {
        await client.putStatement(JSON.parse(r.body));
        await remove(env, [r]);
        sent++;
      } catch (e) {
        if (e instanceof LrsUnavailable) {
          await backOff(env, rows.slice(i), now);
          return { sent, left: await count(env) };
        }
        if (!(e instanceof LrsError)) throw e;
        await refused(env, r, e, now);
      }
    }
  }
  return { sent, left: await count(env) };
}

async function count(env: Env): Promise<number> {
  const row = await env.DB.prepare('SELECT COUNT(*) AS n FROM lrs_outbox WHERE next_at < ?').bind(DEAD_LETTER_AT).first<{ n: number | string }>();
  return Number(row?.n ?? 0);
}

type WaitUntil = (p: Promise<unknown>) => void;

/**
 * Drains after a request has been decided. When the handler context offers waitUntil (feature-detected on
 * `ctx.ctx` or the context itself, ruling R22) the drain runs after the response with a full budget;
 * otherwise inline, waiting no later than `deadline` (the budget shared with the registration lookup).
 * A failure is logged, never thrown: the rows stay for the cron.
 */
export async function drainAfterDecide(handlerCtx: unknown, env: Env, now: number, deadline: number): Promise<void> {
  const c = handlerCtx as { ctx?: { waitUntil?: WaitUntil }; waitUntil?: WaitUntil } | null;
  const host = typeof c?.ctx?.waitUntil === 'function' ? c.ctx : typeof c?.waitUntil === 'function' ? c : null;
  const budget = host ? INLINE_DRAIN_BUDGET_MS : Math.max(0, deadline - Date.now());
  const run = drain(env, now, budget).catch((e) => {
    console.error('lrs drain failed', (e as Error)?.name, (e as Error)?.message);
  });
  if (host) return host.waitUntil!(run);
  let timer: ReturnType<typeof setTimeout> | undefined;
  await Promise.race([run, new Promise<void>((resolve) => (timer = setTimeout(resolve, budget)))]);
  clearTimeout(timer);
}
