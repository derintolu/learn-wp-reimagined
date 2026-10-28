// Shadow mode (phase 5): after deciding, the course server builds the official statements, queues them for the
// LRS and records the learning facts it sent, per day, for the comparison report (Task 32). Behind
// SERVER_FLAGS.lrsShadow; nothing here can fail an event.
import type { Env } from '../env';
import { ensureRecordSchema, isDuplicateKey } from '../db';
import { getContent } from '../content';
import { INLINE_DRAIN_BUDGET_MS, drainAfterDecide, enqueue } from '../lrs/outbox';
import type { Session } from '../session/session';
import type { EventResult, ServerEvent } from '../../../src/shared/events';
import type { ContentBundle } from '../../../src/shared/types';
import { ADL_VERBS, CMI5, CXM_EXT, CXM_VERBS, activityIds } from '../../../vendor/course-xapi-mcp/core/constants';
import type { XapiStatement } from '../../../vendor/course-xapi-mcp/core/xapi/types';
import { lrsHealth, registrationWithin } from './registration';
import {
  AU_IDLE_MS,
  PLACEMENT_AU_KEY,
  abandonedStatement,
  auIdOf,
  buildOfficial,
  deleteAuSession,
  listAuSessions,
  officialActor,
  sessionIdFor,
  type Actor,
  type AuRow,
  type AuSession,
} from './official';

export type LearningFact = { lessonId: string; kind: 'completed' | 'waived' | 'branched' | 'caught' | 'placed' };

const dayOf = (ms: number) => new Date(ms).toISOString().slice(0, 10);

export async function recordShadowFact(env: Env, actor: string, fact: LearningFact, now = Date.now()): Promise<void> {
  await ensureRecordSchema(env.DB);
  await env.DB
    .prepare('INSERT INTO shadow_facts (day, actor_name, lesson_id, kind) VALUES (?, ?, ?, ?)')
    .bind(dayOf(now), actor, fact.lessonId, fact.kind)
    .run();
}

/** The day's facts per learner, each fact once (a retried event records its facts again). */
export async function listShadowFacts(env: Env, day: string): Promise<{ actor: string; facts: LearningFact[] }[]> {
  await ensureRecordSchema(env.DB);
  const { results } = await env.DB
    .prepare('SELECT DISTINCT actor_name, lesson_id, kind FROM shadow_facts WHERE day = ? ORDER BY actor_name, lesson_id, kind')
    .bind(day)
    .all<{ actor_name: string; lesson_id: string; kind: LearningFact['kind'] }>();
  const out: { actor: string; facts: LearningFact[] }[] = [];
  for (const r of results) {
    if (out.at(-1)?.actor !== r.actor_name) out.push({ actor: r.actor_name, facts: [] });
    out.at(-1)!.facts.push({ lessonId: r.lesson_id, kind: r.kind });
  }
  return out;
}

const isDefined = (s: XapiStatement) => (s.context.contextActivities?.category ?? []).some((c) => c.id === CMI5.categoryCmi5);
const ONCE_VERBS = new Set<string>([ADL_VERBS.completed, ADL_VERBS.passed, ADL_VERBS.waived]);

/**
 * Claims a defined completed, passed or waived for this learner and AU: true for the first event to send it,
 * and again for a retry of that same event (so its statement keeps its id); false for any other event.
 */
export async function claimOnce(env: Env, actorName: string, s: XapiStatement, eventId: string): Promise<boolean> {
  try {
    await env.DB
      .prepare('INSERT INTO official_outcomes (actor_name, activity_id, verb, event_id) VALUES (?, ?, ?, ?)')
      .bind(actorName, s.object.id, s.verb.id.split('/').pop(), eventId)
      .run();
    return true;
  } catch (e) {
    if (!isDuplicateKey(e)) throw e;
    const row = await env.DB
      .prepare('SELECT event_id FROM official_outcomes WHERE actor_name = ? AND activity_id = ? AND verb = ?')
      .bind(actorName, s.object.id, s.verb.id.split('/').pop())
      .first<{ event_id: string }>();
    return row?.event_id === eventId;
  }
}

/** Lesson ids by their AU publisher id and AU activity id. */
function lessonsByAu(bundle: ContentBundle): Map<string, string> {
  const byAu = new Map<string, string>();
  for (const id of Object.keys(bundle.lessons)) {
    byAu.set(auIdOf(id), id);
    byAu.set(activityIds.au(auIdOf(id)), id);
  }
  return byAu;
}

/**
 * True when another event already satisfied this AU in the registration, as the standard's isSatisfied reads
 * it: waived, or completed (moveOn Completed), or completed and passed (CompletedAndPassed). Such a lesson is
 * not waived again (vendored placement.ts and checkpoint.ts filter skips the same way).
 */
export async function satisfiedElsewhere(env: Env, actorName: string, auActivity: string, bundle: ContentBundle, eventId: string): Promise<boolean> {
  const lessonId = lessonsByAu(bundle).get(auActivity);
  const { results } = await env.DB
    .prepare('SELECT verb FROM official_outcomes WHERE actor_name = ? AND activity_id = ? AND event_id <> ?')
    .bind(actorName, auActivity, eventId)
    .all<{ verb: string }>();
  const done = new Set(results.map((r) => r.verb));
  if (done.has('waived')) return true;
  const needsPass = lessonId !== undefined && !!bundle.lessons[lessonId].checkpoint;
  return done.has('completed') && (!needsPass || done.has('passed'));
}

/** The facts the sent statements state, mapped back to lesson ids. */
export function factsOf(statements: XapiStatement[], bundle: ContentBundle): LearningFact[] {
  const byAu = lessonsByAu(bundle);
  const facts: LearningFact[] = [];
  const add = (iri: unknown, kind: LearningFact['kind']) => {
    const lessonId = typeof iri === 'string' ? byAu.get(iri) : undefined;
    if (lessonId) facts.push({ lessonId, kind });
  };
  for (const s of statements) {
    const parent = s.context.contextActivities?.parent?.[0]?.id;
    if (s.verb.id === ADL_VERBS.completed && isDefined(s)) add(s.object.id, 'completed');
    else if (s.verb.id === ADL_VERBS.waived) add(s.object.id, 'waived');
    else if (s.verb.id === CXM_VERBS.branched) add(parent, 'branched');
    else if (s.verb.id === CXM_VERBS.caught) add(parent, 'caught');
    else if (s.verb.id === CXM_VERBS.placed) add(s.result?.extensions?.[CXM_EXT['start-lesson']], 'placed');
  }
  return facts;
}

/**
 * The learner's AU session for this event, from their open session rows. A session idle for AU_IDLE_MS is
 * abandoned; an open session on another AU is replaced (this event terminates it). A session opened by this
 * very event (a retry) counts as new again, so its launched and initialized keep their ids.
 */
function planSession(rows: AuRow[], auKey: string, sessionId: string, now: number, closing: boolean) {
  const stale = rows.filter((r) => now - r.last > AU_IDLE_MS);
  const live = rows.filter((r) => now - r.last <= AU_IDLE_MS);
  const same = live.find((r) => r.au_key === auKey);
  if (closing) {
    return { abandon: stale.filter((r) => r.au_key === auKey), end: same ? [same] : [], session: same && toSession(same, now, false) };
  }
  const others = live.filter((r) => r.au_key !== auKey);
  // At most one other session is open; should there be more, the extra ones are abandoned.
  const [replaced, ...extra] = others;
  const session: AuSession = same
    ? toSession(same, now, same.session_id === sessionId)
    : { auKey, sessionId, started: now, last: now, isNew: true };
  if (replaced) session.replaced = { auKey: replaced.au_key, sessionId: replaced.session_id, started: replaced.started };
  return { abandon: [...stale, ...extra], end: others, session, open: !same };
}

const toSession = (r: AuRow, now: number, isNew: boolean): AuSession => ({ auKey: r.au_key, sessionId: r.session_id, started: r.started, last: now, isNew });

async function officialFor(
  env: Env,
  ctx: { actor: Actor; registration: string; bundle: ContentBundle },
  actorName: string,
  e: ServerEvent,
  r: Extract<EventResult, { ok: true }>,
  now: number,
  seq: number,
): Promise<XapiStatement[]> {
  const auKey = e.type === 'placed' ? PLACEMENT_AU_KEY : e.lessonId;
  const closing = e.type === 'lessonLeft';
  const plan = planSession(await listAuSessions(env, actorName), auKey, await sessionIdFor(e.eventId), now, closing);

  const out: XapiStatement[] = [];
  for (const row of plan.abandon) out.push(await abandonedStatement(ctx, row));
  if (plan.session) {
    for (const s of await buildOfficial({ ...ctx, auSession: plan.session }, e, r)) {
      if (isDefined(s) && s.verb.id === ADL_VERBS.waived && (await satisfiedElsewhere(env, actorName, s.object.id, ctx.bundle, e.eventId))) continue;
      if (!isDefined(s) || !ONCE_VERBS.has(s.verb.id) || (await claimOnce(env, actorName, s, e.eventId))) out.push(s);
    }
  }
  // Queue first, then move the session rows: a retry after a failure in between plans the same statements.
  await enqueue(env, out, now, seq);
  for (const row of [...plan.abandon, ...plan.end]) await deleteAuSession(env, actorName, row);
  if (plan.session && !closing) {
    if (e.type === 'placed') {
      if (!plan.open) await deleteAuSession(env, actorName, { au_key: auKey, session_id: plan.session.sessionId, started: 0, last: 0 });
    } else if (plan.open) {
      try {
        await env.DB
          .prepare('INSERT INTO au_sessions (actor_name, au_key, session_id, started, last) VALUES (?, ?, ?, ?, ?)')
          .bind(actorName, auKey, plan.session.sessionId, now, now)
          .run();
      } catch (err) {
        if (!isDuplicateKey(err)) throw err;
      }
    } else {
      await env.DB.prepare('UPDATE au_sessions SET last = ? WHERE actor_name = ? AND au_key = ?').bind(now, actorName, auKey).run();
    }
  }
  return out;
}

/**
 * Builds, queues and records the official statements for a decided batch, then, given the handler context,
 * drains the outbox. The registration lookup and the drain share one INLINE_DRAIN_BUDGET_MS budget that starts
 * here, after deciding (ruling R22). Without a registration (the LRS slow or unreachable for a learner it has
 * not seen yet) nothing official is recorded for this batch. Any failure is logged; the studio's answer never
 * depends on this.
 */
export async function recordOfficial(
  env: Env,
  session: Session,
  events: ServerEvent[],
  results: EventResult[],
  now: number,
  handlerCtx?: unknown,
): Promise<void> {
  const deadline = Date.now() + INLINE_DRAIN_BUDGET_MS;
  try {
    await ensureRecordSchema(env.DB);
    const registration = await registrationWithin(env, session, deadline);
    if (registration) {
      const bundle = getContent();
      const ctx = { actor: officialActor(session.actorName), registration, bundle };
      let queued = 0;
      for (const [i, e] of events.entries()) {
        const r = results[i];
        if (!r?.ok) continue;
        // Queue times stay distinct across the batch, so the drain sends in decision order.
        const sent = await officialFor(env, ctx, session.actorName, e, r, now, queued);
        queued += sent.length;
        for (const fact of factsOf(sent, bundle)) await recordShadowFact(env, session.actorName, fact, now);
      }
    }
  } catch (e) {
    console.error('official record failed', (e as Error)?.name, (e as Error)?.message);
  }
  // Not while the LRS is known to be down: the cron retries the rows.
  if (handlerCtx !== undefined && Date.now() >= lrsHealth.downUntil) await drainAfterDecide(handlerCtx, env, now, deadline);
}
