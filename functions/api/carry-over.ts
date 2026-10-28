// Carry over progress from the old local record into the official record (Task 37), behind
// SERVER_FLAGS.officialRecord. Each known completed lesson not already satisfied is waived (reason
// Administrative, result extension carried-over); the learner's files and resume position go to the LRS State
// documents. Old statements are never read from the body, let alone posted. Once per actor: the claim is a D1 row.
import type { Handler } from '../_lib/env';
import { error, json } from '../_lib/http';
import { readJsonCapped } from '../_lib/guards';
import { guarded } from '../_lib/ai';
import { ensureRecordSchema, isDuplicateKey } from '../_lib/db';
import { SERVER_FLAGS } from '../_lib/config';
import { getContent } from '../_lib/content';
import { refreshContent } from '../_lib/course/cache';
import { readSession } from '../_lib/session/session';
import { LrsClient, LrsError, LrsUnavailable, type StateKey } from '../_lib/lrs/client';
import { drainAfterDecide, enqueue, INLINE_DRAIN_BUDGET_MS } from '../_lib/lrs/outbox';
import { getRegistration } from '../_lib/record/registration';
import { OFFICIAL_COURSE_ID, auIdOf, carriedOverStatement, officialActor } from '../_lib/record/official';
import { claimOnce, satisfiedElsewhere } from '../_lib/record/shadow';
import { activityIds } from '../../vendor/course-xapi-mcp/core/constants';

export const CARRY_OVER_MAX_BYTES = 512 * 1024;
const MAX_LESSONS = 200;
const MAX_FILES = 200;
const MAX_FILE_NAME = 200;
export const STATE_FILES = 'lwr-files';
export const STATE_RESUME = 'lwr-resume';

const has = (o: object, k: string) => Object.prototype.hasOwnProperty.call(o, k);
const bad = (msg: string) => error(400, 'bad-request', msg);

/** Writes a learner-wide State document, replacing one that is there (the LRS PUT is create-only without an ETag). */
async function putStateDoc(client: LrsClient, key: StateKey, body: unknown): Promise<void> {
  const put = await client.putState(key, body);
  if (!('conflict' in put)) return;
  const existing = await client.getState(key);
  const again = await client.putState(key, body, existing?.etag ?? '*');
  if ('conflict' in again) throw new LrsError(412, 'the LRS state document changed while it was being written');
}

export const POST: Handler = (req, ctx) =>
  guarded(async () => {
    const { env } = ctx;
    if (!SERVER_FLAGS.officialRecord) return error(404, 'not-found', 'Not found.');
    const now = Date.now();
    const session = await readSession(req, env, now);
    if (!session) return error(401, 'no-session', 'Start a session first.');

    const body = await readJsonCapped<unknown>(req, CARRY_OVER_MAX_BYTES);
    const b = body && typeof body === 'object' ? (body as Record<string, unknown>) : null;
    if (!b || !Array.isArray(b.completedLessons) || b.completedLessons.length > MAX_LESSONS || !b.completedLessons.every((l) => typeof l === 'string')) {
      return bad('completedLessons must be a list of lesson ids.');
    }
    const files = b.files ?? {};
    if (
      !files || typeof files !== 'object' || Array.isArray(files) ||
      Object.keys(files).length > MAX_FILES ||
      !Object.entries(files).every(([k, v]) => k.length > 0 && k.length <= MAX_FILE_NAME && typeof v === 'string')
    ) {
      return bad('files must map file names to text.');
    }
    const cur = b.current as Record<string, unknown> | undefined;
    if (cur !== undefined && (!cur || typeof cur !== 'object' || typeof cur.pathId !== 'string' || typeof cur.lessonId !== 'string' || !Number.isInteger(cur.beatIndex) || (cur.beatIndex as number) < 0)) {
      return bad('current must name a path, a lesson and a beat.');
    }

    await refreshContent(env);
    const bundle = getContent();
    const lessons = [...new Set(b.completedLessons as string[])].filter((l) => has(bundle.lessons, l));
    const resume =
      cur && has(bundle.paths, cur.pathId as string) && has(bundle.lessons, cur.lessonId as string)
        ? { pathId: cur.pathId, lessonId: cur.lessonId, beatIndex: cur.beatIndex }
        : null;

    await ensureRecordSchema(env.DB);
    try {
      await env.DB.prepare('INSERT INTO carry_overs (actor_name, created) VALUES (?, ?)').bind(session.actorName, now).run();
    } catch (e) {
      if (!isDuplicateKey(e)) throw e;
      return error(409, 'already-carried', 'Your progress was already brought over.');
    }

    try {
      const deadline = Date.now() + INLINE_DRAIN_BUDGET_MS;
      const registration = await getRegistration(env, session);
      const actor = officialActor(session.actorName);
      const eventId = `carry-over:${session.actorName}`;
      const waived: string[] = [];
      const statements = [];
      for (const lessonId of lessons) {
        const s = await carriedOverStatement({ actor, registration }, session.actorName, lessonId, now);
        if (await satisfiedElsewhere(env, session.actorName, registration, activityIds.au(auIdOf(lessonId)), bundle, eventId)) continue;
        if (!(await claimOnce(env, session.actorName, registration, s, eventId))) continue;
        statements.push(s);
        waived.push(lessonId);
      }
      const client = new LrsClient(env);
      const key = (stateId: string): StateKey => ({ activityId: OFFICIAL_COURSE_ID, agent: actor as StateKey['agent'], stateId });
      if (Object.keys(files).length > 0) await putStateDoc(client, key(STATE_FILES), files);
      if (resume) await putStateDoc(client, key(STATE_RESUME), resume);
      await enqueue(env, statements, now);
      await drainAfterDecide(ctx, env, now, deadline);
      return json({ waived });
    } catch (e) {
      // Release the claim: the learner can try again, and every id here is deterministic, so a retry is identical.
      await env.DB.prepare('DELETE FROM carry_overs WHERE actor_name = ?').bind(session.actorName).run();
      if (e instanceof LrsUnavailable) return error(503, 'lrs-unavailable', 'The learning record is unavailable right now. Please try again shortly.');
      if (e instanceof LrsError) return error(502, 'carry-over-failed', 'Your progress could not be brought over yet. Nothing was lost; please try again shortly.');
      throw e;
    }
  });
