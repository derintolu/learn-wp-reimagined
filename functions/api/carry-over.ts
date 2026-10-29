// Carry over progress from the old local record into the official record (Task 37). Each known completed lesson not already satisfied is waived (reason
// Administrative, result extension carried-over); the learner's files and resume position are merged into the
// studio's own State documents (/api/state: lwr-files and lwr-resume under the registration). Old statements are never read from the body, let alone posted. Once per actor: the claim is a D1 row.
import type { Handler } from '../_lib/env';
import { error, json } from '../_lib/http';
import { readJsonCapped } from '../_lib/guards';
import { guarded } from '../_lib/ai';
import { ensureRecordSchema, isDuplicateKey } from '../_lib/db';
import { getContent } from '../_lib/content';
import { refreshContent } from '../_lib/course/cache';
import { readSession } from '../_lib/session/session';
import { LrsClient, LrsError, LrsUnavailable, type StateKey } from '../_lib/lrs/client';
import { drainAfterDecide, enqueue, INLINE_DRAIN_BUDGET_MS } from '../_lib/lrs/outbox';
import { getRegistration } from '../_lib/record/registration';
import { OFFICIAL_COURSE_ID, auIdOf, carriedOverStatement, officialActor } from '../_lib/record/official';
import { claimOnce, satisfiedElsewhere } from '../_lib/record/shadow';
import { activityIds } from '../../vendor/course-xapi-mcp/core/constants';
import { STATE_ID, mergeFilesDocs, parseFilesDoc, parseResumeDoc, type FilesDoc, type ResumeDoc, type StateKind } from '../../src/shared/stateDoc';

export const CARRY_OVER_MAX_BYTES = 512 * 1024;
const MAX_LESSONS = 200;
const MAX_FILES = 200;
const MAX_FILE_NAME = 200;
const WRITE_TRIES = 3;

const has = (o: object, k: string) => Object.prototype.hasOwnProperty.call(o, k);
const bad = (msg: string) => error(400, 'bad-request', msg);

/**
 * Writes one of the studio's State documents (the ones GET /api/state reads) by merging into what is there, with
 * If-Match and a fresh read on 412. `merge` gets the parsed document there, or null when there is none.
 */
async function mergeStateDoc<T>(client: LrsClient, key: StateKey, parse: (v: unknown) => T | null, merge: (there: T | null) => T | null): Promise<void> {
  for (let i = 0; i < WRITE_TRIES; i++) {
    const got = await client.getState(key);
    const body = merge(got ? parse(got.body) : null);
    if (body === null) return;
    const put = await client.putState(key, body, got ? got.etag : undefined);
    if (!('conflict' in put)) return;
  }
  throw new LrsError(412, 'the LRS state document changed while it was being written');
}

export const POST: Handler = (req, ctx) =>
  guarded(async () => {
    const { env } = ctx;
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
      // The studio's documents under the learner's registration, as /api/state keeps them. The old record's files
      // carry no edit time, so a file the studio already synced keeps its (newer) edit; a resume position the
      // studio already keeps is newer than the old record's too.
      const key = (kind: StateKind): StateKey => ({ activityId: OFFICIAL_COURSE_ID, agent: actor as StateKey['agent'], registration, stateId: STATE_ID[kind] });
      if (Object.keys(files).length > 0) {
        const carried: FilesDoc = { files: files as Record<string, string> };
        await mergeStateDoc(client, key('files'), parseFilesDoc, (there) => (there ? mergeFilesDocs(there, carried) : carried));
      }
      if (resume) {
        const carried: ResumeDoc = { current: resume as ResumeDoc['current'], updatedAt: new Date(now).toISOString() };
        await mergeStateDoc(client, key('resume'), parseResumeDoc, (there) => (there ? null : carried));
      }
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
