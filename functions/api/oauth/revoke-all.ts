// POST /api/oauth/revoke-all: "Disconnect agents". Ends every agent token of the studio session's learner.
import type { Handler } from '../../_lib/env';
import { error, json } from '../../_lib/http';
import { guarded } from '../../_lib/ai';
import { readSession } from '../../_lib/session/session';
import { revokeAllForActor } from '../../_lib/oauth/store';

export const POST: Handler = (req, { env }) =>
  guarded(async () => {
    if (!env.SESSION_KEY) return error(503, 'disabled', 'Sessions are not configured.');
    const session = await readSession(req, env, Date.now());
    if (!session) return error(401, 'no-session', 'There is no learner in this browser.');
    return json({ revoked: await revokeAllForActor(env, session.actorName) });
  });
