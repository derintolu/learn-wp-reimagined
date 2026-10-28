// "Delete my data" and the 180-day retention sweep (Task 39), plus the Sensei/LRS drift check.
import type { Env } from '../env';
import { SERVER_FLAGS } from '../config';
import { ensureEnrolmentSchema, ensureRecordSchema } from '../db';
import { LrsClient, LrsError, type Actor } from '../lrs/client';
import { ConnectorClient, ConnectorError } from '../ledger/connector';
import { lessonKeyBySenseiId } from '../ledger/lesson-ids';
import { revokeAllForActor } from '../oauth/store';
import { officialActor } from '../record/official';
import { listShadowFacts } from '../record/shadow';
import { deleteEnrolments } from './enrol';
import { SESSION_IDLE_MS, deleteSession, type Session } from './session';
import { activityId } from '../../../src/shared/xapi';

export interface DriftReport {
  /** 'not-configured' when LEDGER_PROGRAM_ID is unset, so an unchecked report is not mistaken for a clean one. */
  status?: 'not-configured';
  checked: number;
  mismatched: { actor: string; lrsOnly: string[]; senseiOnly: string[] }[];
}

/** Leaves headroom under the function time limit; learners left over wait for the next run. */
export const SWEEP_BUDGET_MS = 20_000;

/**
 * Erases one learner everywhere, in order: the LRS (actor and, in the LRS's listeners, badges), the Sensei learner,
 * the learner's OAuth codes and tokens, then the session row. The row goes last, so any step that throws leaves it
 * in place and the delete (or the next sweep) runs every step again. A step with its flag off is skipped; a
 * learner already gone (404) counts as done.
 *
 * Learning Ledger (c9b5915) ignores `revokeBadges` on POST /actors/erase: badge revocation runs in its own
 * listeners. The option is sent anyway, for when the LRS honours it.
 */
export async function eraseLearner(env: Env, s: Session, opts: { revokeBadges: boolean }): Promise<void> {
  if (SERVER_FLAGS.lrsShadow) {
    // Queued statements and open AU sessions go first, so a drain cannot re-create the actor after the erase.
    await ensureRecordSchema(env.DB);
    for (const table of ['lrs_outbox', 'au_sessions']) {
      await env.DB.prepare(`DELETE FROM ${table} WHERE actor_name = ?`).bind(s.actorName).run();
    }
    try {
      await new LrsClient(env).eraseActor(lrsActor(s.actorName), opts);
    } catch (e) {
      if (!(e instanceof LrsError && e.status === 404)) throw e;
    }
    for (const table of ['shadow_facts', 'official_outcomes']) {
      await env.DB.prepare(`DELETE FROM ${table} WHERE actor_name = ?`).bind(s.actorName).run();
    }
  }
  if (SERVER_FLAGS.senseiLearners && s.wpUserId != null) {
    try {
      await new ConnectorClient(env).deleteLearner(s.wpUserId);
    } catch (e) {
      if (!(e instanceof ConnectorError && e.status === 404)) throw e;
    }
    await deleteEnrolments(env, s.wpUserId);
  }
  await revokeAllForActor(env, s.actorName);
  await deleteSession(env, s);
}

const lrsActor = (name: string) => officialActor(name) as Actor;
const dayOf = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const LESSON_PREFIX = activityId(['lessons', '']);
const DEFINED_VERBS = new Set(['completed', 'waived']);

/** Lesson key of a cmi5 AU activity id (`<lessons iri>/<key>/au`), or null. */
function lessonKeyOf(objectId: string): string | null {
  if (!objectId.startsWith(LESSON_PREFIX) || !objectId.endsWith('/au')) return null;
  const key = objectId.slice(LESSON_PREFIX.length, -3);
  return key && !key.includes('/') ? decodeURIComponent(key) : null;
}

async function lrsLessons(env: Env, actor: string): Promise<Set<string>> {
  const out = new Set<string>();
  const { statements } = await new LrsClient(env).getStatements({ agent: lrsActor(actor), limit: 1000 });
  for (const st of statements) {
    if (!DEFINED_VERBS.has(st.verb.id.split('/').pop() ?? '')) continue;
    const key = lessonKeyOf(st.object.id);
    if (key) out.add(key);
  }
  return out;
}

async function senseiLessons(env: Env, wpUserId: number, programId: string): Promise<Set<string>> {
  const keys = lessonKeyBySenseiId(env);
  const p = await new ConnectorClient(env).progress(wpUserId, programId);
  return new Set([...p.completedLessons, ...p.testedOutLessons].map((id) => keys[id] ?? id));
}

/**
 * For each learner with a learning fact today or yesterday (the cron runs once a day), compares the lessons the
 * LRS holds as completed or waived with Sensei's completed and tested-out lessons. Does nothing unless both the
 * LRS shadow and the Sensei learners are on. A learner who cannot be read this run is not counted as checked.
 */
export async function checkDrift(env: Env, now: number): Promise<DriftReport> {
  const report: DriftReport = { checked: 0, mismatched: [] };
  if (!SERVER_FLAGS.lrsShadow || !SERVER_FLAGS.senseiLearners) return report;
  if (!env.LEDGER_PROGRAM_ID) return { ...report, status: 'not-configured' };
  const actors = new Set<string>();
  for (const day of [dayOf(now - 86_400_000), dayOf(now)]) for (const a of await listShadowFacts(env, day)) actors.add(a.actor);
  for (const actor of [...actors].sort()) {
    const row = await env.DB.prepare('SELECT wp_user_id FROM sessions WHERE actor_name = ?').bind(actor).first<{ wp_user_id: number | string | null }>();
    if (!row || row.wp_user_id == null) continue;
    try {
      const [lrs, sensei] = [await lrsLessons(env, actor), await senseiLessons(env, Number(row.wp_user_id), env.LEDGER_PROGRAM_ID)];
      report.checked++;
      const lrsOnly = [...lrs].filter((k) => !sensei.has(k)).sort();
      const senseiOnly = [...sensei].filter((k) => !lrs.has(k)).sort();
      if (lrsOnly.length || senseiOnly.length) report.mismatched.push({ actor, lrsOnly, senseiOnly });
    } catch (e) {
      console.error('drift check failed for one learner', (e as Error)?.message);
    }
  }
  return report;
}

async function ensureDriftSchema(env: Env): Promise<void> {
  await env.DB.prepare('CREATE TABLE IF NOT EXISTS drift_reports (day VARCHAR(10) PRIMARY KEY, body TEXT, created BIGINT)').run();
}

async function storeDrift(env: Env, now: number, report: DriftReport): Promise<void> {
  await ensureDriftSchema(env);
  await env.DB.prepare('DELETE FROM drift_reports WHERE day = ?').bind(dayOf(now)).run();
  await env.DB.prepare('INSERT INTO drift_reports (day, body, created) VALUES (?, ?, ?)').bind(dayOf(now), JSON.stringify(report), now).run();
}

/** The most recent stored drift report with its day, or null before the first sweep. */
export async function latestDriftReport(env: Env): Promise<{ day: string; drift: DriftReport } | null> {
  await ensureDriftSchema(env);
  const row = await env.DB.prepare('SELECT day, body FROM drift_reports ORDER BY day DESC LIMIT 1').first<{ day: string; body: string }>();
  return row ? { day: row.day, drift: JSON.parse(row.body) as DriftReport } : null;
}

export async function latestDrift(env: Env): Promise<DriftReport | null> {
  return (await latestDriftReport(env))?.drift ?? null;
}

interface Row {
  sid_hash: string;
  actor_name: string;
  wp_user_id: number | string | null;
  created: number | string;
  touched: number | string;
}

/**
 * Erases every learner idle for 180 days (revokeBadges false: badges they earned are theirs to keep), then runs
 * the drift check and stores its report. A learner whose erase fails keeps their session row and is picked up
 * again by the next sweep; the others carry on.
 */
export async function sweep(env: Env, now: number): Promise<{ expired: number; retained: number; drift: DriftReport }> {
  await ensureEnrolmentSchema(env.DB);
  const { results } = await env.DB
    .prepare('SELECT sid_hash, actor_name, wp_user_id, created, touched FROM sessions WHERE touched < ? ORDER BY touched')
    .bind(now - SESSION_IDLE_MS)
    .all<Row>();
  const started = Date.now();
  let expired = 0;
  for (const r of results) {
    if (Date.now() - started > SWEEP_BUDGET_MS) break;
    const s: Session = {
      sidHash: r.sid_hash,
      actorName: r.actor_name,
      wpUserId: r.wp_user_id == null ? null : Number(r.wp_user_id),
      createdAt: Number(r.created),
      touchedAt: Number(r.touched),
    };
    try {
      await eraseLearner(env, s, { revokeBadges: false });
      expired++;
    } catch (e) {
      console.error('retention erase failed; retrying next sweep', (e as Error)?.message);
    }
  }
  const left = await env.DB.prepare('SELECT COUNT(*) AS c FROM sessions').first<{ c: number | string }>();
  const drift = await checkDrift(env, now);
  await storeDrift(env, now, drift);
  return { expired, retained: Number(left?.c ?? 0), drift };
}
