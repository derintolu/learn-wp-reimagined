// Cron target (sf.jsonc "crons"): records the events held for learners who had no registration yet (ruling R52),
// ends AU sessions idle for 30 minutes with `abandoned`, then drains the LRS outbox, all within CRON_DRAIN_BUDGET_MS. Same CRON_SECRET bearer check as /api/sweep.
import type { Handler } from '../_lib/env';
import { error, json } from '../_lib/http';
import { sameSecret } from '../_lib/guards';
import { ensureRecordSchema } from '../_lib/db';
import { drain, enqueue } from '../_lib/lrs/outbox';
import { abandonedStatement, listIdleAuSessions, officialActor } from '../_lib/record/official';
import { replayHeld } from '../_lib/record/shadow';

/** Leaves headroom under the function time limit; what is left waits for the next run. */
export const CRON_DRAIN_BUDGET_MS = 20_000;

export const GET: Handler = async (req, { env }) => {
  if (!env.CRON_SECRET) return error(503, 'not-configured', 'The drain is not configured.');
  const auth = req.headers.get('authorization') ?? '';
  if (!auth.startsWith('Bearer ') || !sameSecret(auth.slice(7), env.CRON_SECRET)) return error(401, 'unauthorized', 'Not allowed.');
  await ensureRecordSchema(env.DB);
  const now = Date.now();
  // The replay takes at most half the budget; the drain has what is left.
  const replayed = await replayHeld(env, now + CRON_DRAIN_BUDGET_MS / 2);
  let abandoned = 0;
  for (const row of await listIdleAuSessions(env, now)) {
    const reg = await env.DB
      .prepare('SELECT registration FROM sessions WHERE actor_name = ? AND registration IS NOT NULL')
      .bind(row.actor_name)
      .first<{ registration: string }>();
    // Only a session still idle: an event that extended it meanwhile keeps it open.
    const gone = await env.DB
      .prepare('DELETE FROM au_sessions WHERE actor_name = ? AND au_key = ? AND session_id = ? AND last = ?')
      .bind(row.actor_name, row.au_key, row.session_id, row.last)
      .run();
    // A learner whose sessions are all gone (deleted their data) gets no statement; the row just goes.
    if (gone.meta.changes === 1 && reg) {
      await enqueue(env, [await abandonedStatement({ actor: officialActor(row.actor_name), registration: reg.registration }, row)], now);
      abandoned++;
    }
  }
  return json({ ...(await drain(env, now, Math.max(0, now + CRON_DRAIN_BUDGET_MS - Date.now()))), abandoned, replayed });
};
