// Daily cron target (sf.jsonc "crons"): erases learners idle for 180 days and runs the Sensei/LRS drift check.
// Same CRON_SECRET bearer check as /api/mcp-sweep.
import type { Handler } from '../_lib/env';
import { error, json } from '../_lib/http';
import { sameSecret } from '../_lib/guards';
import { ensureSchema } from '../_lib/db';
import { sweep } from '../_lib/session/lifecycle';

export const GET: Handler = async (req, { env }) => {
  if (!env.CRON_SECRET) return error(503, 'not-configured', 'The sweep is not configured.');
  const auth = req.headers.get('authorization') ?? '';
  if (!auth.startsWith('Bearer ') || !sameSecret(auth.slice(7), env.CRON_SECRET)) return error(401, 'unauthorized', 'Not allowed.');
  await ensureSchema(env.DB);
  return json(await sweep(env, Date.now()));
};
