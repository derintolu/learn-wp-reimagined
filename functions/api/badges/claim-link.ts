// POST /api/badges/claim-link { badge }: a fresh claim link for one of the session's pending badges (Task 49).
// The LRS makes the link single use and replaces the previous one; it is returned once
// and never stored here.
import type { Handler } from '../../_lib/env';
import { error, json } from '../../_lib/http';
import { guarded } from '../../_lib/ai';
import { readJsonCapped } from '../../_lib/guards';
import { LRS_API } from '../../_lib/config';
import { LrsClient, LrsError, LrsUnavailable } from '../../_lib/lrs/client';
import { officialActor } from '../../_lib/record/official';
import { readSession } from '../../_lib/session/session';
import { lrsDown, needSession } from '../badges';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LRS_ORIGIN = new URL(LRS_API).origin;

export const POST: Handler = (req, { env }) =>
  guarded(async () => {
    const session = await readSession(req, env, Date.now());
    if (!session) return needSession();
    const body = await readJsonCapped<{ badge?: unknown } | null>(req, 1024);
    const badge = body?.badge;
    if (typeof badge !== 'string' || !UUID.test(badge)) return error(400, 'bad-request', 'Send the badge id.');
    try {
      const url = await new LrsClient(env).mintClaimLink(officialActor(session.actorName) as never, badge.toLowerCase());
      let ok = false;
      try {
        const u = new URL(url);
        ok = u.origin === LRS_ORIGIN && u.protocol === 'https:';
      } catch {
        // not a URL
      }
      if (!ok) return error(502, 'bad-link', 'The claim link could not be made.');
      const res = json({ url });
      res.headers.set('cache-control', 'no-store');
      return res;
    } catch (e) {
      if (e instanceof LrsUnavailable) return lrsDown();
      if (e instanceof LrsError) {
        if (e.status === 404) return error(404, 'no-badge', 'That badge is not yours to claim.');
        if (e.status === 409) return error(409, 'not-pending', 'That badge is already claimed.');
        return lrsDown();
      }
      throw e;
    }
  });
