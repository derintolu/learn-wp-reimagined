// Record option 2 for /api/mcp (SERVER_FLAGS.agentOnStandard): the reference server's author-lrs custody, kept
// on our own LRS client (lrs/client.ts) and registration (record/registration.ts) rather than the vendored
// createAuthorLrsCustody's client, with the same documents and the same ETag rule: the learner's working state is
// the State document `cxm-learner-state` under their registration, beside the `cxm-current-registration`
// pointer getRegistration keeps, and a save under a new registration (restart_course) moves the pointer only if
// it still points where the caller last read it.
//
// Delivering does not post the engine's statements. They become the studio's events (agentEvents.ts), which
// decideEvents decides and records with the session (the official statements, built by official.ts, through the
// LRS outbox), so the studio and the agent are two front ends of one course server.
import { STATE_IDS, StoreConflictError, StoreError, type Custody, type LearnerRef } from '../../../vendor/course-xapi-mcp/core/index.ts';
import type { CourseModel } from '../../../vendor/course-xapi-mcp/core/model.ts';
import { newState } from '../../../vendor/course-xapi-mcp/core/session/index.ts';
import type { LearnerState } from '../../../vendor/course-xapi-mcp/core/state.ts';
import type { XapiAgent, XapiStatement } from '../../../vendor/course-xapi-mcp/core/xapi/types.ts';
import type { Env } from '../env';
import { getContent } from '../content';
import { decideEvents } from '../events/decide';
import { LrsClient, type StateKey } from '../lrs/client';
import { getRegistration } from '../record/registration';
import { OFFICIAL_COURSE_ID, officialActor } from '../record/official';
import type { Session } from '../session/session';
import { checkpointAnswers, eventsFor, refusedBranch } from './agentEvents';

/** Kept beside the engine's state in its State document: the checkpoint answers a later choose_branch records. */
const HOST_KEY = 'lwrAgent';
const NO_VERSION = "the record holder did not return a version for the learner's state";
const SIGNED_OUT = 'this sign-in no longer has a learner on this course; sign in again from the course site';

interface Tag {
  r: string;
  d: string;
}
const encode = (t: Tag) => JSON.stringify(t);
function decode(etag: string | undefined): Tag | undefined {
  if (etag === undefined) return undefined;
  try {
    const t = JSON.parse(etag) as Partial<Tag>;
    if (typeof t.r === 'string' && typeof t.d === 'string') return { r: t.r, d: t.d };
  } catch {
    // fall through
  }
  throw new StoreConflictError();
}

const isObj = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v);
const isForCourse = (s: XapiStatement, courseId: string) =>
  s.object.id === courseId || (s.context?.contextActivities?.grouping ?? []).some((a) => a.id === courseId);
const isVoiding = (s: XapiStatement) => s.verb.id === 'http://adlnet.gov/expapi/verbs/voided' && (s.object as { objectType?: string }).objectType === 'StatementRef';

/** The learner's most recently used studio session, which names their actor and caches their registration. */
export async function sessionForActor(env: Env, actorName: string): Promise<Session | null> {
  const row = await env.DB
    .prepare('SELECT sid_hash, actor_name, wp_user_id, created, touched FROM sessions WHERE actor_name = ? ORDER BY touched DESC LIMIT 1')
    .bind(actorName)
    .first<{ sid_hash: string; actor_name: string; wp_user_id: number | string | null; created: number | string; touched: number | string }>();
  if (!row) return null;
  return {
    sidHash: row.sid_hash,
    actorName: row.actor_name,
    wpUserId: row.wp_user_id == null ? null : Number(row.wp_user_id),
    createdAt: Number(row.created),
    touchedAt: Number(row.touched),
  };
}

export interface AgentCustodyOptions {
  course: CourseModel;
  /** The signed-in learner's session; null when it was erased after the token was issued. */
  session: Session | null;
  now?: () => number;
  /** The route's handler context, so recording drains the outbox as /api/events does. */
  handlerCtx?: unknown;
}

export function agentCustody(env: Env, o: AgentCustodyOptions): Custody & { actorFor(subject: string): Promise<XapiAgent> } {
  const { course, session } = o;
  const now = o.now ?? Date.now;
  const client = new LrsClient(env);
  /** What this request knows beyond the statements: the learner's files and checkpoint answers. */
  let files: Record<string, string> = {};
  let answers: Record<string, string> = {};

  const need = (): Session => {
    if (!session) throw new StoreError(SIGNED_OUT);
    return session;
  };
  const actor = (s: Session) => officialActor(s.actorName) as XapiAgent;
  const agentOf = (s: Session) => actor(s) as unknown as StateKey['agent'];
  const pointerKey = (s: Session): StateKey => ({ activityId: OFFICIAL_COURSE_ID, agent: agentOf(s), stateId: STATE_IDS.registration });
  const stateKey = (s: Session, registration: string): StateKey => ({ activityId: OFFICIAL_COURSE_ID, agent: agentOf(s), registration, stateId: STATE_IDS.learner });
  const versioned = (etag: string) => {
    if (!etag) throw new StoreError(NO_VERSION);
    return etag;
  };
  const seen = (state: LearnerState) => {
    files = { ...state.files };
  };

  /** Writes the state and its host fields; `ifMatch` replaces, without it the document must not exist yet. */
  async function put(s: Session, state: LearnerState, ifMatch?: string): Promise<string> {
    const put = await client.putState(stateKey(s, state.registration), { ...state, [HOST_KEY]: { answers } }, ifMatch);
    if ('conflict' in put) throw new StoreConflictError();
    return versioned(put.etag);
  }

  return {
    option: 'author-lrs',
    official: true,
    actorFor: async (subject) => officialActor(subject) as XapiAgent,

    async load() {
      if (!session) return {};
      const registration = await getRegistration(env, session);
      const doc = await client.getState(stateKey(session, registration));
      if (!doc || !isObj(doc.body)) {
        // Nothing kept yet: a fresh state on the learner's registration, so the engine and the official record agree.
        const state = newState(course, { now: () => new Date(now()).toISOString(), uuid: () => registration, actor: actor(session), custody: 'author-lrs', practice: false });
        seen(state);
        return { state };
      }
      const { [HOST_KEY]: host, ...state } = doc.body as Record<string, unknown>;
      const kept = isObj(host) && isObj(host.answers) ? host.answers : {};
      answers = Object.fromEntries(Object.entries(kept).filter((e): e is [string, string] => typeof e[1] === 'string'));
      seen(state as unknown as LearnerState);
      return { state: state as unknown as LearnerState, etag: encode({ r: registration, d: versioned(doc.etag) }) };
    },

    async save(_l, state, etag) {
      const s = need();
      // Refused before anything is kept, so the step is undone and the learner is still at the branch.
      const refused = refusedBranch(course, getContent(), state.outbox);
      if (refused) throw new StoreError(refused);
      seen(state);
      answers = { ...answers, ...checkpointAnswers(course, state.outbox) };
      const tag = decode(etag);
      const current = await getRegistration(env, s);
      if (tag && tag.r === state.registration) {
        // A call still on a registration that restart_course replaced must not keep writing to it.
        if (current !== tag.r) throw new StoreConflictError();
        return { etag: encode({ r: tag.r, d: await put(s, state, tag.d) }) };
      }
      if (tag && tag.r !== current) throw new StoreConflictError();
      if (state.registration === current) return { etag: encode({ r: current, d: await put(s, state) }) };

      // A new registration (restart_course): its document is new, then the pointer moves if it is still where it was.
      const d = await put(s, state);
      const pointer = await client.getState(pointerKey(s));
      if ((pointer?.body as { registration?: unknown } | undefined)?.registration !== current) throw new StoreConflictError();
      const moved = await client.putState(pointerKey(s), { registration: state.registration }, versioned(pointer!.etag));
      if ('conflict' in moved) throw new StoreConflictError();
      await env.DB.prepare('UPDATE sessions SET registration = ? WHERE actor_name = ?').bind(state.registration, s.actorName).run();
      return { etag: encode({ r: state.registration, d }) };
    },

    async deliver(_l, statements) {
      const s = need();
      const events = eventsFor(course, statements, { files, answers: { ...answers, ...checkpointAnswers(course, statements) } });
      if (events.length === 0) return;
      // A branch is the learner's choice (R34): no decision id, so decideEvents takes its fallback path (chosenBy learner).
      const results = await decideEvents(env, s.actorName, events, now(), { wpUserId: s.wpUserId, session: s, handlerCtx: o.handlerCtx });
      for (const r of results) if (!r.ok) console.warn('agent event refused', events.find((e) => e.eventId === r.eventId)?.type, r.error);
    },

    async record(l: LearnerRef) {
      const page = await client.getStatements({ agent: l.actor as unknown as StateKey['agent'] });
      const statements = (page.statements as unknown as XapiStatement[]).filter((st) => isForCourse(st, course.id) || isVoiding(st));
      return { official: true, statements, complete: page.more === undefined, note: "The course author's learning record store holds your official record." };
    },

    links() {
      return { holder: `${course.title} (the course author's learning record store)` };
    },
  };
}
