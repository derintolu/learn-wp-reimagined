// GET/PUT /api/state/:kind (kind: files | resume): the learner's files and resume position as State documents
// on the course activity, under the learner's registration. PUT passes If-Match; 412 means someone else wrote first.
import type { Handler } from '../_lib/env';
import { error, json, HttpError } from '../_lib/http';
import { clientKey, readJsonCapped } from '../_lib/guards';
import { guarded } from '../_lib/ai';
import { ensureSchema } from '../_lib/db';
import { rateLimit } from '../_lib/ratelimit';
import { readSession } from '../_lib/session/session';
import { LrsClient, LrsError, LrsUnavailable, type StateKey } from '../_lib/lrs/client';
import { getRegistration } from '../_lib/record/registration';
import { OFFICIAL_COURSE_ID, officialActor } from '../_lib/record/official';
import { STATE_ID, STATE_KINDS, STATE_MAX_BYTES, parseFilesDoc, parseResumeDoc, type StateKind } from '../../src/shared/stateDoc';

export { STATE_MAX_BYTES };

const kindOf = (req: Request, params: Record<string, string>): StateKind | null => {
  const k = params.kind ?? new URL(req.url).pathname.replace(/\/+$/, '').split('/').pop();
  return STATE_KINDS.find((x) => x === k) ?? null;
};

/** Everything both methods share; a Response is the refusal to return. */
async function open(req: Request, ctx: Parameters<Handler>[1]): Promise<Response | { kind: StateKind; key: StateKey; client: LrsClient }> {
  const { env } = ctx;
  const kind = kindOf(req, ctx.params);
  if (!kind) return error(404, 'not-found', 'No such route.');
  await ensureSchema(env.DB);
  const now = Date.now();
  const session = await readSession(req, env, now);
  if (!session) return error(401, 'no-session', 'Start a session first.');
  if (!(await rateLimit(env.DB, `state:${clientKey(req, env)}`, now, 120, 600_000))) {
    return error(429, 'rate-limited', 'You are going a little fast. Please wait a few minutes and try again.');
  }
  const registration = await getRegistration(env, session);
  const key: StateKey = { activityId: OFFICIAL_COURSE_ID, agent: officialActor(session.actorName) as StateKey['agent'], registration, stateId: STATE_ID[kind] };
  return { kind, key, client: new LrsClient(env) };
}

const lrsFailure = (e: unknown): Response => {
  if (e instanceof LrsUnavailable) return error(503, 'unavailable', 'The record service is not answering. Your files are still saved in this browser.');
  if (e instanceof LrsError) return error(502, 'lrs-error', 'The record service refused that request.');
  if (e instanceof HttpError) return error(e.status, e.code, e.message);
  throw e;
};

export const GET: Handler = (req, ctx) =>
  guarded(async () => {
    try {
      const o = await open(req, ctx);
      if (o instanceof Response) return o;
      const got = await o.client.getState(o.key);
      return json({ doc: got ? got.body : null, etag: got ? got.etag : null });
    } catch (e) {
      return lrsFailure(e);
    }
  });

export const PUT: Handler = (req, ctx) =>
  guarded(async () => {
    try {
      const o = await open(req, ctx);
      if (o instanceof Response) return o;
      const body = await readJsonCapped<unknown>(req, STATE_MAX_BYTES);
      if (!(o.kind === 'files' ? parseFilesDoc(body) : parseResumeDoc(body))) return error(400, 'bad-request', 'That is not a valid state document.');
      const ifMatch = req.headers.get('If-Match') ?? undefined;
      const put = await o.client.putState(o.key, body, ifMatch);
      if ('conflict' in put) return error(412, 'conflict', 'Another writer saved first. Fetch the document again and retry.');
      return json({ etag: put.etag });
    } catch (e) {
      return lrsFailure(e);
    }
  });
