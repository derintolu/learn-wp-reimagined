// /api/oauth/consent: the consent page's two calls. GET names the agent asking; POST records the learner's
// decision. Allow reads the studio session, or creates one (and its cookie) when the browser has none, so the
// browser and the agent share one learner from the start.
import type { Handler } from '../../_lib/env';
import { error } from '../../_lib/http';
import { clientKey, readJsonCapped } from '../../_lib/guards';
import { guarded } from '../../_lib/ai';
import { rateLimit } from '../../_lib/ratelimit';
import { createSession, readSession, type Session } from '../../_lib/session/session';
import {
  BROWSER_COOKIE,
  ISSUER,
  cookieNamed,
  getClient,
  peekRequest,
  putCode,
  ready,
  takeRequest,
  type AuthRequest,
} from '../../_lib/oauth/store';

const reply = (data: unknown, cookie?: string) => {
  const headers = new Headers({ 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  if (cookie) headers.append('set-cookie', cookie);
  return new Response(JSON.stringify(data), { status: 200, headers });
};
const ended = () =>
  error(400, 'request-ended', 'This sign-in request has ended or expired. Start connecting again from your agent.');

/** The agent's redirect URI with the result, its state and our issuer (RFC 9207). */
function back(r: AuthRequest, result: Record<string, string>): string {
  const loc = new URL(r.redirectUri);
  for (const [k, v] of Object.entries(result)) loc.searchParams.set(k, v);
  if (r.state !== null) loc.searchParams.set('state', r.state);
  loc.searchParams.set('iss', ISSUER);
  return loc.href;
}

export const GET: Handler = (req, { env }) =>
  guarded(async () => {
    await ready(env);
    const now = Date.now();
    const r = await peekRequest(env, new URL(req.url).searchParams.get('request'), cookieNamed(req, BROWSER_COOKIE), now);
    if (!r) return ended();
    const client = await getClient(env, r.clientId);
    const session = env.SESSION_KEY ? await readSession(req, env, now) : null;
    return reply({ clientName: client?.clientName ?? null, hasSession: session !== null });
  });

export const POST: Handler = (req, { env }) =>
  guarded(async () => {
    if (!env.SESSION_KEY) return error(503, 'disabled', 'Sessions are not configured.');
    // JSON only: a cross-site form cannot send it without a CORS preflight this route never answers.
    if (!(req.headers.get('content-type') ?? '').toLowerCase().startsWith('application/json')) {
      return error(415, 'bad-request', 'Send the decision as JSON.');
    }
    await ready(env);
    const now = Date.now();
    const body = await readJsonCapped<{ request?: unknown; decision?: unknown } | null>(req, 4096);
    const decision = body?.decision;
    if (decision !== 'allow' && decision !== 'cancel') return error(400, 'bad-request', 'decision must be allow or cancel.');
    const browser = cookieNamed(req, BROWSER_COOKIE);

    if (decision === 'cancel') {
      const r = await takeRequest(env, body?.request, browser, now);
      return r ? reply({ redirect: back(r, { error: 'access_denied' }) }) : ended();
    }

    if (!(await peekRequest(env, body?.request, browser, now))) return ended();
    let session: Session | null = await readSession(req, env, now);
    let cookie: string | undefined;
    // New learners are limited exactly as POST /api/session limits them (shared buckets).
    if (
      !session &&
      (!(await rateLimit(env.DB, `sess:new:${clientKey(req, env)}`, now, 10, 600_000)) ||
        !(await rateLimit(env.DB, 'sess:new:g', now, 300, 600_000)))
    ) {
      return error(429, 'limited', 'Too many new sessions. Please wait a few minutes and try again.');
    }
    const r = await takeRequest(env, body?.request, browser, now);
    if (!r) return ended();
    if (!session) ({ session, cookie } = await createSession(env, now));
    const code = await putCode(env, r, { actorName: session.actorName, wpUserId: session.wpUserId ?? 0, registration: '' }, now);
    return reply({ redirect: back(r, { code }) }, cookie);
  });
