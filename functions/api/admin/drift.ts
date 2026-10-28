// The latest Sensei/LRS drift report stored by the daily /api/sweep. Admin bearer token, as admin/spend.
import type { Handler } from '../../_lib/env';
import { error, json } from '../../_lib/http';
import { sameSecret } from '../../_lib/guards';
import { latestDriftReport } from '../../_lib/session/lifecycle';

export const GET: Handler = async (req, { env }) => {
  const token = env.ADMIN_TOKEN;
  const header = req.headers.get('authorization') ?? '';
  const given = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!token || !given || !sameSecret(given, token)) return error(401, 'unauthorized', 'Unauthorized.');
  const latest = await latestDriftReport(env);
  return json({ day: latest?.day ?? null, drift: latest?.drift ?? null });
};
