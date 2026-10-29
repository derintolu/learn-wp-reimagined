// One cmi5 registration per learner for the program (all three paths), as the standard's option 2 keeps it:
// a learner-wide State document `cxm-current-registration` on the course activity, holding `{ registration }`
// (the reference author-lrs custody's pointer). The LRS is authoritative; sessions.registration caches it.
import type { Env } from '../env';
import { ensureRecordSchema } from '../db';
import { LrsClient, LrsError, LrsUnavailable, type StateKey } from '../lrs/client';
import { cacheRegistration, cachedRegistration, type Session } from '../session/session';
import { STATE_IDS } from '../../../vendor/course-xapi-mcp/core/constants';
import { OFFICIAL_COURSE_ID, officialActor } from './official';

/** After the LRS is unavailable for a registration, lookups on the request path are skipped this long. */
export const REGISTRATION_RETRY_MS = 60_000;
/** Per isolate: until when the request path skips the LRS lookup. */
export const lrsHealth = { downUntil: 0 };

const registrationIn = (doc: { body: unknown } | null): string | undefined => {
  const r = (doc?.body as { registration?: unknown } | undefined)?.registration;
  return typeof r === 'string' && r.length > 0 && r.length <= 36 ? r : undefined;
};

/** Reads the learner's registration from the LRS, minting and storing one if there is none, and caches it. */
async function fetchRegistration(env: Env, s: Session): Promise<string> {
  const client = new LrsClient(env);
  const key: StateKey = { activityId: OFFICIAL_COURSE_ID, agent: officialActor(s.actorName) as StateKey['agent'], stateId: STATE_IDS.registration };
  let registration = registrationIn(await client.getState(key));
  if (!registration) {
    const minted = crypto.randomUUID();
    // Create-only, so two first calls agree on one registration.
    const put = await client.putState(key, { registration: minted });
    registration = 'conflict' in put ? registrationIn(await client.getState(key)) : minted;
    if (!registration) throw new LrsError(412, 'the LRS holds no readable registration for this learner');
  }
  await cacheRegistration(env, s, registration);
  return registration;
}

/**
 * The learner's registration: cached on the session, else read from the LRS, else minted and stored there.
 * Throws LrsUnavailable or LrsError when the LRS cannot say.
 */
export async function getRegistration(env: Env, s: Session): Promise<string> {
  await ensureRecordSchema(env.DB);
  return (await cachedRegistration(env, s)) ?? fetchRegistration(env, s);
}

/** A bounded lookup: the registration, or null; `later` is a lookup still running at the deadline. */
export interface BoundedRegistration {
  registration: string | null;
  later?: Promise<string | null>;
}

/**
 * getRegistration bounded for the request path. The registration is null when the LRS is unavailable (then
 * lookups are skipped for REGISTRATION_RETRY_MS) or refuses, or has not answered by `deadline`. A late lookup
 * is not an outage (ruling R52): it goes on as `later`, caches what it finds, and marks the LRS down only if it
 * ends unavailable. The caller keeps it alive (waitUntil) or leaves it.
 */
export async function registrationWithin(env: Env, s: Session, deadline: number): Promise<BoundedRegistration> {
  await ensureRecordSchema(env.DB);
  const cached = await cachedRegistration(env, s);
  if (cached) return { registration: cached };
  if (Date.now() < lrsHealth.downUntil) return { registration: null };
  const lookup = fetchRegistration(env, s).catch((e: unknown) => {
    if (e instanceof LrsUnavailable) {
      lrsHealth.downUntil = Date.now() + REGISTRATION_RETRY_MS;
      return null;
    }
    if (e instanceof LrsError) {
      console.error('official record skipped: no registration', e.message);
      return null;
    }
    throw e;
  });
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<'late'>((resolve) => (timer = setTimeout(() => resolve('late'), Math.max(0, deadline - Date.now()))));
  const r = await Promise.race([lookup, late]);
  clearTimeout(timer);
  if (r !== 'late') return { registration: r };
  lookup.catch(() => {});
  return { registration: null, later: lookup };
}
