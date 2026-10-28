import type { Env } from '../env';
import { ensureEnrolmentSchema, isDuplicateKey } from '../db';
import { ConnectorClient, ConnectorUnavailable } from '../ledger/connector';
import type { PathId } from '../../../src/shared/types';

/** How long the request path skips enrolling once the connector was slow or down (per isolate). */
export const ENROL_RETRY_MS = 60_000;
/** Per isolate: until when no enrolment is attempted, so a slow connector does not hold every event batch. */
export const enrolHealth = { downUntil: 0 };

/**
 * Enrols a session learner in a path's Sensei course, once. The row is written first so a second event
 * finds it; if the enrolment itself fails the row is removed again, so a later event in that path retries.
 * A timeout or 5xx (ConnectorUnavailable) also stops every enrolment in this isolate for ENROL_RETRY_MS.
 * Never throws for a connector failure: the event that triggered it must still be answered.
 * Returns false when the enrolment failed or was skipped for the back-off, so the caller tries no more this batch.
 */
export async function ensureEnrolled(
  env: Env,
  wpUserId: number,
  pathId: PathId,
  connector: Pick<ConnectorClient, 'enrol'> = new ConnectorClient(env),
  now = Date.now(),
): Promise<boolean> {
  await ensureEnrolmentSchema(env.DB);
  const there = await env.DB
    .prepare('SELECT 1 AS x FROM enrolments WHERE wp_user_id = ? AND course_key = ?')
    .bind(wpUserId, pathId)
    .first();
  if (there) return true;
  if (now < enrolHealth.downUntil) return false;
  try {
    await env.DB.prepare('INSERT INTO enrolments (wp_user_id, course_key, created) VALUES (?, ?, ?)').bind(wpUserId, pathId, now).run();
  } catch (e) {
    if (isDuplicateKey(e)) return true;
    throw e;
  }
  try {
    await connector.enrol(wpUserId, pathId);
    return true;
  } catch (e) {
    console.error('sensei enrol failed', (e as Error)?.message);
    if (e instanceof ConnectorUnavailable) enrolHealth.downUntil = now + ENROL_RETRY_MS;
    await env.DB.prepare('DELETE FROM enrolments WHERE wp_user_id = ? AND course_key = ?').bind(wpUserId, pathId).run();
    return false;
  }
}

export async function deleteEnrolments(env: Env, wpUserId: number): Promise<void> {
  await ensureEnrolmentSchema(env.DB);
  await env.DB.prepare('DELETE FROM enrolments WHERE wp_user_id = ?').bind(wpUserId).run();
}
