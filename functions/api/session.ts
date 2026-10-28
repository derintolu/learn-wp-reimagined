import type { Handler } from '../_lib/env';
import { error } from '../_lib/http';
import { clientKey } from '../_lib/guards';
import { guarded } from '../_lib/ai';
import { ensureSchema } from '../_lib/db';
import { rateLimit } from '../_lib/ratelimit';
import { ConnectorClient, ConnectorError, ConnectorUnavailable } from '../_lib/ledger/connector';
import { LrsError, LrsUnavailable } from '../_lib/lrs/client';
import { eraseLearner } from '../_lib/session/lifecycle';
import { XAPI_BASE } from '../../src/shared/xapi';
import { clearCookie, cookieValue, createSession, readSession } from '../_lib/session/session';

const reply = (data: unknown, cookie?: string, status = 200) => {
  const headers = new Headers({ 'content-type': 'application/json; charset=utf-8' });
  if (cookie) headers.append('set-cookie', cookie);
  return new Response(JSON.stringify(data), { status, headers });
};
const actorOf = (name: string) => ({ homePage: XAPI_BASE, name });
const connectorDown = () => error(503, 'connector-unavailable', 'The learning record is unavailable right now. Please try again shortly.');
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
    try {
      const { session, cookie, actor } = await createSession(env, now);
      return reply({ actor: actor ?? actorOf(session.actorName) }, cookie);
    } catch (e) {
      if (e instanceof ConnectorUnavailable || e instanceof ConnectorError) return connectorDown();
      throw e;
    }
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
    if (session) {
      // Every step runs before the session row goes; if one fails the row stays so "Delete my data" can be retried.
      try {
        await eraseLearner(env, session, { revokeBadges: true });
      } catch (e) {
        if (e instanceof ConnectorUnavailable || e instanceof LrsUnavailable) return connectorDown();
        if (e instanceof ConnectorError || e instanceof LrsError) {
          return error(502, 'delete-failed', 'Your data could not be deleted yet. Nothing was lost; please try Delete my data again shortly.');
        }
        throw e;
      }
    }
    return reply({ deleted: true }, clearCookie());
  });
