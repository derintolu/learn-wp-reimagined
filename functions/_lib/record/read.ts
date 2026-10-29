// Reading the learner's official record back from the LRS (Task 34): all statements of their registration,
// the cached projection, and the invalidation every decided event triggers.
import type { Env } from '../env';
import { ensureRecordSchema } from '../db';
import { deleteOtherParts, readParts, writeParts, type PartsTable } from '../blobParts';
import { LrsClient, type Actor } from '../lrs/client';
import type { Session } from '../session/session';
import { getRegistration } from './registration';
import { OFFICIAL_COURSE_ID, officialActor } from './official';
import { STATE_IDS } from '../../../vendor/course-xapi-mcp/core/constants';
import type { XapiStatement } from '../../../vendor/course-xapi-mcp/core/xapi/types';
import { STATE_ID, mergeFilesDocs, parseFilesDoc } from '../../../src/shared/stateDoc';

/** A cached record older than this is read again from the LRS: a backstop for statements stored after the cache filled. */
export const RECORD_CACHE_TTL_MS = 60_000;

/** A learner's statements fit well under this; the cap only stops a paging loop that never ends. */
const MAX_PAGES = 50;

const PARTS: PartsTable = { table: 'record_cache_parts', keyCol: 'actor_name', verCol: 'at' };

/** The cached projection while fresh. A missing or unparseable body is a cache miss: the record is read from the LRS again. */
export async function readCachedRecord(env: Env, actorName: string, now = Date.now()): Promise<string | null> {
  await ensureRecordSchema(env.DB);
  const row = await env.DB.prepare('SELECT at FROM record_cache WHERE actor_name = ?').bind(actorName).first<{ at: number | string }>();
  if (!row || now - Number(row.at) >= RECORD_CACHE_TTL_MS) return null;
  try {
    const body = await readParts(env.DB, PARTS, actorName, Number(row.at));
    if (body === null) return null;
    JSON.parse(body);
    return body;
  } catch {
    return null;
  }
}

/** Parts first, then the pointer row, then the parts of earlier versions: a reader never sees a half-written body. */
export async function writeCachedRecord(env: Env, actorName: string, body: string, now: number): Promise<void> {
  await ensureRecordSchema(env.DB);
  await writeParts(env.DB, PARTS, actorName, now, body, true);
  await env.DB.prepare('DELETE FROM record_cache WHERE actor_name = ?').bind(actorName).run();
  await env.DB.prepare('INSERT INTO record_cache (actor_name, at) VALUES (?, ?)').bind(actorName, now).run();
  await deleteOtherParts(env.DB, PARTS, actorName, now);
}

/** Called after events are decided; never fails the batch. */
export async function invalidateRecordCache(env: Env, actorName: string): Promise<void> {
  try {
    await ensureRecordSchema(env.DB);
    await env.DB.prepare('DELETE FROM record_cache WHERE actor_name = ?').bind(actorName).run();
    await deleteOtherParts(env.DB, PARTS, actorName);
  } catch (e) {
    console.error('record cache invalidation failed', (e as Error)?.message);
  }
}

/** Every statement the LRS holds for this learner's registration, and the actor and registration used. */
export async function loadStatements(env: Env, s: Session, client = new LrsClient(env)): Promise<{ actor: Actor; registration: string; statements: XapiStatement[]; complete: boolean }> {
  const registration = await getRegistration(env, s);
  const actor = officialActor(s.actorName) as Actor;
  const statements: XapiStatement[] = [];
  let page = await client.getStatements({ agent: actor, registration });
  statements.push(...page.statements);
  for (let i = 1; page.more && i < MAX_PAGES; i++) {
    page = await client.getStatementsMore(page.more);
    statements.push(...page.statements);
  }
  return { actor, registration, statements, complete: !page.more };
}

/**
 * The learner's files: the studio's files document (lwr-files, where the studio and the agent both write), merged
 * with the files in the agent's engine document (cxm-learner-state); for a file in both, the studio document's
 * copy wins, since every agent edit is written there too. {} when there is neither.
 */
export async function loadFiles(client: LrsClient, actor: Actor, registration: string): Promise<Record<string, string>> {
  const key = (stateId: string) => ({ activityId: OFFICIAL_COURSE_ID, agent: actor, registration, stateId });
  const studio = parseFilesDoc((await client.getState(key(STATE_ID.files)))?.body) ?? { files: {} };
  const files = ((await client.getState(key(STATE_IDS.learner)))?.body as { files?: unknown } | undefined)?.files;
  const engine = files && typeof files === 'object' && !Array.isArray(files)
    ? Object.fromEntries(Object.entries(files).filter((e): e is [string, string] => typeof e[1] === 'string'))
    : {};
  return mergeFilesDocs(studio, { files: engine }).files;
}
