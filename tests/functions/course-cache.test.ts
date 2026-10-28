import { importCourseOnNewVersion } from '../../functions/_lib/lrs/import';
import { getStandardCourse } from '../../functions/_lib/mcp/standardCourse';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { zipSync } from 'fflate';
import { createSqliteD1 } from '../../dev/sqliteD1';
import { SERVER_FLAGS } from '../../functions/_lib/config';
import { buildContent } from '../../scripts/build-content';
import { bundleToPackage } from '../../src/shared/package';
import { getContent, setContentForTests, setCurrentContent } from '../../functions/_lib/content';
import { COURSE_REVALIDATE_MS, onNewVersion, refreshContent, resetCourseCacheForTests } from '../../functions/_lib/course/cache';
import { GET as course } from '../../functions/api/course';
import { signRequest } from '../../functions/_lib/ledger/sign';
import { POST as ping } from '../../functions/api/content-changed';
import type { Env } from '../../functions/_lib/env';

vi.mock('../../functions/_lib/lrs/import', () => ({ importCourseOnNewVersion: vi.fn(async () => {}) }));

const SEED_HEX = '9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60';
const KEY = Buffer.from('302e020100300506032b657004220420' + SEED_HEX, 'hex').toString('base64');
const PUBLIC_B64 = Buffer.from('d75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a', 'hex').toString('base64');
const T0 = Date.UTC(2026, 9, 28, 12, 0, 0);

const bundle = buildContent('tests/fixtures/content');
const enc = new TextEncoder();
const zipOf = () => zipSync(Object.fromEntries(Object.entries(bundleToPackage(bundle)).map(([k, v]) => [k, enc.encode(v)])));

let env: Env;
let fetchMock: ReturnType<typeof vi.fn>;
const send200 = (etag: string, version: number) =>
  fetchMock.mockImplementationOnce(async () => new Response(zipOf(), { status: 200, headers: { ETag: etag, 'X-Package-Version': String(version) } }));

beforeEach(() => {
  SERVER_FLAGS.wordpressContent = true;
  env = { DB: createSqliteD1(), CONNECTOR_SIGNING_KEY: KEY, CONNECTOR_KEY_ID: 'kid1', CONNECTOR_PING_PUBLIC_KEY: PUBLIC_B64 } as Env;
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
  vi.spyOn(console, 'error').mockImplementation(() => {});
  setContentForTests(null);
  setCurrentContent(null);
  resetCourseCacheForTests();
});
afterEach(() => {
  SERVER_FLAGS.wordpressContent = false;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  setCurrentContent(null);
});

describe('refreshContent', () => {
  it('is a no-op that never calls the connector while the flag is off', async () => {
    SERVER_FLAGS.wordpressContent = false;
    const r = await refreshContent(env, T0);
    expect(r.changed).toBe(false);
    expect(r.etag).toMatch(/^"baked-/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('serves the cached copy for 5 minutes without calling the connector', async () => {
    send200('"e1"', 1);
    expect(await refreshContent(env, T0)).toEqual({ etag: '"e1"', version: 1, changed: true });
    const r = await refreshContent(env, T0 + COURSE_REVALIDATE_MS - 1);
    expect(r).toEqual({ etag: '"e1"', version: 1, changed: false });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(Object.keys(getContent().lessons).sort()).toEqual(Object.keys(bundle.lessons).sort());
  });

  it('revalidates after 5 minutes with If-None-Match', async () => {
    send200('"e1"', 1);
    await refreshContent(env, T0);
    fetchMock.mockImplementationOnce(async () => new Response(null, { status: 304 }));
    const r = await refreshContent(env, T0 + COURSE_REVALIDATE_MS);
    expect(r).toEqual({ etag: '"e1"', version: 1, changed: false });
    const init = fetchMock.mock.calls[1]![1] as RequestInit;
    expect((init.headers as Record<string, string>)['If-None-Match']).toBe('"e1"');
    // The 304 restarted the 5 minutes.
    await refreshContent(env, T0 + COURSE_REVALIDATE_MS + 1000);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('serves the last good copy when the connector is down', async () => {
    send200('"e1"', 1);
    await refreshContent(env, T0);
    fetchMock.mockRejectedValueOnce(new Error('down'));
    const r = await refreshContent(env, T0 + COURSE_REVALIDATE_MS);
    expect(r).toEqual({ etag: '"e1"', version: 1, changed: false });
  });

  it('falls back to the baked bundle when the connector is down and nothing is cached', async () => {
    fetchMock.mockRejectedValueOnce(new Error('down'));
    const r = await refreshContent(env, T0);
    expect(r.etag).toMatch(/^"baked-/);
  });

  it('new version runs onNewVersion hooks once', async () => {
    const hook = vi.fn(async () => {});
    const off = onNewVersion(hook);
    send200('"e1"', 1);
    await refreshContent(env, T0);
    expect(hook).toHaveBeenCalledTimes(1);
    expect(hook).toHaveBeenCalledWith(expect.any(Uint8Array), '"e1"', env);
    send200('"e1"', 1);
    await refreshContent(env, T0 + 1, { force: true });
    expect(hook).toHaveBeenCalledTimes(1);
    send200('"e2"', 2);
    await refreshContent(env, T0 + 2, { force: true });
    expect(hook).toHaveBeenCalledTimes(2);
    off();
  });
});

describe('POST /api/content-changed', () => {
  const body = enc.encode('{"program":"learn-wp-reimagined","version":2,"etag":"\\"e2\\""}');
  const URL_ = 'http://x/api/content-changed';
  // Signed the way the plugin's Connector_Keys::sign does (Task 18's signRequest matches the PHP vector).
  const signed = (o: { path?: string; now?: number; nonce?: string; body?: Uint8Array } = {}) =>
    signRequest({
      method: 'POST',
      path: o.path ?? '/api/content-changed',
      body: o.body ?? body,
      keyId: 'kid1',
      privateKeyPkcs8B64: KEY,
      now: o.now ?? Math.floor(Date.now() / 1000),
      nonce: o.nonce ?? crypto.randomUUID().replace(/-/g, ''),
    });
  const call = (headers: Record<string, string>, b = body) =>
    ping(new Request(URL_, { method: 'POST', headers, body: b }), { params: {}, env });

  it('a signed ping forces a refresh', async () => {
    send200('"e1"', 1);
    await refreshContent(env, Date.now());
    send200('"e2"', 2);
    const res = await call(await signed());
    expect(res.status).toBe(202);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const row = await env.DB.prepare('SELECT etag FROM course_cache').first<{ etag: string }>();
    expect(row!.etag).toBe('"e2"');
  });

  it('an unsigned or stale ping is 401', async () => {
    expect((await call({})).status).toBe(401);
    expect((await call(await signed({ now: Math.floor(Date.now() / 1000) - 3600 }))).status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('a ping for another path, a tampered body or a replayed nonce is 401', async () => {
    expect((await call(await signed({ path: '/api/other' }))).status).toBe(401);
    expect((await call(await signed(), enc.encode('{"x":1}'))).status).toBe(401);
    send200('"e1"', 1);
    const h = await signed({ nonce: 'samenonce' });
    expect((await call(h)).status).toBe(202);
    expect((await call(h)).status).toBe(401);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('failures and hooks', () => {
  it('a down connector costs one attempt per window, with or without a cached copy', async () => {
    fetchMock.mockRejectedValue(new Error('down'));
    await refreshContent(env, T0);
    await refreshContent(env, T0 + 1000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await refreshContent(env, T0 + COURSE_REVALIDATE_MS);
    expect(fetchMock).toHaveBeenCalledTimes(2);

    fetchMock.mockReset();
    env = { ...env, DB: createSqliteD1() };
    resetCourseCacheForTests();
    send200('"e1"', 1);
    await refreshContent(env, T0);
    fetchMock.mockRejectedValue(new Error('down'));
    await refreshContent(env, T0 + COURSE_REVALIDATE_MS);
    await refreshContent(env, T0 + COURSE_REVALIDATE_MS + 1000);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('a new etag calls importCourseOnNewVersion once (R21)', async () => {
    const imp = vi.mocked(importCourseOnNewVersion);
    imp.mockClear();
    send200('"e1"', 1);
    await refreshContent(env, T0);
    await refreshContent(env, T0 + 1, { force: false });
    expect(imp).toHaveBeenCalledTimes(1);
    expect(imp).toHaveBeenCalledWith(env, expect.any(Uint8Array), '"e1"');
  });

  it('a failed hook is retried on the next revalidation and does not break the refresh', async () => {
    let fail = true;
    const hook = vi.fn(async () => {
      if (fail) throw new Error('lrs down');
    });
    const off = onNewVersion(hook);
    send200('"e1"', 1);
    expect((await refreshContent(env, T0)).changed).toBe(true);
    expect(hook).toHaveBeenCalledTimes(1);
    fail = false;
    send200('"e1"', 1);
    await refreshContent(env, T0 + COURSE_REVALIDATE_MS);
    expect(hook).toHaveBeenCalledTimes(2);
    fetchMock.mockImplementationOnce(async () => new Response(null, { status: 304 }));
    await refreshContent(env, T0 + 2 * COURSE_REVALIDATE_MS);
    expect(hook).toHaveBeenCalledTimes(2);
    off();
  });

  it('MCP course models follow a refreshed bundle', async () => {
    send200('"e1"', 1);
    await refreshContent(env, T0);
    const first = getStandardCourse();
    expect(getStandardCourse()).toBe(first);
    send200('"e2"', 2);
    await refreshContent(env, T0 + 1, { force: true });
    expect(getStandardCourse()).not.toBe(first);
  });
});

describe('GET /api/course', () => {
  const get = (h: Record<string, string> = {}) => course(new Request('http://x/api/course', { headers: h }), { params: {}, env });

  it('answers 304 for a matching ETag', async () => {
    send200('"e1"', 1);
    const res = await get();
    expect(res.status).toBe(200);
    expect(res.headers.get('ETag')).toBe('"e1"');
    expect(res.headers.get('Cache-Control')).toBe('max-age=60, stale-while-revalidate=86400');
    expect(Object.keys((await res.json() as typeof bundle).lessons).sort()).toEqual(Object.keys(bundle.lessons).sort());
    const again = await get({ 'If-None-Match': '"e1"' });
    expect(again.status).toBe(304);
    expect(again.headers.get('ETag')).toBe('"e1"');
  });
});
