import type { Handler } from '../_lib/env';
import { error, json } from '../_lib/http';
import { clientKey, readJsonCapped } from '../_lib/guards';
import { guarded } from '../_lib/ai';
import { ensureSchema } from '../_lib/db';
import { rateLimit } from '../_lib/ratelimit';
import { SERVER_FLAGS } from '../_lib/config';
import { readSession } from '../_lib/session/session';
import { decideEvents } from '../_lib/events/decide';
import { EVENTS_MAX_BYTES, parseEvents } from '../../src/shared/events';

export const POST: Handler = (req, { env }) =>
  guarded(async () => {
    if (!SERVER_FLAGS.serverEvents) return error(503, 'disabled', 'Server events are switched off.');
    await ensureSchema(env.DB);
    const now = Date.now();
    if (!(await rateLimit(env.DB, `events:${clientKey(req, env)}`, now, 120, 600_000))) {
      return error(429, 'rate-limited', 'You are going a little fast. Please wait a few minutes and try again.');
    }
    const body = await readJsonCapped<unknown>(req, EVENTS_MAX_BYTES);
    const session = await readSession(req, env, now);
    if (!session && SERVER_FLAGS.sessions && env.SESSION_KEY) {
      return error(401, 'no-session', 'Start a session first.');
    }
    // The session names the actor; the body learnerId is ignored (a placeholder satisfies the parser).
    const parsed = parseEvents(
      session && body && typeof body === 'object' ? { ...(body as object), learnerId: crypto.randomUUID() } : body,
    );
    if (!parsed.ok) return error(400, 'bad-request', parsed.error);
    const actor = session ? session.actorName : parsed.learnerId;
    try {
      return json({ results: await decideEvents(env, actor, parsed.events, now, { wpUserId: session?.wpUserId ?? null }) });
    } catch (e) {
      console.error('events failed', (e as Error)?.message);
      throw e;
    }
  });
