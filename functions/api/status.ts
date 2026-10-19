import type { Handler } from '../_lib/env';
import { json } from '../_lib/http';
import { ensureSchema } from '../_lib/db';
import { capState } from '../_lib/budget';
import { routeFor } from '../_lib/providers';

// Never calls a provider: only checks configuration and the spending cap.
export const GET: Handler = async (_req, { env }) => {
  if (!routeFor('placement', env)) return json({ ai: 'off', reason: 'not-configured' });
  await ensureSchema(env.DB);
  const cap = await capState(env.DB, new Date());
  if (cap !== 'ok') return json({ ai: 'capped', reason: cap });
  return json({ ai: 'on' });
};
