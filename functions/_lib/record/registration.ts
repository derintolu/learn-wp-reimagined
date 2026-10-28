// One cmi5 registration per learner for the program (all three paths), as the standard's option 2 keeps it:
// a learner-wide State document `cxm-current-registration` on the course activity, holding `{ registration }`
// (the reference author-lrs custody's pointer). The LRS is authoritative; sessions.registration caches it.
import type { Env } from '../env';
import { ensureRecordSchema } from '../db';
import { LrsClient, LrsError, type StateKey } from '../lrs/client';
import { cacheRegistration, cachedRegistration, type Session } from '../session/session';
import { STATE_IDS } from '../../../vendor/course-xapi-mcp/core/constants';
import { OFFICIAL_COURSE_ID, officialActor } from './official';

const registrationIn = (doc: { body: unknown } | null): string | undefined => {
  const r = (doc?.body as { registration?: unknown } | undefined)?.registration;
  return typeof r === 'string' && r.length > 0 && r.length <= 36 ? r : undefined;
};

/**
 * The learner's registration: cached on the session, else read from the LRS, else minted and stored there
 * (create-only, so two first calls agree on one). Throws LrsUnavailable or LrsError when the LRS cannot say.
 */
export async function getRegistration(env: Env, s: Session): Promise<string> {
  await ensureRecordSchema(env.DB);
  const cached = await cachedRegistration(env, s);
  if (cached) return cached;
  const client = new LrsClient(env);
  const key: StateKey = { activityId: OFFICIAL_COURSE_ID, agent: officialActor(s.actorName) as StateKey['agent'], stateId: STATE_IDS.registration };
  let registration = registrationIn(await client.getState(key));
  if (!registration) {
    const minted = crypto.randomUUID();
    const put = await client.putState(key, { registration: minted });
    registration = 'conflict' in put ? registrationIn(await client.getState(key)) : minted;
    if (!registration) throw new LrsError(412, 'the LRS holds no readable registration for this learner');
  }
  await cacheRegistration(env, s, registration);
  return registration;
}
