import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { zipSync } from 'fflate';
import { createSqliteD1 } from '../../dev/sqliteD1';
import { SERVER_FLAGS } from '../../functions/_lib/config';
import { buildContent } from '../../scripts/build-content';
import { bundleToPackage } from '../../src/shared/package';
import { getContent, setContentForTests, setCurrentContent } from '../../functions/_lib/content';
import { COURSE_REVALIDATE_MS, onNewVersion, refreshContent } from '../../functions/_lib/course/cache';
import { GET as course } from '../../functions/api/course';
import { POST as ping } from '../../functions/api/content-changed';
import type { Env } from '../../functions/_lib/env';

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
  async function signed(ts: number) {
    // verifySigned signs timestamp "." body; the test vector key signs it the way the plugin's notification does.
    const key = await crypto.subtle.importKey('pkcs8', Buffer.from(KEY, 'base64'), 'Ed25519', false, ['sign']);
    const msg = new Uint8Array([...enc.encode(`${ts}.`), ...body]);
    const sig = Buffer.from(await crypto.subtle.sign('Ed25519', key, msg)).toString('base64');
    return { 'X-Learning-Ledger-Timestamp': String(ts), 'X-Learning-Ledger-Signature': sig };
  }
  const call = (headers: Record<string, string>) =>
    ping(new Request('http://x/api/content-changed', { method: 'POST', headers, body }), { params: {}, env });

  it('a signed ping forces a refresh', async () => {
    send200('"e1"', 1);
    await refreshContent(env, Date.now());
    send200('"e2"', 2);
    const res = await call(await signed(Math.floor(Date.now() / 1000)));
    expect(res.status).toBe(202);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const row = await env.DB.prepare('SELECT etag FROM course_cache').first<{ etag: string }>();
    expect(row!.etag).toBe('"e2"');
  });

  it('an unsigned or stale ping is 401', async () => {
    expect((await call({})).status).toBe(401);
    expect((await call(await signed(Math.floor(Date.now() / 1000) - 3600))).status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
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
