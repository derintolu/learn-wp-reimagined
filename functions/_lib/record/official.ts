// The official record: cmi5 statements built with the vendored standard's builder (course-xapi-mcp core),
// after the course server has decided an event. Activity IRIs follow the design's §5.3 scheme: the course is
// `${XAPI_BASE}/activities/course`, each path's block `…/activities/paths/<id>`, each lesson's AU id
// `…/activities/lessons/<id>` (today's lesson IRI) and its activity id `{au@id}/au`.
import type { Env } from '../env';
import { deriveStatementId } from '../events/ids';
import { validatePlacement } from '../../../src/shared/engine';
import type { EventResult, ServerEvent } from '../../../src/shared/events';
import type { ContentBundle } from '../../../src/shared/types';
import { EXT_CHOSEN_BY, XAPI_BASE, activityId } from '../../../src/shared/xapi';
import { CXM_EXT, DEFAULTS, activityIds } from '../../../vendor/course-xapi-mcp/core/constants';
import { RULES_VERSION } from '../../../vendor/course-xapi-mcp/core/rules';
import { buildAllowed, buildDefined, type AuTarget, type Cmi5Context } from '../../../vendor/course-xapi-mcp/core/xapi/build';
import { isoDuration } from '../../../vendor/course-xapi-mcp/core/xapi/duration';
import type { ActivityKind, AllowedVerb, DefinedVerb, XapiAgent, XapiResult, XapiStatement } from '../../../vendor/course-xapi-mcp/core/xapi/types';

export type Actor = XapiAgent;

/** Official statement n of an event is deriveStatementId(eventId, OFFICIAL_ID_OFFSET + n); phase 1 uses 0 to 2. */
export const OFFICIAL_ID_OFFSET = 100;
export const OFFICIAL_COURSE_ID = activityId(['course']);
export const PLACEMENT_AU_KEY = 'placement';
export const AU_IDLE_MS = DEFAULTS.sessionIdleMs;
const LANGUAGE = 'en-US';

// Fixed slots, so a statement keeps its id whichever of the others an attempt of the same event emits.
const SLOT_SESSION = 0;
const SLOT_TERMINATE_REPLACED = 1;
const SLOT_LAUNCHED = 2;
const SLOT_INITIALIZED = 3;
const SLOT_BODY = 4;
/** A waiver's own LMS-role session id: deriveStatementId(eventId, OFFICIAL_ID_OFFSET + WAIVER_SESSION + slot). */
const WAIVER_SESSION = 200;

const CMI5_LAUNCH_EXT = {
  launchMode: 'https://w3id.org/xapi/cmi5/context/extensions/launchmode',
  launchUrl: 'https://w3id.org/xapi/cmi5/context/extensions/launchurl',
  moveOn: 'https://w3id.org/xapi/cmi5/context/extensions/moveon',
} as const;

const has = (o: object, k: string) => Object.prototype.hasOwnProperty.call(o, k);

/** The cmi5 publisher AU id (`au@id`) of a lesson, or of the placement AU. */
export const auIdOf = (key: string) => (key === PLACEMENT_AU_KEY ? activityId([PLACEMENT_AU_KEY]) : activityId(['lessons', key]));
const blockIdOf = (pathId: string) => activityId(['paths', pathId]);
const target = (key: string): AuTarget => ({ publisherId: auIdOf(key), activityId: activityIds.au(auIdOf(key)) });

/** The learner as the official record names them: the session's actor under the site's identity base. */
export const officialActor = (actorName: string): Actor => ({ objectType: 'Agent', account: { homePage: XAPI_BASE, name: actorName } });

/** The learner's open cmi5 AU session at this event. `last` is this event's time. */
export interface AuSession {
  auKey: string;
  sessionId: string;
  started: number;
  last: number;
  /** True when this event opens the session (it sends launched and initialized). */
  isNew: boolean;
  /** An open session on another AU that this event ends with terminated. */
  replaced?: { auKey: string; sessionId: string; started: number };
}

export interface OfficialContext {
  actor: Actor;
  registration: string;
  bundle: ContentBundle;
  auSession: AuSession;
}

function cmi5(ctx: { actor: Actor; registration: string }, sessionId: string): Cmi5Context {
  return {
    actor: ctx.actor,
    registration: ctx.registration,
    sessionId,
    courseId: OFFICIAL_COURSE_ID,
    language: LANGUAGE,
    rulesVersion: RULES_VERSION,
    custody: 'author-lrs',
    practice: false,
  };
}

/** Lessons strictly between `from` and `to` in the path, when `to` is further ahead. */
function jumpedOver(bundle: ContentBundle, from: string, to: string): string[] {
  const lessons = bundle.paths[bundle.lessons[from].pathId].lessons;
  const i = lessons.indexOf(from);
  const j = lessons.indexOf(to);
  return i >= 0 && j > i + 1 ? lessons.slice(i + 1, j) : [];
}

/** The deterministic session id an event would give the AU session it opens. */
export const sessionIdFor = (eventId: string) => deriveStatementId(eventId, OFFICIAL_ID_OFFSET + SLOT_SESSION);

/**
 * The official statements for one decided event, in order: terminated for a replaced session, launched and
 * initialized for a new one, then the event's own. cmi5 defined statements sit on `{au@id}/au`; allowed ones
 * carry the standard's profile category with the AU as parent. Ids come from deriveStatementId(eventId, n),
 * offset past the phase 1 ids; timestamps from the event's time, 1 ms apart. Whether a defined completed,
 * passed or waived was already sent in this registration is the caller's concern.
 */
export async function buildOfficial(ctx: OfficialContext, e: ServerEvent, r: Extract<EventResult, { ok: true }>): Promise<XapiStatement[]> {
  const { bundle, auSession: au } = ctx;
  const out: XapiStatement[] = [];
  const opts = async (slot: number) => ({
    id: await deriveStatementId(e.eventId, OFFICIAL_ID_OFFSET + slot),
    timestamp: new Date(au.last + slot).toISOString(),
  });
  const since = (started: number) => isoDuration(Math.max(0, au.last - started));
  const defined = async (slot: number, verb: DefinedVerb, key: string, sessionId: string, o: { duration?: string; reason?: 'Tested Out' } = {}) => {
    const s = buildDefined(cmi5(ctx, sessionId), verb, { au: target(key) }, { ...(await opts(slot)), ...o });
    out.push(s);
    return s;
  };
  const allowed = async (slot: number, verb: AllowedVerb, object: { id: string; kind: ActivityKind; name: string }, result?: XapiResult) => {
    out.push(buildAllowed(cmi5(ctx, au.sessionId), verb, object, target(au.auKey), { ...(await opts(slot)), result }));
  };

  if (au.replaced) {
    await defined(SLOT_TERMINATE_REPLACED, 'terminated', au.replaced.auKey, au.replaced.sessionId, { duration: since(au.replaced.started) });
  }
  if (au.isNew) {
    const launched = await defined(SLOT_LAUNCHED, 'launched', au.auKey, au.sessionId);
    const lesson = has(bundle.lessons, au.auKey) ? bundle.lessons[au.auKey] : undefined;
    launched.context.extensions = {
      ...launched.context.extensions,
      [CMI5_LAUNCH_EXT.launchMode]: 'Normal',
      [CMI5_LAUNCH_EXT.launchUrl]: lesson ? `${XAPI_BASE}/learn/${encodeURIComponent(lesson.id)}` : `${XAPI_BASE}/`,
      [CMI5_LAUNCH_EXT.moveOn]: lesson ? (lesson.checkpoint ? 'CompletedAndPassed' : 'Completed') : 'NotApplicable',
    };
    await defined(SLOT_INITIALIZED, 'initialized', au.auKey, au.sessionId);
  }

  let slot = SLOT_BODY;
  const waive = async (keys: string[]) => {
    for (const k of keys) {
      const s = slot++;
      const sessionId = await deriveStatementId(e.eventId, OFFICIAL_ID_OFFSET + WAIVER_SESSION + s);
      await defined(s, 'waived', k, sessionId, { reason: 'Tested Out' });
    }
  };

  if (e.type === 'placed') {
    const v = validatePlacement(bundle, e.placement);
    if (!v.ok) return out;
    const p = v.placement;
    await allowed(slot++, 'placed', { id: blockIdOf(p.pathId), kind: 'path', name: bundle.paths[p.pathId].title }, {
      response: p.reason,
      extensions: { [CXM_EXT['start-lesson']]: auIdOf(p.startLessonId), [CXM_EXT.skipped]: p.skip.map(auIdOf) },
    });
    await defined(slot++, 'terminated', au.auKey, au.sessionId, { duration: since(au.started) });
    await waive(p.skip);
    return out;
  }

  const lesson = bundle.lessons[e.lessonId];
  const title = lesson.title;
  switch (e.type) {
    case 'lessonOpened':
      break;
    case 'lessonLeft':
      await defined(slot++, 'terminated', au.auKey, au.sessionId, { duration: since(au.started) });
      break;
    case 'beatViewed': {
      const beat = lesson.beats[e.beatIndex];
      await allowed(slot++, 'experienced', { id: activityIds.beat(auIdOf(lesson.id), beat.id), kind: 'beat', name: `${title}: ${beat.id}` });
      break;
    }
    case 'codeSubmitted': {
      const file = { id: activityIds.file(auIdOf(lesson.id), e.file), kind: 'file' as const, name: `${title}: ${e.file}` };
      if (e.target === 'bug' && r.passed && lesson.bug) {
        await allowed(slot++, 'caught', { id: activityIds.bug(auIdOf(lesson.id), lesson.bug.id), kind: 'planted-bug', name: `${title}: planted bug` }, { success: true });
      } else {
        await allowed(slot++, r.passed ? 'passed' : 'failed', file, { success: !!r.passed });
      }
      break;
    }
    case 'checkpointAnswered': {
      const cp = lesson.checkpoint!;
      const checkpoint = { id: activityIds.checkpoint(auIdOf(lesson.id), cp.id), kind: 'checkpoint' as const, name: `${title}: checkpoint` };
      const success = e.outcome !== 'review';
      const to = r.to ?? e.lessonId;
      await allowed(slot++, 'answered', checkpoint, { response: e.response });
      await allowed(slot++, success ? 'passed' : 'failed', checkpoint, { success });
      const rationale =
        r.chosenBy === 'learner' ? 'The learner chose this option.' : r.chosenBy === 'judge' ? 'The judge chose this branch against the rubric.' : 'The code checks passed.';
      await allowed(slot++, 'branched', checkpoint, {
        extensions: {
          [CXM_EXT.branch]: e.outcome,
          [CXM_EXT.to]: auIdOf(to),
          [CXM_EXT.rationale]: rationale,
          ...(r.chosenBy === 'learner' ? { [EXT_CHOSEN_BY]: 'learner' } : {}),
        },
      });
      if (success) {
        await defined(slot++, 'passed', au.auKey, au.sessionId, { duration: since(au.started) });
        await waive(has(bundle.lessons, to) ? jumpedOver(bundle, e.lessonId, to) : []);
      }
      break;
    }
    case 'lessonCompleted':
      await defined(slot++, 'completed', au.auKey, au.sessionId, { duration: since(au.started) });
      break;
  }
  return out;
}

/**
 * The abandoned statement for an AU session idle for AU_IDLE_MS. Its id and body depend only on the session,
 * so the cron and an event that finds the session stale queue the same statement.
 */
export async function abandonedStatement(
  ctx: { actor: Actor; registration: string },
  row: { au_key: string; session_id: string; started: number; last: number },
): Promise<XapiStatement> {
  return buildDefined(cmi5(ctx, row.session_id), 'abandoned', { au: target(row.au_key) }, {
    id: await deriveStatementId(row.session_id, 0),
    timestamp: new Date(row.last + AU_IDLE_MS).toISOString(),
    duration: isoDuration(Math.max(0, row.last - row.started)),
  });
}

export interface AuRow {
  au_key: string;
  session_id: string;
  started: number;
  last: number;
}

const toRow = (r: { au_key: string; session_id: string; started: number | string; last: number | string }): AuRow => ({
  au_key: r.au_key,
  session_id: r.session_id,
  started: Number(r.started),
  last: Number(r.last),
});

export async function listAuSessions(env: Env, actorName: string): Promise<AuRow[]> {
  const { results } = await env.DB
    .prepare('SELECT au_key, session_id, started, last FROM au_sessions WHERE actor_name = ?')
    .bind(actorName)
    .all<AuRow>();
  return results.map(toRow);
}

export async function deleteAuSession(env: Env, actorName: string, row: AuRow): Promise<void> {
  await env.DB.prepare('DELETE FROM au_sessions WHERE actor_name = ? AND au_key = ? AND session_id = ?').bind(actorName, row.au_key, row.session_id).run();
}

/** Sessions idle for AU_IDLE_MS, every learner's, for the cron. */
export async function listIdleAuSessions(env: Env, now: number): Promise<(AuRow & { actor_name: string })[]> {
  const { results } = await env.DB
    .prepare('SELECT actor_name, au_key, session_id, started, last FROM au_sessions WHERE last < ?')
    .bind(now - AU_IDLE_MS)
    .all<AuRow & { actor_name: string }>();
  return results.map((r) => ({ ...toRow(r), actor_name: r.actor_name }));
}
