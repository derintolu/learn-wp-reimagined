// Shadow mode (phase 5): after deciding, the course server builds the official statements, queues them for the
// LRS and records the learning facts it sent, per day, for the comparison report (Task 32). Behind
// SERVER_FLAGS.lrsShadow; nothing here can fail an event.
import type { Env } from '../env';
import { ensureRecordSchema, isDuplicateKey } from '../db';
import { getContent } from '../content';
import { INLINE_DRAIN_BUDGET_MS, drain, drainAfterDecide, enqueue, waitUntilOf } from '../lrs/outbox';
import { readParts, writeParts, type PartsTable } from '../blobParts';
import { cachedRegistration, type Session } from '../session/session';
import type { EventResult, ServerEvent } from '../../../src/shared/events';
import type { ContentBundle } from '../../../src/shared/types';
import { ADL_VERBS, CMI5, CXM_EXT, CXM_VERBS, activityIds } from '../../../vendor/course-xapi-mcp/core/constants';
import type { XapiStatement } from '../../../vendor/course-xapi-mcp/core/xapi/types';
import { getRegistration, lrsHealth, registrationWithin } from './registration';
import { LrsError, LrsUnavailable } from '../lrs/client';
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
 * Claims a defined completed, passed or waived for this learner, registration and AU: true for the first event to
 * send it, and again for a retry of that same event (so its statement keeps its id); false for any other event.
 * A new registration (restart_course) starts with nothing claimed.
 */
export async function claimOnce(env: Env, actorName: string, registration: string, s: XapiStatement, eventId: string): Promise<boolean> {
  const verb = s.verb.id.split('/').pop();
  try {
    await env.DB
      .prepare('INSERT INTO official_outcomes (actor_name, registration, activity_id, verb, event_id) VALUES (?, ?, ?, ?, ?)')
      .bind(actorName, registration, s.object.id, verb, eventId)
      .run();
    return true;
  } catch (e) {
    if (!isDuplicateKey(e)) throw e;
    const row = await env.DB
      .prepare('SELECT event_id FROM official_outcomes WHERE actor_name = ? AND registration = ? AND activity_id = ? AND verb = ?')
      .bind(actorName, registration, s.object.id, verb)
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
export async function satisfiedElsewhere(
  env: Env,
  actorName: string,
  registration: string,
  auActivity: string,
  bundle: ContentBundle,
  eventId: string,
): Promise<boolean> {
  const lessonId = lessonsByAu(bundle).get(auActivity);
  const { results } = await env.DB
    .prepare('SELECT verb FROM official_outcomes WHERE actor_name = ? AND registration = ? AND activity_id = ? AND event_id <> ?')
    .bind(actorName, registration, auActivity, eventId)
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
      if (isDefined(s) && s.verb.id === ADL_VERBS.waived && (await satisfiedElsewhere(env, actorName, ctx.registration, s.object.id, ctx.bundle, e.eventId))) continue;
      if (!isDefined(s) || !ONCE_VERBS.has(s.verb.id) || (await claimOnce(env, actorName, ctx.registration, s, e.eventId))) out.push(s);
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

type Ok = Extract<EventResult, { ok: true }>;
type OfficialCtx = { actor: Actor; registration: string; bundle: ContentBundle };

/** Builds and queues one event's official statements and records their facts; the number queued. */
async function recordOne(env: Env, ctx: OfficialCtx, actorName: string, e: ServerEvent, r: Ok, now: number, seq: number): Promise<number> {
  const sent = await officialFor(env, ctx, actorName, e, r, now, seq);
  for (const fact of factsOf(sent, ctx.bundle)) await recordShadowFact(env, actorName, fact, now);
  return sent.length;
}

const PENDING_PARTS: PartsTable = { table: 'official_pending_parts', keyCol: 'actor_name', verCol: 'item' };
/** Held events read per query (small rows, far under the operation limit). */
const PENDING_PAGE = 50;
/** Orders held events: decision time, then place in the batch; the eventId keeps two batches of one ms apart. */
const itemOf = (now: number, pos: number, eventId: string) => `${String(now).padStart(15, '0')}-${String(pos).padStart(3, '0')}-${eventId}`;
const hasKey = (o: object, k: string) => Object.prototype.hasOwnProperty.call(o, k);

/**
 * Holds a batch's decided events until the learner has a registration (ruling R52): one row per event, its event
 * and result in parts (an event can pass the 64 KiB operation limit). Holding the same event of the same decision
 * again changes nothing.
 */
export async function holdPending(env: Env, actorName: string, events: ServerEvent[], results: EventResult[], now: number): Promise<void> {
  await ensureRecordSchema(env.DB);
  for (const [i, e] of events.entries()) {
    const r = results[i];
    if (!r?.ok) continue;
    const item = itemOf(now, i, e.eventId);
    // The phase 1 statements are the studio's; the official ones are built from the event and its decision.
    await writeParts(env.DB, PENDING_PARTS, actorName, item, JSON.stringify({ e, r: { ...r, statements: [] } }), false);
    try {
      await env.DB.prepare('INSERT INTO official_pending (actor_name, item, now) VALUES (?, ?, ?)').bind(actorName, item, now).run();
    } catch (err) {
      if (!isDuplicateKey(err)) throw err;
    }
  }
}

/** A held row's event and result, or null when it cannot be read back (it would block the learner's replays). */
function parseHeld(body: string): { e: ServerEvent; r: Ok } | null {
  try {
    const v = JSON.parse(body) as { e?: ServerEvent; r?: Ok } | null;
    return v && typeof v.e?.eventId === 'string' && v.r?.ok === true ? { e: v.e, r: v.r } : null;
  } catch {
    return null;
  }
}

/** The eventId an item names (`now-pos-eventId`), or 'unknown'. */
const eventIdOf = (item: string) => item.split('-').slice(2).join('-') || 'unknown';

/** False when the course has changed since the event was decided, so that it no longer names what it did. */
function stillBuildable(bundle: ContentBundle, e: ServerEvent): boolean {
  if (e.type === 'placed') return true; // buildOfficial validates the placement itself
  if (!hasKey(bundle.lessons, e.lessonId)) return false;
  const lesson = bundle.lessons[e.lessonId];
  if (e.type === 'beatViewed') return e.beatIndex < lesson.beats.length;
  if (e.type === 'checkpointAnswered') return !!lesson.checkpoint;
  return true;
}

/**
 * Records the learner's held events, oldest first, each at its own decision time, so its statement ids and
 * timestamps are the ones it would have had (R7): queued, facts recorded, then the row dropped. Stops between
 * two held batches once `until` has passed; true when nothing is left. Two replays at once, or one stopped
 * before dropping a row, queue the same statements again, which is a no-op.
 */
export async function replayPending(env: Env, session: Session, registration: string, until = Infinity): Promise<boolean> {
  await ensureRecordSchema(env.DB);
  const actorName = session.actorName;
  const ctx: OfficialCtx = { actor: officialActor(actorName), registration, bundle: getContent() };
  let batchNow: number | undefined;
  let queued = 0;
  for (;;) {
    const { results: page } = await env.DB
      // A literal LIMIT: some MySQL drivers quote a bound LIMIT value.
      .prepare(`SELECT item, now FROM official_pending WHERE actor_name = ? ORDER BY item LIMIT ${PENDING_PAGE}`)
      .bind(actorName)
      .all<{ item: string; now: number | string }>();
    if (page.length === 0) return true;
    for (const p of page) {
      const now = Number(p.now);
      if (now !== batchNow) {
        if (Date.now() >= until) return false;
        batchNow = now;
        queued = 0;
      }
      const body = await readParts(env.DB, PENDING_PARTS, actorName, p.item);
      const held = body === null ? null : parseHeld(body);
      if (body !== null && !held) console.error('official record dropped an unreadable held event', eventIdOf(p.item));
      if (held) {
        const { e, r } = held;
        if (stillBuildable(ctx.bundle, e)) queued += await recordOne(env, ctx, actorName, e, r, now, queued);
        else console.error('official record dropped a held event the course no longer has', e.type, e.eventId);
      }
      await env.DB.prepare('DELETE FROM official_pending WHERE actor_name = ? AND item = ?').bind(actorName, p.item).run();
      await env.DB.prepare('DELETE FROM official_pending_parts WHERE actor_name = ? AND item = ?').bind(actorName, p.item).run();
    }
  }
}

/** Learners with held events the cron replays per run. */
export const HELD_ACTORS_PER_RUN = 100;

/**
 * The cron's replay of held events, for learners who send no further event (ruling R52): at most
 * HELD_ACTORS_PER_RUN learners, none started once `until` has passed. Each one's registration is the one cached
 * on their session, else read or minted at the LRS. A learner with no session left (their data was deleted) has
 * nothing to record into, so their held rows go. Once the LRS is unavailable, a learner it would have to be asked
 * about waits for the next run. The number of learners replayed.
 */
export async function replayHeld(env: Env, until: number): Promise<number> {
  await ensureRecordSchema(env.DB);
  const { results: actors } = await env.DB
    .prepare(`SELECT DISTINCT actor_name FROM official_pending ORDER BY actor_name LIMIT ${HELD_ACTORS_PER_RUN}`)
    .all<{ actor_name: string }>();
  let replayed = 0;
  // Once the LRS is unavailable, only learners whose registration is cached are replayed.
  let lrsDown = false;
  for (const { actor_name: actorName } of actors) {
    if (Date.now() >= until) break;
    const row = await env.DB
      .prepare(
        'SELECT sid_hash, actor_name, wp_user_id, created, touched FROM sessions WHERE actor_name = ? ORDER BY CASE WHEN registration IS NULL THEN 1 ELSE 0 END, created LIMIT 1',
      )
      .bind(actorName)
      .first<{ sid_hash: string; actor_name: string; wp_user_id: number | string | null; created: number | string; touched: number | string }>();
    if (!row) {
      await env.DB.prepare('DELETE FROM official_pending WHERE actor_name = ?').bind(actorName).run();
      await env.DB.prepare('DELETE FROM official_pending_parts WHERE actor_name = ?').bind(actorName).run();
      continue;
    }
    const session: Session = {
      sidHash: row.sid_hash,
      actorName: row.actor_name,
      wpUserId: row.wp_user_id == null ? null : Number(row.wp_user_id),
      createdAt: Number(row.created),
      touchedAt: Number(row.touched),
    };
    let registration = await cachedRegistration(env, session);
    if (!registration) {
      if (lrsDown) continue;
      try {
        registration = await getRegistration(env, session);
      } catch (e) {
        if (e instanceof LrsUnavailable) lrsDown = true;
        else if (e instanceof LrsError) console.error('official replay skipped: no registration', e.message);
        else console.error('official replay failed', (e as Error)?.name, (e as Error)?.message);
        continue;
      }
    }
    try {
      await replayPending(env, session, registration, until);
      replayed++;
    } catch (e) {
      // One learner's failure never halts the run: their rows stay for the next one.
      console.error('official replay failed', (e as Error)?.name, (e as Error)?.message);
    }
  }
  return replayed;
}

/**
 * Builds, queues and records the official statements for a decided batch, then, given the handler context,
 * drains the outbox. The registration lookup, the replay of held events and the drain share one
 * INLINE_DRAIN_BUDGET_MS budget that starts here, after deciding (ruling R22). Events held earlier go first.
 * Without a registration in time (a new learner, the LRS slow or unreachable), or with held events left at the
 * deadline, the batch is held too (ruling R52); a lookup still running is then kept alive with waitUntil, where
 * one is offered, and the held events are recorded and drained once it answers. Otherwise the next batch
 * replays them. Any failure is logged; the studio's answer never depends on this.
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
  let later: Promise<string | null> | undefined;
  let kept = false;
  try {
    await ensureRecordSchema(env.DB);
    const found = await registrationWithin(env, session, deadline);
    const registration = found.registration;
    if (registration && (await replayPending(env, session, registration, deadline))) {
      const ctx: OfficialCtx = { actor: officialActor(session.actorName), registration, bundle: getContent() };
      let queued = 0;
      for (const [i, e] of events.entries()) {
        const r = results[i];
        if (!r?.ok) continue;
        // Queue times stay distinct across the batch, so the drain sends in decision order.
        queued += await recordOne(env, ctx, session.actorName, e, r, now, queued);
      }
      kept = true;
    } else {
      await holdPending(env, session.actorName, events, results, now);
      kept = true;
      later = registration ? Promise.resolve(registration) : found.later;
    }
  } catch (e) {
    console.error('official record failed', (e as Error)?.name, (e as Error)?.message);
    // Not lost: held, so the next replay records it (again, if part of it was recorded: a no-op).
    if (!kept) {
      await holdPending(env, session.actorName, events, results, now).catch((err) =>
        console.error('official hold failed', (err as Error)?.name, (err as Error)?.message),
      );
    }
  }
  const waitUntil = waitUntilOf(handlerCtx);
  if (later && waitUntil) {
    return waitUntil(
      (async () => {
        try {
          const registration = await later;
          if (registration) await replayPending(env, session, registration);
        } catch (e) {
          console.error('official record failed', (e as Error)?.name, (e as Error)?.message);
        }
        // Not while the LRS is known to be down: the cron retries the rows.
        if (Date.now() < lrsHealth.downUntil) return;
        await drain(env, now, INLINE_DRAIN_BUDGET_MS).catch((e) => console.error('lrs drain failed', (e as Error)?.name, (e as Error)?.message));
      })(),
    );
  }
  // Not while the LRS is known to be down: the cron retries the rows.
  if (handlerCtx !== undefined && Date.now() >= lrsHealth.downUntil) await drainAfterDecide(handlerCtx, env, now, deadline);
}
