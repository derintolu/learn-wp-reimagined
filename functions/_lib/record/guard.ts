import type { Handler } from '../env';
import { error } from '../http';
import { LrsError, LrsUnavailable } from '../lrs/client';
import { readSession, type Session } from '../session/session';
import { loadCurrentCourse } from '../course/cache';

type Ctx = Parameters<Handler>[1];

/** The current course is loaded first. No session: 401. LRS trouble: 503 or 502. */
export async function recordRoute(req: Request, ctx: Ctx, run: (s: Session) => Promise<Response>): Promise<Response> {
  await loadCurrentCourse(ctx.env);
  const session = await readSession(req, ctx.env, Date.now());
  if (!session) return error(401, 'no-session', 'Start a session first.');
  try {
    return await run(session);
  } catch (e) {
    if (e instanceof LrsUnavailable) return error(503, 'record-unavailable', 'The record store is not answering. Try again shortly.');
    if (e instanceof LrsError) return error(502, 'record-error', 'The record store could not give your record.');
    throw e;
  }
}
