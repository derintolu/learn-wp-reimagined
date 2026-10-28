// The LRS outbox: official statements wait in env.DB until the LRS has stored them. A queue, not a record:
// rows are deleted once stored. Statement ids derive from the client eventId, so a re-enqueued id is a no-op
// (the first body wins, ruling R7) and a re-sent statement is the identical one.
import type { Env } from '../env';
import { ensureRecordSchema, isDuplicateKey } from '../db';
import { LrsClient, LrsError, LrsUnavailable } from './client';
import type { XapiStatement } from '../../../vendor/course-xapi-mcp/core/xapi/types';

export const DRAIN_BATCH = 50;
/** Wait before the next try after the 1st, 2nd, 3rd and every later failure. */
export const BACKOFF_MINUTES = [1, 5, 15, 60] as const;
/** The inline drain after /api/events (ruling R22); the 5-minute cron takes the rest. */
export const INLINE_DRAIN_BUDGET_MS = 800;

interface Row {
  statement_id: string;
  body: string;
  attempts: number | string;
}

/** Queues statements in order. `now` stamps them as created and due. */
export async function enqueue(env: Env, statements: XapiStatement[], now = Date.now()): Promise<void> {
  if (statements.length === 0) return;
  await ensureRecordSchema(env.DB);
  for (const [i, s] of statements.entries()) {
    try {
      await env.DB
        .prepare('INSERT INTO lrs_outbox (statement_id, body, created, attempts, next_at) VALUES (?, ?, ?, 0, ?)')
        .bind(s.id, JSON.stringify(s), now + i, now)
        .run();
    } catch (e) {
      if (!isDuplicateKey(e)) throw e;
    }
  }
}

async function remove(env: Env, rows: Row[]): Promise<void> {
  await env.DB
    .prepare(`DELETE FROM lrs_outbox WHERE statement_id IN (${rows.map(() => '?').join(', ')})`)
    .bind(...rows.map((r) => r.statement_id))
    .run();
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
 * A batch the LRS refuses (4xx) is retried one statement at a time, so one bad statement holds back only itself.
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
      .prepare(`SELECT statement_id, body, attempts FROM lrs_outbox WHERE next_at <= ? ORDER BY created, statement_id LIMIT ${DRAIN_BATCH}`)
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
        await backOff(env, [r], now);
      }
    }
  }
  return { sent, left: await count(env) };
}

async function count(env: Env): Promise<number> {
  const row = await env.DB.prepare('SELECT COUNT(*) AS n FROM lrs_outbox').first<{ n: number | string }>();
  return Number(row?.n ?? 0);
}

type WaitUntil = (p: Promise<unknown>) => void;

/**
 * Drains after a request has been decided. When the handler context offers waitUntil (feature-detected on
 * `ctx.ctx` or the context itself, ruling R22) the drain runs after the response; otherwise inline, waiting
 * at most INLINE_DRAIN_BUDGET_MS. A failure is logged, never thrown: the rows stay for the cron.
 */
export async function drainAfterDecide(handlerCtx: unknown, env: Env, now: number): Promise<void> {
  const run = drain(env, now, INLINE_DRAIN_BUDGET_MS).catch((e) => {
    console.error('lrs drain failed', (e as Error)?.name, (e as Error)?.message);
  });
  const c = handlerCtx as { ctx?: { waitUntil?: WaitUntil }; waitUntil?: WaitUntil } | null;
  if (typeof c?.ctx?.waitUntil === 'function') return c.ctx.waitUntil(run);
  if (typeof c?.waitUntil === 'function') return c.waitUntil(run);
  let timer: ReturnType<typeof setTimeout> | undefined;
  await Promise.race([run, new Promise<void>((resolve) => (timer = setTimeout(resolve, INLINE_DRAIN_BUDGET_MS)))]);
  clearTimeout(timer);
}
