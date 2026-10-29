import { importCourseOnNewVersion } from '../../functions/_lib/lrs/import';
import { getStandardCourse } from '../../functions/_lib/mcp/standardCourse';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { zipSync } from 'fflate';
import { createSqliteD1 } from '../../dev/sqliteD1';
import { SERVER_FLAGS } from '../../functions/_lib/config';
import { buildContent } from '../../scripts/build-content';
import { bundleToPackage } from '../../src/shared/package';
import { getContent, setContentForTests, setCurrentContent } from '../../functions/_lib/content';
import { COURSE_REVALIDATE_MS, splitUtf8, onNewVersion, refreshContent, resetCourseCacheForTests } from '../../functions/_lib/course/cache';
import { guarded } from '../../functions/_lib/ai';
import { GET as course } from '../../functions/api/course';
import { signRequest } from '../../functions/_lib/ledger/sign';
import { POST as ping } from '../../functions/api/content-changed';
import { POST as mcpPing } from '../../functions/api/mcp/content-changed';
import type { Env } from '../../functions/_lib/env';
import { ensureRecordSchema } from '../../functions/_lib/db';
import { handleMcp } from '../../functions/_lib/mcp/handler';
import { POST as agentRecord } from '../../functions/api/agent/record';
import { GET as recordGet } from '../../functions/api/record';
import { GET as badgesGet } from '../../functions/api/badges';
import { GET as adminShadow } from '../../functions/api/admin/shadow';
import generated from '../../src/generated/content.json';

vi.mock('../../functions/_lib/lrs/import', async (actual) => ({
  ...(await actual<typeof import('../../functions/_lib/lrs/import')>()),
  importCourseOnNewVersion: vi.fn(async () => {}),
}));

const SEED_HEX = '9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60';
const KEY = Buffer.from('302e020100300506032b657004220420' + SEED_HEX, 'hex').toString('base64');
const PUBLIC_B64 = Buffer.from('d75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a', 'hex').toString('base64');
const T0 = Date.UTC(2026, 9, 28, 12, 0, 0);

const bundle = buildContent('tests/fixtures/content');
const enc = new TextEncoder();
const zipOf = (b = bundle) => zipSync(Object.fromEntries(Object.entries(bundleToPackage(b)).map(([k, v]) => [k, enc.encode(v)])));

let env: Env;
let fetchMock: ReturnType<typeof vi.fn>;
const send200 = (etag: string, version: number, b = bundle) =>
  fetchMock.mockImplementationOnce(async () => new Response(zipOf(b), { status: 200, headers: { ETag: etag, 'X-Package-Version': String(version) } }));

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

describe('POST /api/mcp/content-changed (R48)', () => {
  const body = enc.encode('{"program":"course","version":2,"etag":"\\"e2\\""}');
  const signedFor = (path: string) =>
    signRequest({ method: 'POST', path, body, keyId: 'kid1', privateKeyPkcs8B64: KEY, now: Math.floor(Date.now() / 1000), nonce: crypto.randomUUID().replace(/-/g, '') });
  const call = (headers: Record<string, string>) =>
    mcpPing(new Request('http://x/api/mcp/content-changed', { method: 'POST', headers, body }), { params: {}, env });

  it('a ping signed for its own path is 202', async () => {
    send200('"e1"', 1);
    expect((await call(await signedFor('/api/mcp/content-changed'))).status).toBe(202);
  });

  it('a ping signed for the other path is 401', async () => {
    expect((await call(await signedFor('/api/content-changed'))).status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
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

describe('import into the LRS when lrsShadow flips after wordpressContent (R30 order)', () => {
  afterEach(() => {
    SERVER_FLAGS.lrsShadow = false;
  });

  it('a cache filled with lrsShadow off imports on the first refresh after it flips on', async () => {
    const imp = vi.mocked(importCourseOnNewVersion);
    imp.mockClear();
    send200('"e1"', 1);
    await refreshContent(env, T0);
    // The hook ran (and did nothing, the flag being off), so the version counts as done.
    expect(imp).toHaveBeenCalledTimes(1);
    SERVER_FLAGS.lrsShadow = true;
    await ensureRecordSchema(env.DB);
    // Not yet imported: the full package is fetched again, without If-None-Match, so the hook has the zip.
    send200('"e1"', 1);
    await refreshContent(env, T0 + COURSE_REVALIDATE_MS);
    const init = fetchMock.mock.calls[1]![1] as RequestInit;
    expect((init.headers as Record<string, string>)['If-None-Match']).toBeUndefined();
    expect(imp).toHaveBeenCalledTimes(2);
    expect(imp).toHaveBeenLastCalledWith(env, expect.any(Uint8Array), '"e1"');
    // Once lrs_imports holds the ETag, revalidation goes back to If-None-Match.
    await env.DB.prepare('INSERT INTO lrs_imports (etag, imported) VALUES (?, ?)').bind('"e1"', T0).run();
    fetchMock.mockImplementationOnce(async () => new Response(null, { status: 304 }));
    await refreshContent(env, T0 + 2 * COURSE_REVALIDATE_MS);
    expect(((fetchMock.mock.calls[2]![1] as RequestInit).headers as Record<string, string>)['If-None-Match']).toBe('"e1"');
    expect(imp).toHaveBeenCalledTimes(2);
  });
});

describe('a package that loads but does not build the course', () => {
  const broken = () => {
    const b = structuredClone(bundle);
    Object.values(b.lessons)[0]!.title = '';
    return b;
  };

  it('keeps the last good copy, and /api/mcp keeps serving it', async () => {
    send200('"e1"', 1);
    await refreshContent(env, T0);
    send200('"e2"', 2, broken());
    expect(await refreshContent(env, T0 + COURSE_REVALIDATE_MS)).toEqual({ etag: '"e1"', version: 1, changed: false });
    expect(() => getStandardCourse()).not.toThrow();
    expect(Object.values(getContent().lessons)[0]!.title).not.toBe('');
    // Backed off for the window, like a connector failure.
    await refreshContent(env, T0 + COURSE_REVALIDATE_MS + 1000);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('with nothing cached, serves the baked bundle and backs off', async () => {
    send200('"e2"', 2, broken());
    expect((await refreshContent(env, T0)).etag).toMatch(/^"baked-/);
    await refreshContent(env, T0 + 1000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('any decode error (not only a package: error) keeps the last good copy', async () => {
    send200('"e1"', 1);
    await refreshContent(env, T0);
    fetchMock.mockImplementationOnce(async () => new Response(new Uint8Array([1, 2, 3]), { status: 200, headers: { ETag: '"e3"', 'X-Package-Version': '3' } }));
    expect(await refreshContent(env, T0 + COURSE_REVALIDATE_MS)).toEqual({ etag: '"e1"', version: 1, changed: false });
  });

  it('a database failure never escapes: it is logged and the baked etag is served (R49)', async () => {
    env = { ...env, DB: { prepare: () => { throw new Error('D1 is down'); } } as unknown as Env['DB'] };
    const r = await refreshContent(env, T0);
    expect(r.etag).toMatch(/^"baked-/);
    expect(console.error).toHaveBeenCalledWith('course cache db error', 'schema', 'D1 is down');
  });
});

/** A D1 whose statements matching `sql` throw, over a real SQLite. */
function failingOn(sql: RegExp): Env['DB'] {
  const real = createSqliteD1();
  return { prepare: (q: string) => (sql.test(q) ? { bind: () => ({ run: async () => { throw new Error('too big'); }, first: async () => { throw new Error('too big'); }, all: async () => { throw new Error('too big'); } }) } : real.prepare(q)) } as unknown as Env['DB'];
}

describe('a course-cache database failure never fails a learner request (R49)', () => {
  const get = () => course(new Request('http://x/api/course'), { params: {}, env });

  it('an INSERT that throws still serves the fetched content, and logs once per window', async () => {
    env = { ...env, DB: failingOn(/^INSERT INTO course_cache/) };
    send200('"e1"', 1);
    const res = await get();
    expect(res.status).toBe(200);
    expect(res.headers.get('ETag')).toBe('"e1"');
    expect(Object.keys((await res.json() as typeof bundle).lessons).sort()).toEqual(Object.keys(bundle.lessons).sort());
    expect((await get()).status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const logs = (console.error as unknown as { mock: { calls: unknown[][] } }).mock.calls.filter((c) => c[0] === 'course cache db error');
    expect(logs).toEqual([['course cache db error', 'insert', 'too big']]);
    // The window passes: one more attempt.
    send200('"e1"', 1);
    await refreshContent(env, Date.now() + COURSE_REVALIDATE_MS + 1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('after a failed INSERT, a down connector in the next window keeps the etag of the content in memory', async () => {
    env = { ...env, DB: failingOn(/^INSERT INTO course_cache/) };
    send200('"e1"', 1);
    await refreshContent(env, T0);
    fetchMock.mockRejectedValue(new Error('down'));
    const later = T0 + COURSE_REVALIDATE_MS + 1;
    const r = await refreshContent(env, later);
    expect(r.etag).toBe('"e1"');
    // And within the connector back-off window.
    expect((await refreshContent(env, later + 1000)).etag).toBe('"e1"');
  });

  it('a SELECT that throws answers 200 with the baked content', async () => {
    env = { ...env, DB: failingOn(/^SELECT etag/) };
    const res = await get();
    expect(res.status).toBe(200);
    expect(res.headers.get('ETag')).toMatch(/^"baked-/);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(console.error).toHaveBeenCalledWith('course cache db error', 'select', 'too big');
  });
});

describe('guarded', () => {
  it('logs an unexpected error and still answers 500 server-error', async () => {
    const res = await guarded(async () => { throw new TypeError('boom'); });
    expect(res.status).toBe(500);
    expect(((await res.json()) as { error: { code: string } | string }).error).toBeTruthy();
    expect(console.error).toHaveBeenCalledWith('unhandled', 'TypeError', 'boom');
  });
});

describe('every route that reads the course loads the current copy first', () => {
  const lessonsNow = () => Object.keys(getContent().lessons).sort();
  const wp = Object.keys(bundle.lessons).sort();
  const coldIsolate = async () => {
    send200('"e1"', 1);
    await refreshContent(env, T0);
    resetCourseCacheForTests();
    setCurrentContent(null);
    expect(lessonsNow()).toEqual(Object.keys((generated as any).lessons).sort());
    // Within the 5 minutes: the route loads the cached copy without asking the connector.
    vi.useFakeTimers({ now: T0 + 1000, toFake: ['Date'] });
  };
  afterEach(() => {
    vi.useRealTimers();
    SERVER_FLAGS.badges = false;
    SERVER_FLAGS.officialRecord = false;
  });

  it('/api/mcp', async () => {
    await coldIsolate();
    await handleMcp(new Request('http://x/api/mcp', { method: 'GET' }), env);
    expect(lessonsNow()).toEqual(wp);
  });

  it('/api/agent/*', async () => {
    await coldIsolate();
    await agentRecord(new Request('http://x/api/agent/record', { method: 'POST', body: '{}' }), { params: {}, env });
    expect(lessonsNow()).toEqual(wp);
  });

  it('/api/record', async () => {
    SERVER_FLAGS.officialRecord = true;
    await coldIsolate();
    await recordGet(new Request('http://x/api/record'), { params: {}, env });
    expect(lessonsNow()).toEqual(wp);
  });

  it('/api/badges', async () => {
    SERVER_FLAGS.badges = true;
    await coldIsolate();
    await badgesGet(new Request('http://x/api/badges'), { params: {}, env });
    expect(lessonsNow()).toEqual(wp);
  });

  it('/api/admin/shadow', async () => {
    await coldIsolate();
    await adminShadow(new Request('http://x/api/admin/shadow?day=2026-10-28', { headers: { authorization: 'Bearer adm' } }), { params: {}, env: { ...env, ADMIN_TOKEN: 'adm' } });
    expect(lessonsNow()).toEqual(wp);
  });

  it('with wordpressContent off none of them touches the connector or the database cache', async () => {
    SERVER_FLAGS.wordpressContent = false;
    SERVER_FLAGS.badges = true;
    SERVER_FLAGS.officialRecord = true;
    await handleMcp(new Request('http://x/api/mcp', { method: 'GET' }), env);
    await agentRecord(new Request('http://x/api/agent/record', { method: 'POST', body: '{}' }), { params: {}, env });
    await recordGet(new Request('http://x/api/record'), { params: {}, env });
    await badgesGet(new Request('http://x/api/badges'), { params: {}, env });
    await adminShadow(new Request('http://x/api/admin/shadow?day=2026-10-28', { headers: { authorization: 'Bearer adm' } }), { params: {}, env: { ...env, ADMIN_TOKEN: 'adm' } });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(await env.DB.prepare("SELECT name FROM sqlite_master WHERE name = 'course_cache'").first()).toBeNull();
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

/** A D1 over SQLite that refuses any statement over 65,536 bytes (its text plus bound values), like Spacefast's broker. */
function brokerLimited(real: Env['DB'], log: { max: number } = { max: 0 }): Env['DB'] {
  const size = (sql: string, v: unknown[]) => Buffer.byteLength(sql) + v.reduce<number>((n, x) => n + (typeof x === 'string' ? Buffer.byteLength(x) : 8), 0);
  const wrap = (sql: string, v: unknown[]) => {
    const check = () => {
      const n = size(sql, v);
      log.max = Math.max(log.max, n);
      if (n > 65_536) throw new Error(`Database operation is ${n} bytes; the limit is 65536.`);
    };
    const q = real.prepare(sql).bind(...v);
    return {
      bind: (...nv: unknown[]) => wrap(sql, nv),
      run: async () => (check(), q.run()),
      first: async () => (check(), q.first()),
      all: async () => (check(), q.all()),
    };
  };
  return { prepare: (sql: string) => wrap(sql, []) } as unknown as Env['DB'];
}

describe('splitUtf8', () => {
  it('never splits a multibyte character, keeps every part within the limit and joins back to the input', () => {
    const s = 'a\u00e9\u20ac\u{1F600}'.repeat(500) + 'tail';
    for (const max of [4, 5, 7, 100, 1001]) {
      const parts = splitUtf8(s, max);
      expect(parts.join('')).toBe(s);
      for (const p of parts) {
        expect(Buffer.byteLength(p)).toBeLessThanOrEqual(max);
        expect(p).not.toMatch(/[\ud800-\udbff]$|^[\udc00-\udfff]/);
      }
    }
    expect(splitUtf8('', 10)).toEqual(['']);
  });
});

describe('the cached body is stored in parts under the broker limit', () => {
  const padOf = (b: typeof bundle) => (b.lessons[Object.keys(bundle.lessons)[0]!] as unknown as { beats: { content: string }[] }).beats[0]!.content;
  const withPad = (pad: string) => {
    const b = structuredClone(bundle);
    (b.lessons[Object.keys(bundle.lessons)[0]!] as unknown as { beats: { content: string }[] }).beats[0]!.content = pad;
    return b;
  };
  const big = () => withPad('caf\u00e9 \u20ac '.repeat(15_000));
  const get = () => course(new Request('http://x/api/course'), { params: {}, env });

  it('round-trips a 157 KB bundle and serves it from the database on a fresh isolate', async () => {
    const b = big();
    expect(Buffer.byteLength(JSON.stringify(b))).toBeGreaterThan(150_000);
    const log = { max: 0 };
    env = { ...env, DB: brokerLimited(createSqliteD1(), log) };
    send200('"e1"', 1, b);
    expect((await get()).status).toBe(200);
    expect(console.error).not.toHaveBeenCalledWith('course cache db error', expect.anything(), expect.anything());
    expect(log.max).toBeLessThanOrEqual(65_536);
    const n = await env.DB.prepare('SELECT COUNT(*) AS n FROM course_cache_parts').first<{ n: number }>();
    expect(n!.n).toBeGreaterThan(3);
    expect((await env.DB.prepare('SELECT body FROM course_cache').first<{ body: string | null }>())!.body).toBeNull();

    resetCourseCacheForTests();
    setCurrentContent(null);
    vi.useFakeTimers({ now: Date.now() + 1000, toFake: ['Date'] });
    try {
      const res = await get();
      expect(res.headers.get('ETag')).toBe('"e1"');
      expect(padOf((await res.json()) as typeof bundle)).toBe(padOf(b).trim());
      expect(fetchMock).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('an interrupted write (parts written, row not updated) leaves the previous body readable', async () => {
    const b1 = big();
    send200('"e1"', 1, b1);
    await refreshContent(env, T0);
    const real = env.DB;
    env = { ...env, DB: { prepare: (q: string) => (/^UPDATE course_cache SET etag/.test(q) ? { bind: () => ({ run: async () => { throw new Error('cut off'); } }) } : real.prepare(q)) } as unknown as Env['DB'] };
    const b2 = withPad('new');
    send200('"e2"', 2, b2);
    await refreshContent(env, T0 + COURSE_REVALIDATE_MS);
    env = { ...env, DB: real };
    resetCourseCacheForTests();
    setCurrentContent(null);
    fetchMock.mockImplementationOnce(async () => new Response(null, { status: 304 }));
    const r = await refreshContent(env, T0 + COURSE_REVALIDATE_MS + 1);
    expect(r.etag).toBe('"e1"');
    expect(padOf(getContent())).toBe(padOf(b1).trim());
  });

  it('missing parts fall back, log a read error, and the version is fetched in full to write them again', async () => {
    send200('"e1"', 1);
    await refreshContent(env, T0);
    await env.DB.prepare('DELETE FROM course_cache_parts').run();
    resetCourseCacheForTests();
    setCurrentContent(null);
    const r = await refreshContent(env, T0 + 1000);
    expect(r.etag).toMatch(/^"baked-/);
    expect(console.error).toHaveBeenCalledWith('course cache db error', 'read', expect.stringContaining('unusable cached body'));
    send200('"e1"', 1);
    expect(await refreshContent(env, T0 + COURSE_REVALIDATE_MS + 2000, { force: true })).toMatchObject({ etag: '"e1"' });
    expect((fetchMock.mock.calls[1]![1] as RequestInit).headers).not.toHaveProperty('If-None-Match');
    resetCourseCacheForTests();
    setCurrentContent(null);
    expect((await refreshContent(env, T0 + COURSE_REVALIDATE_MS + 3000)).etag).toBe('"e1"');
  });

  it('removes the parts of the replaced etag', async () => {
    send200('"e1"', 1);
    await refreshContent(env, T0);
    send200('"e2"', 2);
    await refreshContent(env, T0 + 1, { force: true });
    const { results } = await env.DB.prepare('SELECT DISTINCT etag FROM course_cache_parts').all<{ etag: string }>();
    expect(results.map((r) => r.etag)).toEqual(['"e2"']);
  });

  it('an unchanged-etag refetch (hooks pending) performs no part writes', async () => {
    const hook = vi.fn(async () => { throw new Error('hook down'); });
    const off = onNewVersion(hook);
    send200('"e1"', 1);
    await refreshContent(env, T0);
    off();
    const real = env.DB;
    const writes: string[] = [];
    env = { ...env, DB: { prepare: (q: string) => { if (/course_cache_parts/.test(q) && !/^(SELECT|CREATE)/.test(q)) writes.push(q); return real.prepare(q); } } as unknown as Env['DB'] };
    send200('"e1"', 1);
    await refreshContent(env, T0 + 1, { force: true });
    expect(writes).toEqual([]);
    expect((await real.prepare('SELECT COUNT(*) AS n FROM course_cache_parts').first<{ n: number }>())!.n).toBeGreaterThan(0);
  });

  it('a failed cleanup of old parts is logged and the hooks still run', async () => {
    const hook = vi.fn(async () => {});
    const off = onNewVersion(hook);
    send200('"e1"', 1);
    await refreshContent(env, T0);
    const real = env.DB;
    env = { ...env, DB: { prepare: (q: string) => (/^DELETE FROM course_cache_parts WHERE course_id = \? AND etag <>/.test(q) ? { bind: () => ({ run: async () => { throw new Error('cleanup down'); } }) } : real.prepare(q)) } as unknown as Env['DB'] };
    send200('"e2"', 2);
    expect((await refreshContent(env, T0 + 1, { force: true })).etag).toBe('"e2"');
    off();
    expect(hook).toHaveBeenCalledTimes(2);
    expect(console.error).toHaveBeenCalledWith('course cache db error', 'cleanup', 'cleanup down');
  });
});
