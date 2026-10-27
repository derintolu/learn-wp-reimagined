import { FEATURES } from '../config';
import { getEventClient } from './eventClient';
import { getRecordManager } from './useRecord';

export interface SessionActor {
  homePage: string;
  name: string;
}

/** How long a session request waits before the studio carries on without one. */
const SESSION_TIMEOUT_MS = 8000;

let actor: SessionActor | null = null;
let inflight: Promise<SessionActor | null> | null = null;
/** Bumped when the session is forgotten, so an answer that was already on its way can't bring it back. */
let generation = 0;

const isActor = (a: unknown): a is SessionActor =>
  !!a && typeof (a as SessionActor).homePage === 'string' && typeof (a as SessionActor).name === 'string';

async function call(method: 'GET' | 'POST' | 'DELETE'): Promise<Response | null> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), SESSION_TIMEOUT_MS);
  try {
    return await fetch('/api/session', { method, signal: ctl.signal });
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function readActor(res: Response | null): Promise<SessionActor | null | undefined> {
  if (!res || !res.ok) return undefined;
  try {
    const j = (await res.json()) as { actor?: unknown };
    return isActor(j.actor) ? j.actor : null;
  } catch {
    return undefined;
  }
}

/**
 * The learner's session, made on first use. The cookie is HttpOnly, so the studio asks the server
 * (GET) for the session it may already have and only makes a new one (POST) when there is none.
 * Concurrent callers share one request. Null when sessions are off, rate-limited, unavailable or
 * unreachable; nothing is remembered about a failure, so the next recorded action tries again.
 */
export function ensureSession(): Promise<SessionActor | null> {
  if (!FEATURES.sessions) return Promise.resolve(null);
  if (actor) return Promise.resolve(actor);
  inflight ??= (async () => {
    const gen = generation;
    try {
      let found = await readActor(await call('GET'));
      if (found === undefined) return null;
      if (found === null) {
        found = await readActor(await call('POST'));
        if (!found) return null;
      }
      if (gen === generation) actor = found;
      return gen === generation ? found : null;
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

/** The session the studio has, without asking the server. */
export function currentActor(): SessionActor | null {
  return actor;
}

/** Forget the session held here (the cookie is the server's to clear), so the next send asks again. */
export function forgetSession(): void {
  actor = null;
  inflight = null;
  generation++;
}

/** For tests. */
export const resetSession = forgetSession;

/**
 * Delete the learner's data: the server first, and only when it confirms, the record in this
 * browser and any events still waiting to be sent. False means nothing was changed.
 */
export async function deleteMyData(): Promise<boolean> {
  const res = await call('DELETE');
  if (!res || !res.ok) return false;
  forgetSession();
  getEventClient().discard();
  await getRecordManager().reset();
  return true;
}
