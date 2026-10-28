// Reading the learner's official record back from the LRS (Task 34): all statements of their registration,
// the cached projection, and the invalidation every decided event triggers.
import type { Env } from '../env';
import { ensureRecordSchema } from '../db';
import { LrsClient, type Actor } from '../lrs/client';
import type { Session } from '../session/session';
import { getRegistration } from './registration';
import { OFFICIAL_COURSE_ID, officialActor } from './official';
import { STATE_IDS } from '../../../vendor/course-xapi-mcp/core/constants';
import type { XapiStatement } from '../../../vendor/course-xapi-mcp/core/xapi/types';

/** A learner's statements fit well under this; the cap only stops a paging loop that never ends. */
const MAX_PAGES = 50;

export async function readCachedRecord(env: Env, actorName: string): Promise<string | null> {
  await ensureRecordSchema(env.DB);
  const row = await env.DB.prepare('SELECT body FROM record_cache WHERE actor_name = ?').bind(actorName).first<{ body: string }>();
  return row?.body ?? null;
}

export async function writeCachedRecord(env: Env, actorName: string, body: string, now: number): Promise<void> {
  await ensureRecordSchema(env.DB);
  await env.DB.prepare('DELETE FROM record_cache WHERE actor_name = ?').bind(actorName).run();
  await env.DB.prepare('INSERT INTO record_cache (actor_name, body, at) VALUES (?, ?, ?)').bind(actorName, body, now).run();
}

/** Called after events are decided; never fails the batch. */
export async function invalidateRecordCache(env: Env, actorName: string): Promise<void> {
  try {
    await ensureRecordSchema(env.DB);
    await env.DB.prepare('DELETE FROM record_cache WHERE actor_name = ?').bind(actorName).run();
  } catch (e) {
    console.error('record cache invalidation failed', (e as Error)?.message);
  }
}

/** Every statement the LRS holds for this learner's registration, and the actor and registration used. */
export async function loadStatements(env: Env, s: Session, client = new LrsClient(env)): Promise<{ actor: Actor; registration: string; statements: XapiStatement[] }> {
  const registration = await getRegistration(env, s);
  const actor = officialActor(s.actorName) as Actor;
  const statements: XapiStatement[] = [];
  let page = await client.getStatements({ agent: actor, registration });
  statements.push(...page.statements);
  for (let i = 1; page.more && i < MAX_PAGES; i++) {
    page = await client.getStatementsMore(page.more);
    statements.push(...page.statements);
  }
  return { actor, registration, statements };
}

/** The `files` of the learner's State document, or {} when there is none. */
export async function loadFiles(client: LrsClient, actor: Actor, registration: string): Promise<Record<string, string>> {
  const doc = await client.getState({ activityId: OFFICIAL_COURSE_ID, agent: actor, registration, stateId: STATE_IDS.learner });
  const files = (doc?.body as { files?: unknown } | undefined)?.files;
  if (!files || typeof files !== 'object' || Array.isArray(files)) return {};
  return Object.fromEntries(Object.entries(files).filter((e): e is [string, string] => typeof e[1] === 'string'));
}
