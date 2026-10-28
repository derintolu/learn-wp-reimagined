// 5-minute cron target (sf.jsonc "crons"): ends AU sessions idle for 30 minutes with `abandoned`, then drains
// the LRS outbox. Same CRON_SECRET bearer check as /api/mcp-sweep. Does nothing with SERVER_FLAGS.lrsShadow off.
import type { Handler } from '../_lib/env';
import { error, json } from '../_lib/http';
import { sameSecret } from '../_lib/guards';
import { SERVER_FLAGS } from '../_lib/config';
import { ensureRecordSchema } from '../_lib/db';
import { drain, enqueue } from '../_lib/lrs/outbox';
import { abandonedStatement, deleteAuSession, listIdleAuSessions, officialActor } from '../_lib/record/official';

/** Leaves headroom under the function time limit; what is left waits for the next run. */
export const CRON_DRAIN_BUDGET_MS = 20_000;

export const GET: Handler = async (req, { env }) => {
  if (!env.CRON_SECRET) return error(503, 'not-configured', 'The drain is not configured.');
  const auth = req.headers.get('authorization') ?? '';
  if (!auth.startsWith('Bearer ') || !sameSecret(auth.slice(7), env.CRON_SECRET)) return error(401, 'unauthorized', 'Not allowed.');
  if (!SERVER_FLAGS.lrsShadow) return json({ sent: 0, left: 0, abandoned: 0 });
  await ensureRecordSchema(env.DB);
  const now = Date.now();
  let abandoned = 0;
  for (const row of await listIdleAuSessions(env, now)) {
    const reg = await env.DB
      .prepare('SELECT registration FROM sessions WHERE actor_name = ? AND registration IS NOT NULL')
      .bind(row.actor_name)
      .first<{ registration: string }>();
    // A learner whose sessions are all gone (deleted their data) gets no statement; the row just goes.
    if (reg) {
      await enqueue(env, [await abandonedStatement({ actor: officialActor(row.actor_name), registration: reg.registration }, row)], now);
      abandoned++;
    }
    await deleteAuSession(env, row.actor_name, row);
  }
  return json({ ...(await drain(env, now, CRON_DRAIN_BUDGET_MS)), abandoned });
};
