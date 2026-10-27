import type { Handler } from '../_lib/env';
import { error } from '../_lib/http';
import { clientKey } from '../_lib/guards';
import { guarded } from '../_lib/ai';
import { ensureSchema } from '../_lib/db';
import { rateLimit } from '../_lib/ratelimit';
import { XAPI_BASE } from '../../src/shared/xapi';
import { clearCookie, cookieValue, createSession, deleteSession, readSession } from '../_lib/session/session';

const reply = (data: unknown, cookie?: string, status = 200) => {
  const headers = new Headers({ 'content-type': 'application/json; charset=utf-8' });
  if (cookie) headers.append('set-cookie', cookie);
  return new Response(JSON.stringify(data), { status, headers });
};
const actorOf = (name: string) => ({ homePage: XAPI_BASE, name });
const disabled = () => error(503, 'disabled', 'Sessions are not configured.');

export const POST: Handler = (req, { env }) =>
  guarded(async () => {
    if (!env.SESSION_KEY) return disabled();
    await ensureSchema(env.DB);
    const now = Date.now();
    if (
      !(await rateLimit(env.DB, `sess:new:${clientKey(req, env)}`, now, 10, 600_000)) ||
      !(await rateLimit(env.DB, 'sess:new:g', now, 300, 600_000))
    ) {
      return error(429, 'limited', 'Too many new sessions. Please wait a few minutes and try again.');
    }
    const { session, cookie } = await createSession(env, now);
    return reply({ actor: actorOf(session.actorName) }, cookie);
  });

export const GET: Handler = (req, { env }) =>
  guarded(async () => {
    if (!env.SESSION_KEY) return disabled();
    const session = await readSession(req, env, Date.now());
    if (session) return reply({ actor: actorOf(session.actorName) });
    return reply({ actor: null }, cookieValue(req) ? clearCookie() : undefined);
  });

export const DELETE: Handler = (req, { env }) =>
  guarded(async () => {
    if (!env.SESSION_KEY) return disabled();
    const session = await readSession(req, env, Date.now());
    if (session) await deleteSession(env, session);
    return reply({ deleted: true }, clearCookie());
  });
