// "Delete my data" and the 180-day retention sweep (Task 39), plus the Sensei/LRS drift check.
import type { Env } from '../env';
import { ensureEnrolmentSchema, ensureRecordSchema, isDuplicateKey } from '../db';
import { deleteOtherParts, readParts, writeParts, type PartsTable } from '../blobParts';
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

/** Actor-keyed rows removed before the LRS erase, so a drain or a replay cannot re-create the actor after it. */
export const ERASE_BEFORE_LRS = ['lrs_outbox', 'au_sessions', 'official_pending', 'official_pending_parts'] as const;
/** Actor-keyed rows removed after the LRS erase. A new actor_name table must be listed here (lifecycle test). */
export const ERASE_AFTER_LRS = ['shadow_facts', 'official_outcomes', 'carry_overs', 'record_cache', 'record_cache_parts'] as const;

/**
 * Erases one learner everywhere, in order: the LRS (actor and, in the LRS's listeners, badges), their entries in the
 * stored drift reports, the Sensei learner, the learner's OAuth codes and tokens, then the session row. The row goes
 * last, so any step that throws leaves it in place and the delete (or the next sweep) runs every step again. A learner
 * already gone (404) counts as done. The Sensei step runs whenever the session names a WordPress user.
 *
 * `revokeBadges` goes to both deletes. Learning Ledger 0.1.1+ honours it on POST /actors/erase: true ("Delete my
 * data") revokes the learner's badges, false (the retention sweep) keeps the ones they claimed. The Sensei learner
 * delete also erases the learner's LRS actors, so it carries the same choice (`?revokeBadges=false`, Learning Ledger
 * 0.1.7+); without it the sweep would revoke claimed badges through that second erase.
 */
export async function eraseLearner(env: Env, s: Session, opts: { revokeBadges: boolean }): Promise<void> {
  await ensureRecordSchema(env.DB);
  for (const table of ERASE_BEFORE_LRS) {
    await env.DB.prepare(`DELETE FROM ${table} WHERE actor_name = ?`).bind(s.actorName).run();
  }
  try {
    await new LrsClient(env).eraseActor(lrsActor(s.actorName), opts);
  } catch (e) {
    if (!(e instanceof LrsError && e.status === 404)) throw e;
  }
  for (const table of ERASE_AFTER_LRS) {
    await env.DB.prepare(`DELETE FROM ${table} WHERE actor_name = ?`).bind(s.actorName).run();
  }
  await eraseFromDrift(env, s.actorName);
  if (s.wpUserId != null) {
    try {
      await new ConnectorClient(env).deleteLearner(s.wpUserId, { revokeBadges: opts.revokeBadges });
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
 * LRS holds as completed or waived with Sensei's completed and tested-out lessons. A learner who cannot be read
 * this run is not counted as checked.
 */
export async function checkDrift(env: Env, now: number): Promise<DriftReport> {
  const report: DriftReport = { checked: 0, mismatched: [] };
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

/** Stored drift reports kept: the latest seven days. */
export const DRIFT_REPORTS_KEPT = 7;

/** drift_reports is the pointer (created names the version); the report itself is in parts, as it can pass 64 KiB. */
const DRIFT_PARTS: PartsTable = { table: 'drift_report_parts', keyCol: 'day', verCol: 'created' };
const driftReady = new WeakSet<object>();

/**
 * drift_actors indexes the learners each stored report names, so an erase finds the reports to clean without reading
 * them all. An index row may outlive its learner's entry (a report rewritten without them); that only costs a no-op.
 */
async function ensureDriftSchema(env: Env): Promise<void> {
  if (driftReady.has(env.DB)) return;
  await env.DB.prepare('CREATE TABLE IF NOT EXISTS drift_reports (day VARCHAR(10) PRIMARY KEY, body TEXT, created BIGINT)').run();
  await env.DB
    .prepare('CREATE TABLE IF NOT EXISTS drift_report_parts (day VARCHAR(10), created BIGINT, seq INT, part MEDIUMTEXT, PRIMARY KEY (day, created, seq))')
    .run();
  await env.DB.prepare('CREATE TABLE IF NOT EXISTS drift_actors (day VARCHAR(10), actor_name VARCHAR(64), PRIMARY KEY (day, actor_name))').run();
  // A report stored whole in body (before parts) is not indexed, so no erase could clean it: dropped.
  await env.DB.prepare('DELETE FROM drift_reports WHERE body IS NOT NULL').run();
  driftReady.add(env.DB);
}

/** Writes the report for day under a new version: index rows, then parts, then the pointer, then cleanup. */
async function writeDrift(env: Env, day: string, ver: number, report: DriftReport): Promise<void> {
  for (const { actor } of report.mismatched) {
    try {
      await env.DB.prepare('INSERT INTO drift_actors (day, actor_name) VALUES (?, ?)').bind(day, actor).run();
    } catch (e) {
      if (!isDuplicateKey(e)) throw e;
    }
  }
  await writeParts(env.DB, DRIFT_PARTS, day, ver, JSON.stringify(report), true);
  const r = await env.DB.prepare('UPDATE drift_reports SET created = ? WHERE day = ?').bind(ver, day).run();
  if (r.meta.changes === 0) {
    try {
      await env.DB.prepare('INSERT INTO drift_reports (day, body, created) VALUES (?, NULL, ?)').bind(day, ver).run();
    } catch (e) {
      // MySQL counts only changed rows: the row is there and already names this version.
      if (!isDuplicateKey(e)) throw e;
    }
  }
  await deleteOtherParts(env.DB, DRIFT_PARTS, day, ver);
}

async function readDrift(env: Env, day: string, ver: number): Promise<DriftReport | null> {
  const body = await readParts(env.DB, DRIFT_PARTS, day, ver);
  return body == null ? null : (JSON.parse(body) as DriftReport);
}

/** Stores today's report and drops every report older than the latest DRIFT_REPORTS_KEPT days. */
async function storeDrift(env: Env, now: number, report: DriftReport): Promise<void> {
  await ensureDriftSchema(env);
  await writeDrift(env, dayOf(now), now, report);
  const { results } = await env.DB
    .prepare(`SELECT day FROM drift_reports ORDER BY day DESC LIMIT ${DRIFT_REPORTS_KEPT}`)
    .all<{ day: string }>();
  if (results.length < DRIFT_REPORTS_KEPT) return;
  const oldest = results[results.length - 1].day;
  for (const t of ['drift_reports', 'drift_report_parts', 'drift_actors']) {
    await env.DB.prepare(`DELETE FROM ${t} WHERE day < ?`).bind(oldest).run();
  }
}

/** Removes the learner's entries from every stored drift report, then their index rows. */
async function eraseFromDrift(env: Env, actorName: string): Promise<void> {
  await ensureDriftSchema(env);
  const { results } = await env.DB.prepare('SELECT day FROM drift_actors WHERE actor_name = ?').bind(actorName).all<{ day: string }>();
  for (const { day } of results) {
    const row = await env.DB.prepare('SELECT created FROM drift_reports WHERE day = ?').bind(day).first<{ created: number | string }>();
    const ver = Number(row?.created);
    const report = row ? await readDrift(env, day, ver) : null;
    if (!report || !report.mismatched.some((m) => m.actor === actorName)) continue;
    // A new version, so a reader sees the old report or the new one, never a mix.
    await writeDrift(env, day, Math.max(Date.now(), ver + 1), { ...report, mismatched: report.mismatched.filter((m) => m.actor !== actorName) });
  }
  await env.DB.prepare('DELETE FROM drift_actors WHERE actor_name = ?').bind(actorName).run();
}

/** The most recent stored drift report with its day, or null before the first sweep. */
export async function latestDriftReport(env: Env): Promise<{ day: string; drift: DriftReport } | null> {
  await ensureDriftSchema(env);
  const row = await env.DB.prepare('SELECT day, created FROM drift_reports ORDER BY day DESC LIMIT 1').first<{ day: string; created: number | string }>();
  const drift = row ? await readDrift(env, row.day, Number(row.created)) : null;
  return row && drift ? { day: row.day, drift } : null;
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
