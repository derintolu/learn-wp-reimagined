import type { Env } from '../env';
import { ensureEnrolmentSchema, isDuplicateKey } from '../db';
import { ConnectorClient } from '../ledger/connector';
import type { PathId } from '../../../src/shared/types';

/**
 * Enrols a session learner in a path's Sensei course, once. The row is written first so a second event
 * finds it; if the enrolment itself fails the row is removed again, so the next event in that path retries.
 * Never throws for a connector failure: the event that triggered it must still be answered.
 */
export async function ensureEnrolled(
  env: Env,
  wpUserId: number,
  pathId: PathId,
  connector: Pick<ConnectorClient, 'enrol'> = new ConnectorClient(env),
  now = Date.now(),
): Promise<void> {
  await ensureEnrolmentSchema(env.DB);
  const there = await env.DB
    .prepare('SELECT 1 AS x FROM enrolments WHERE wp_user_id = ? AND course_key = ?')
    .bind(wpUserId, pathId)
    .first();
  if (there) return;
  try {
    await env.DB.prepare('INSERT INTO enrolments (wp_user_id, course_key, created) VALUES (?, ?, ?)').bind(wpUserId, pathId, now).run();
  } catch (e) {
    if (isDuplicateKey(e)) return;
    throw e;
  }
  try {
    await connector.enrol(wpUserId, pathId);
  } catch (e) {
    console.error('sensei enrol failed', (e as Error)?.message);
    await env.DB.prepare('DELETE FROM enrolments WHERE wp_user_id = ? AND course_key = ?').bind(wpUserId, pathId).run();
  }
}

export async function deleteEnrolments(env: Env, wpUserId: number): Promise<void> {
  await ensureEnrolmentSchema(env.DB);
  await env.DB.prepare('DELETE FROM enrolments WHERE wp_user_id = ?').bind(wpUserId).run();
}
