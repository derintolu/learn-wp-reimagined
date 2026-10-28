// Imports each new course version into the LRS once (ruling R21: Task 19's course cache registers this with
// onNewVersion). The ETags already imported are remembered in env.DB (lrs_imports).
import type { Env } from '../env';
import { SERVER_FLAGS } from '../config';
import { ensureRecordSchema, isDuplicateKey } from '../db';
import { LrsClient } from './client';

export async function importCourseOnNewVersion(env: Env, zip: Uint8Array, etag: string): Promise<void> {
  if (!SERVER_FLAGS.lrsShadow) return;
  await ensureRecordSchema(env.DB);
  if (await env.DB.prepare('SELECT etag FROM lrs_imports WHERE etag = ?').bind(etag).first()) return;
  await new LrsClient(env).importCourse(zip, etag);
  try {
    await env.DB.prepare('INSERT INTO lrs_imports (etag, imported) VALUES (?, ?)').bind(etag, Date.now()).run();
  } catch (e) {
    if (!isDuplicateKey(e)) throw e;
  }
}
