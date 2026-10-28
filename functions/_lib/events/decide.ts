import type { Env } from '../env';
import { getContent } from '../content';
import { recordOfficial } from '../record/shadow';
import type { Session } from '../session/session';
import { deriveStatementId } from './ids';
import { runChecks } from '../../../src/shared/checks';
import { resolveBranch, validatePlacement } from '../../../src/shared/engine';
import { statementsForEvent } from '../../../src/shared/statements';
import type { RecordEvent } from '../../../src/shared/record';
import type { EventResult, ServerEvent } from '../../../src/shared/events';
import { SERVER_FLAGS } from '../config';
import { ensureEnrolled } from '../session/enrol';
import type { ConnectorClient } from '../ledger/connector';
import type { Lesson, PathId } from '../../../src/shared/types';
import type { XapiStatement } from '../../../src/shared/xapi';

export const DECISION_TTL_MS = 30 * 60_000;

type Ok = Extract<EventResult, { ok: true }>;

/**
 * Single use: one conditional UPDATE, so two concurrent answers cannot both win. The consuming eventId is
 * recorded, so a retry of the same event is a replay of the judged answer, not a second use.
 */
async function consumeDecision(env: Env, id: string, lessonId: string, outcome: string, eventId: string, now: number): Promise<boolean> {
  const r = await env.DB
    .prepare('UPDATE decisions SET used = 1, used_by = ? WHERE id = ? AND lesson_id = ? AND outcome = ? AND used = 0 AND created >= ?')
    .bind(eventId, id, lessonId, outcome, now - DECISION_TTL_MS)
    .run();
  if (r.meta.changes === 1) return true;
  const row = await env.DB
    .prepare('SELECT used_by FROM decisions WHERE id = ? AND lesson_id = ? AND outcome = ? AND used = 1')
    .bind(id, lessonId, outcome)
    .first<{ used_by: string | null }>();
  return row?.used_by === eventId;
}

async function build(actor: string, e: ServerEvent, rec: RecordEvent, now: number, chosenBy?: 'judge' | 'learner'): Promise<XapiStatement[]> {
  const c = getContent();
  const count = statementsForEvent(actor, rec, c).length;
  const ids = await Promise.all(Array.from({ length: count }, (_, n) => deriveStatementId(e.eventId, n)));
  return statementsForEvent(actor, rec, c, { ids, timestamp: new Date(now).toISOString(), chosenBy });
}

async function decideOne(env: Env, actor: string, e: ServerEvent, now: number): Promise<EventResult> {
  const c = getContent();
  const fail = (error: 'unknown-lesson' | 'invalid' | 'not-allowed'): EventResult => ({ eventId: e.eventId, ok: false, error });
  const ok = (r: Omit<Ok, 'eventId' | 'ok'>): EventResult => ({ eventId: e.eventId, ok: true, ...r });

  if (e.type === 'placed') {
    return validatePlacement(c, e.placement).ok ? ok({ statements: [] }) : fail('invalid');
  }
  const lesson: Lesson | undefined = Object.prototype.hasOwnProperty.call(c.lessons, e.lessonId) ? c.lessons[e.lessonId] : undefined;
  if (!lesson) return fail('unknown-lesson');

  switch (e.type) {
    case 'beatViewed':
      if (e.beatIndex >= lesson.beats.length) return fail('invalid');
      return ok({ statements: await build(actor, e, { type: 'beatViewed', lessonId: e.lessonId, beatIndex: e.beatIndex }, now) });

    case 'lessonCompleted':
      return ok({ statements: await build(actor, e, { type: 'lessonCompleted', lessonId: e.lessonId }, now) });

    case 'lessonOpened':
    case 'lessonLeft':
      return ok({ statements: [] });

    case 'codeSubmitted': {
      const spec = e.target === 'checkpoint'
        ? lesson.checkpoint?.kind === 'code' && lesson.checkpoint.file && lesson.checkpoint.checks
          ? { file: lesson.checkpoint.file, checks: lesson.checkpoint.checks }
          : null
        : lesson.bug
          ? { file: lesson.bug.file, checks: lesson.bug.fixChecks }
          : null;
      if (!spec || spec.file !== e.file) return fail('invalid');
      const passed = runChecks(spec.checks, e.files).passed;
      return ok({ passed, statements: await build(actor, e, { type: 'codeChecked', lessonId: e.lessonId, file: spec.file, passed }, now) });
    }

    case 'checkpointAnswered': {
      const cp = lesson.checkpoint;
      if (!cp) return fail('invalid');
      const branch = cp.branches.find((b) => b.outcome === e.outcome);
      if (!branch) return fail('invalid');
      let chosenBy: 'judge' | 'learner' | undefined;
      if (cp.kind === 'code') {
        if (e.outcome === 'advance') {
          if (!cp.checks || !e.files || !runChecks(cp.checks, e.files).passed) return fail('not-allowed');
        } else if (e.outcome === 'skip' && !cp.fallback.some((f) => f.outcome === 'skip')) {
          return fail('not-allowed');
        }
        if (e.outcome !== 'advance') chosenBy = 'learner';
      } else if (e.decisionId && (await consumeDecision(env, e.decisionId, e.lessonId, e.outcome, e.eventId, now))) {
        chosenBy = 'judge';
      } else if (cp.fallback.some((f) => f.outcome === e.outcome)) {
        chosenBy = 'learner';
      } else {
        return fail('not-allowed');
      }
      const to = resolveBranch(c, e.lessonId, e.outcome).to;
      const rec: RecordEvent = { type: 'checkpointAnswered', lessonId: e.lessonId, response: e.response, outcome: e.outcome, to };
      const statements = await build(actor, e, rec, now, chosenBy);
      return ok({ statements, outcome: e.outcome, to, passed: e.outcome !== 'review', chosenBy });
    }
  }
}

/** The path an event belongs to: the placement's path, or the lesson's. */
function pathOf(e: ServerEvent): PathId | null {
  if (e.type === 'placed') return e.placement.pathId;
  const c = getContent();
  return Object.prototype.hasOwnProperty.call(c.lessons, e.lessonId) ? c.lessons[e.lessonId].pathId : null;
}

export interface DecideOptions {
  /** The session's headless Sensei learner (Task 25), enrolled in each path an event touches. */
  wpUserId?: number | null;
  connector?: Pick<ConnectorClient, 'enrol'>;
  /** The session, which names the official actor (Task 30). */
  session?: Session | null;
}

/**
 * Decides every event independently; one bad event never sinks the batch. With a session and
 * SERVER_FLAGS.lrsShadow on, the official statements are then built and queued for the LRS (never failing the batch).
 */
export async function decideEvents(env: Env, actorName: string, events: ServerEvent[], now: number, opts: DecideOptions = {}): Promise<EventResult[]> {
  const out: EventResult[] = [];
  for (const e of events) {
    // Validation failures are returned as results above; infrastructure errors propagate so the client retries.
    const r = await decideOne(env, actorName, e, now);
    out.push(r);
    if (r.ok && SERVER_FLAGS.senseiLearners && opts.wpUserId != null) {
      const path = pathOf(e);
      if (path) await ensureEnrolled(env, opts.wpUserId, path, opts.connector, now);
    }
  }
  if (SERVER_FLAGS.lrsShadow && opts.session) await recordOfficial(env, opts.session, events, out, now);
  return out;
}
