// Daily cron target (sf.jsonc "crons"): erases learners idle for 180 days, deletes expired OAuth codes and tokens and runs
// the Sensei/LRS drift check. Spacefast docs (references, "crons", checked 2026-10-20): declare CRON_SECRET and
// check `authorization: Bearer <CRON_SECRET>` to prove a request is the schedule's.
import type { Handler } from '../_lib/env';
import { error, json } from '../_lib/http';
import { sameSecret } from '../_lib/guards';
import { ensureSchema } from '../_lib/db';
import { deleteExpiredCodes, deleteExpiredTokens } from '../_lib/oauth/store';
import { sweep } from '../_lib/session/lifecycle';

export const GET: Handler = async (req, { env }) => {
  if (!env.CRON_SECRET) return error(503, 'not-configured', 'The sweep is not configured.');
  const auth = req.headers.get('authorization') ?? '';
  if (!auth.startsWith('Bearer ') || !sameSecret(auth.slice(7), env.CRON_SECRET)) return error(401, 'unauthorized', 'Not allowed.');
  await ensureSchema(env.DB);
  const now = Date.now();
  const report = await sweep(env, now);
  const tokensExpired = await deleteExpiredTokens(env, now);
  return json({ ...report, tokensExpired, codesExpired: await deleteExpiredCodes(env, now) });
};
