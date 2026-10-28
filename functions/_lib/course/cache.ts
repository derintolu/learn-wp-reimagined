// Course cache (Task 19): the course package lives in WordPress (Learning Ledger); this keeps the last good copy in
// course_cache and revalidates it with If-None-Match at most every 5 minutes. With SERVER_FLAGS.wordpressContent
// off nothing here touches the connector or the database.
import type { Env } from '../env';
import { PROGRAM_KEY, SERVER_FLAGS } from '../config';
import { ensureCourseCacheSchema } from '../db';
import { getContent, setCurrentContent } from '../content';
import { ConnectorClient, ConnectorError, ConnectorUnavailable } from '../ledger/connector';
import { importCourseOnNewVersion } from '../lrs/import';
import { packageToBundle } from '../../../src/shared/package';
import { readZip } from '../../../vendor/course-xapi-mcp/core/package/index.ts';
import type { ContentBundle } from '../../../src/shared/types';

export const COURSE_REVALIDATE_MS = 300_000;

interface Row { etag: string; version: number; body: string; fetched: number }
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

// Task 30 (R21): imports each new version into the LRS; it does nothing while SERVER_FLAGS.lrsShadow is off.
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

function use(row: Row): void {
  if (loadedEtag === row.etag) return;
  setCurrentContent(JSON.parse(row.body) as ContentBundle);
  loadedEtag = row.etag;
}

function decodePackage(zip: Uint8Array): ContentBundle {
  const files = readZip(zip);
  if ('code' in files && typeof files.code === 'string') throw new Error(`package: ${files.code}`);
  const dec = new TextDecoder();
  return packageToBundle(Object.fromEntries(Object.entries(files as Record<string, Uint8Array>).map(([k, v]) => [k, dec.decode(v)])));
}

/** The bundle's ETag and version after making sure the cache is current. Never throws for a connector failure. */
export async function refreshContent(
  env: Env,
  now = Date.now(),
  opts: { force?: boolean } = {},
): Promise<{ etag: string; version: number; changed: boolean }> {
  if (!SERVER_FLAGS.wordpressContent) return { etag: bakedEtag(), version: 0, changed: false };
  await ensureCourseCacheSchema(env.DB);
  const row = await env.DB.prepare('SELECT etag, version, body, fetched FROM course_cache WHERE course_id = ?')
    .bind(PROGRAM_KEY)
    .first<Row>();
  if (row && !opts.force && now - Number(row.fetched) < COURSE_REVALIDATE_MS) {
    use(row);
    return { etag: row.etag, version: Number(row.version), changed: false };
  }
  try {
    const res = await new ConnectorClient(env).getPackage(PROGRAM_KEY, row?.etag);
    if (res.status === 304) {
      if (!row) throw new ConnectorUnavailable('ledger answered 304 with no cached copy');
      await env.DB.prepare('UPDATE course_cache SET fetched = ? WHERE course_id = ?').bind(now, PROGRAM_KEY).run();
      use(row);
      return { etag: row.etag, version: Number(row.version), changed: false };
    }
    const bundle = decodePackage(res.zip);
    const body = JSON.stringify(bundle);
    if (row) {
      await env.DB.prepare('UPDATE course_cache SET etag = ?, version = ?, body = ?, fetched = ? WHERE course_id = ?')
        .bind(res.etag, res.version, body, now, PROGRAM_KEY)
        .run();
    } else {
      await env.DB.prepare('INSERT INTO course_cache (course_id, etag, version, body, fetched) VALUES (?, ?, ?, ?, ?)')
        .bind(PROGRAM_KEY, res.etag, res.version, body, now)
        .run();
    }
    use({ etag: res.etag, version: res.version, body, fetched: now });
    const changed = res.etag !== row?.etag;
    if (changed) {
      for (const hook of [...hooks]) {
        try {
          await hook(res.zip, res.etag, env);
        } catch (e) {
          console.error('onNewVersion hook failed', (e as Error)?.message);
        }
      }
    }
    return { etag: res.etag, version: res.version, changed };
  } catch (e) {
    if (!(e instanceof ConnectorUnavailable) && !(e instanceof ConnectorError) && !/^package:/.test((e as Error)?.message ?? '')) throw e;
    console.error('course refresh failed', (e as Error)?.message);
    if (row) {
      use(row);
      return { etag: row.etag, version: Number(row.version), changed: false };
    }
    return { etag: bakedEtag(), version: 0, changed: false };
  }
}
