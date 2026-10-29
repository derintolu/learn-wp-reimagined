// Course cache (Task 19): the course package lives in WordPress (Learning Ledger); this keeps the last good copy in
// course_cache and revalidates it with If-None-Match at most every 5 minutes.
import type { Env } from '../env';
import { PROGRAM_KEY } from '../config';
import { ensureCourseCacheSchema } from '../db';
import { deleteOtherParts, readParts, splitUtf8, writeParts, type PartsTable } from '../blobParts';
import { getContent, setCurrentContent } from '../content';
import { ConnectorClient, ConnectorError, ConnectorUnavailable } from '../ledger/connector';
import { courseImportPending, importCourseOnNewVersion } from '../lrs/import';
import { buildAgentCourse } from '../mcp/agentCourse';
import { packageToBundle } from '../../../src/shared/package';
import { readZip } from '../../../vendor/course-xapi-mcp/core/package/index.ts';
import type { ContentBundle } from '../../../src/shared/types';

export const COURSE_REVALIDATE_MS = 300_000;

interface Row { etag: string; version: number; fetched: number; hooks_done: number }
type NewVersionHook = (zip: Uint8Array, etag: string, env: Env) => Promise<void>;

const hooks: NewVersionHook[] = [];

/** Registers a function run once for each new package version. Returns its unregister function. */
export function onNewVersion(fn: NewVersionHook): () => void {
  hooks.push(fn);
  return () => {
    const i = hooks.indexOf(fn);
    if (i >= 0) hooks.splice(i, 1);
  };
}

// Task 30 (R21): imports each new version into the LRS.
onNewVersion((zip, etag, env) => importCourseOnNewVersion(env, zip, etag));

let loadedEtag: string | null = null;
let baked: string | null = null;

/** FNV-1a over the baked bundle: a stable ETag for the content shipped with the build. */
export function bakedEtag(): string {
  if (baked) return baked;
  const s = JSON.stringify(getContent());
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193) >>> 0;
  return (baked = `"baked-${h.toString(16)}"`);
}

const PARTS: PartsTable = { table: 'course_cache_parts', keyCol: 'course_id', verCol: 'etag' };

/** Re-exported for the tests. */
export { splitUtf8 };

// The etag whose parts were missing or unreadable: the next refresh fetches that version in full to write them again.
let unusableEtag: string | null = null;

/** Loads the cached bundle into memory when it is not the one already loaded (the parts are read only then). */
async function use(env: Env, row: Row): Promise<void> {
  if (loadedEtag === row.etag) return;
  const text = await readParts(env.DB, PARTS, PROGRAM_KEY, row.etag);
  try {
    if (text === null) throw new Error('no stored parts');
    setCurrentContent(JSON.parse(text) as ContentBundle);
  } catch (e) {
    unusableEtag = row.etag;
    throw new Error(`unusable cached body: ${short(e)}`);
  }
  loadedEtag = row.etag;
  loadedVersion = Number(row.version);
}

/** A package that cannot be served: it does not decode, or the course it holds does not build. */
class PackageError extends Error {
  constructor(cause: unknown) {
    super(`package: ${(cause as Error)?.message ?? String(cause)}`);
    this.name = 'PackageError';
  }
}

/**
 * The bundle in a package, checked to build the MCP course model, so a package that loads but does not convert
 * never replaces the last good copy. Every failure is a PackageError.
 */
function decodePackage(zip: Uint8Array): ContentBundle {
  try {
    const files = readZip(zip);
    if ('code' in files && typeof files.code === 'string') throw new Error(files.code);
    const dec = new TextDecoder();
    const bundle = packageToBundle(Object.fromEntries(Object.entries(files as Record<string, Uint8Array>).map(([k, v]) => [k, dec.decode(v)])));
    buildAgentCourse(bundle);
    return bundle;
  } catch (e) {
    throw new PackageError(e);
  }
}

/** Runs every hook; true only if all succeeded. */
async function runHooks(env: Env, zip: Uint8Array, etag: string): Promise<boolean> {
  let ok = true;
  for (const hook of [...hooks]) {
    try {
      await hook(zip, etag, env);
    } catch (e) {
      ok = false;
      console.error('onNewVersion hook failed', (e as Error)?.message);
    }
  }
  return ok;
}

/** What this isolate is serving: the loaded bundle's etag, else the baked one (the etag always matches getContent()). */
function memory(): { etag: string; version: number; changed: boolean } {
  return loadedEtag ? { etag: loadedEtag, version: loadedVersion, changed: false } : { etag: bakedEtag(), version: 0, changed: false };
}

const short = (e: unknown) => String((e as Error)?.message ?? e).slice(0, 200);

let failedAt = 0;
let dbFailedAt = 0;
let loadedVersion = 0;

/**
 * The bundle's ETag and version after making sure the cache is current. Never throws (R49): a connector or package
 * failure keeps the last good copy, and a database failure is logged and served from memory or the baked snapshot.
 */
export async function refreshContent(
  env: Env,
  now = Date.now(),
  opts: { force?: boolean } = {},
): Promise<{ etag: string; version: number; changed: boolean }> {
  // A broken database costs one attempt per window, like a down connector.
  if (!opts.force && dbFailedAt && now - dbFailedAt < COURSE_REVALIDATE_MS) return memory();
  const stage = { name: 'schema' };
  try {
    const r = await refresh(env, now, opts, stage);
    dbFailedAt = 0;
    return r;
  } catch (e) {
    console.error('course cache db error', stage.name, short(e));
    dbFailedAt = now;
    return memory();
  }
}

async function refresh(
  env: Env,
  now: number,
  opts: { force?: boolean },
  stage: { name: string },
): Promise<{ etag: string; version: number; changed: boolean }> {
  await ensureCourseCacheSchema(env.DB);
  stage.name = 'select';
  const row = await env.DB.prepare('SELECT etag, version, fetched, hooks_done FROM course_cache WHERE course_id = ?')
    .bind(PROGRAM_KEY)
    .first<Row>();
  if (row && !opts.force && now - Number(row.fetched) < COURSE_REVALIDATE_MS) {
    stage.name = 'read';
    await use(env, row);
    return { etag: row.etag, version: Number(row.version), changed: false };
  }
  // No cached copy and the last attempt failed: do not try again until the window passes (one 3 s try per window).
  if (!row && !opts.force && failedAt && now - failedAt < COURSE_REVALIDATE_MS) return memory();
  // Hooks are pending for a version whose hooks failed, and for one cached before the LRS import ran and never
  // imported into the LRS.
  stage.name = 'hooks_pending';
  const hooksPending = !!row && (Number(row.hooks_done) === 0 || (await courseImportPending(env, row.etag)));
  const unusable = !!row && unusableEtag === row.etag;
  stage.name = 'fetch';
  try {
    // A version whose hooks failed is fetched in full again so the hooks can be retried with its zip.
    const res = await new ConnectorClient(env).getPackage(PROGRAM_KEY, hooksPending || unusable ? undefined : row?.etag);
    if (res.status === 304) {
      if (!row) throw new ConnectorUnavailable('ledger answered 304 with no cached copy');
      stage.name = 'touch';
      await env.DB.prepare('UPDATE course_cache SET fetched = ? WHERE course_id = ?').bind(now, PROGRAM_KEY).run();
      stage.name = 'read';
      await use(env, row);
      return { etag: row.etag, version: Number(row.version), changed: false };
    }
    const bundle = decodePackage(res.zip);
    const body = JSON.stringify(bundle);
    const changed = res.etag !== row?.etag;
    // In memory first: a database failure below still leaves this isolate serving the fetched content.
    setCurrentContent(bundle);
    loadedEtag = res.etag;
    loadedVersion = res.version;
    stage.name = row ? 'update' : 'insert';
    // Parts first, then the row that points at them, then the old parts: a reader never sees a half-written body.
    // An unchanged etag already has readable parts: they are rewritten only to repair an unusable copy, in place.
    if (changed || unusable) await writeParts(env.DB, PARTS, PROGRAM_KEY, res.etag, body, changed);
    if (row) {
      await env.DB.prepare('UPDATE course_cache SET etag = ?, version = ?, fetched = ?, hooks_done = ? WHERE course_id = ?')
        .bind(res.etag, res.version, now, changed ? 0 : Number(row.hooks_done), PROGRAM_KEY)
        .run();
    } else {
      await env.DB.prepare('INSERT INTO course_cache (course_id, etag, version, fetched, hooks_done) VALUES (?, ?, ?, ?, 0)')
        .bind(PROGRAM_KEY, res.etag, res.version, now)
        .run();
    }
    unusableEtag = null;
    if (changed) {
      stage.name = 'cleanup';
      try {
        await deleteOtherParts(env.DB, PARTS, PROGRAM_KEY, res.etag);
      } catch (e) {
        // Only orphaned parts are left behind; the next new version removes them.
        console.error('course cache db error', stage.name, short(e));
      }
    }
    failedAt = 0;
    if (changed || hooksPending) {
      if (await runHooks(env, res.zip, res.etag)) {
        stage.name = 'hooks_done';
        await env.DB.prepare('UPDATE course_cache SET hooks_done = 1 WHERE course_id = ? AND etag = ?').bind(PROGRAM_KEY, res.etag).run();
      }
    }
    return { etag: res.etag, version: res.version, changed };
  } catch (e) {
    // Only a database failure propagates; a connector or package failure keeps the last good copy.
    if (!(e instanceof ConnectorUnavailable) && !(e instanceof ConnectorError) && !(e instanceof PackageError)) throw e;
    console.error('course refresh failed', (e as Error)?.message);
    // Back off: record the attempt so a down connector costs one try per window, not one per request.
    failedAt = now;
    if (row) {
      stage.name = 'touch';
      await env.DB.prepare('UPDATE course_cache SET fetched = ? WHERE course_id = ?').bind(now, PROGRAM_KEY).run();
      stage.name = 'read';
      await use(env, row);
      return { etag: row.etag, version: Number(row.version), changed: false };
    }
    return memory();
  }
}

/**
 * For routes that read the course: loads the current copy into this isolate (refreshContent) so every route sees
 * the same course.
 */
export async function loadCurrentCourse(env: Env): Promise<void> {
  await refreshContent(env);
}

/** Test-only: forget what this isolate has loaded and any failure back-off. */
export function resetCourseCacheForTests(): void {
  loadedEtag = null;
  loadedVersion = 0;
  unusableEtag = null;
  failedAt = 0;
  dbFailedAt = 0;
}
