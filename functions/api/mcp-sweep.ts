// Daily cron target (sf.jsonc "crons"). Deletes agent records unused for 30 days; reads enforce the same
// expiry, so this only keeps the table small. Spacefast docs (references, "crons", checked 2026-10-20):
// declare CRON_SECRET and check `authorization: Bearer <CRON_SECRET>` to prove a request is the schedule's.
import type { Handler } from '../_lib/env';
import { error, json } from '../_lib/http';
import { ensureMcpSchema, sweepExpired } from '../_lib/mcp/recordStore';

/** Compares two strings in time that depends only on their lengths. */
function sameSecret(a: string, b: string): boolean {
  const x = new TextEncoder().encode(a);
  const y = new TextEncoder().encode(b);
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}

export const GET: Handler = async (req, { env }) => {
  if (!env.CRON_SECRET) return error(503, 'not-configured', 'The sweep is not configured.');
  const auth = req.headers.get('authorization') ?? '';
  if (!auth.startsWith('Bearer ') || !sameSecret(auth.slice(7), env.CRON_SECRET)) return error(401, 'unauthorized', 'Not allowed.');
  await ensureMcpSchema(env.DB);
  return json({ deleted: await sweepExpired(env.DB, Date.now()) });
};
