import { describe, it, expect, vi } from 'vitest';
import { LrsClient, LrsError, LrsUnavailable } from '../../functions/_lib/lrs/client';
import { LRS_API, LRS_XAPI } from '../../functions/_lib/config';
import type { Env } from '../../functions/_lib/env';

const KEY = 'ck_test_key';
const SECRET = 'cs_super_secret_value';
const env = { DB: {} as Env['DB'], LRS_KEY: KEY, LRS_SECRET: SECRET } as Env;
const BASIC = `Basic ${btoa(`${KEY}:${SECRET}`)}`;

const actor = { objectType: 'Agent' as const, account: { homePage: 'https://learnwp.sqwrlz.com', name: 'u1' } };
const stmt = { id: '11111111-1111-4111-8111-111111111111', actor } as never;
const stateKey = { activityId: 'https://learnwp.sqwrlz.com/c/1', agent: actor, registration: '22222222-2222-4222-8222-222222222222', stateId: 'progress' };

type Call = { url: string; init: RequestInit };
function fake(...responses: Array<Response | Error>) {
  const calls: Call[] = [];
  const fn = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    const r = responses.shift() ?? new Response(null, { status: 204 });
    if (r instanceof Error) throw r;
    return r;
  });
  return { fn: fn as unknown as typeof fetch, calls };
}
const hdr = (c: Call, n: string) => new Headers(c.init.headers).get(n);
const json = (b: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(b), { status, headers: { 'Content-Type': 'application/json', ...headers } });

describe('LrsClient', () => {
  it('sends Basic auth and the xAPI version header on every call', async () => {
    const f = fake(
      new Response(null, { status: 204 }),
      json({ statements: [] }),
      new Response(null, { status: 404 }),
      json({ course: 'c', version: 1, etag: '"abc"' }, 201),
      json({ statements: 0 }),
      json({ url: 'https://lrs.sqwrlz.com/v/x' }, 201),
      json({ url: 'https://lrs.sqwrlz.com/c/x' }, 201),
      json([]),
    );
    const c = new LrsClient(env, f.fn);
    await c.putStatement(stmt);
    await c.getStatements({ agent: actor });
    await c.getState(stateKey);
    await c.importCourse(new Uint8Array([1]), '"abc"');
    await c.eraseActor(actor, { revokeBadges: true });
    await c.mintViewLink(actor);
    await c.mintClaimLink(actor, '33333333-3333-4333-8333-333333333333');
    await c.listBadges(stateKey.registration);
    expect(f.calls).toHaveLength(8);
    for (const call of f.calls) {
      expect(hdr(call, 'Authorization')).toBe(BASIC);
      expect(hdr(call, 'X-Experience-API-Version')).toBe('2.0.0');
    }
  });

  it('putStatement PUTs ?statementId= and accepts 204', async () => {
    const f = fake(new Response(null, { status: 204 }));
    await new LrsClient(env, f.fn).putStatement(stmt);
    expect(f.calls[0].url).toBe(`${LRS_XAPI}/statements?statementId=${(stmt as { id: string }).id}`);
    expect(f.calls[0].init.method).toBe('PUT');
    expect(hdr(f.calls[0], 'Content-Type')).toBe('application/json');
  });

  it('an identical re-PUT answered 204 is success', async () => {
    const f = fake(new Response(null, { status: 204 }), new Response(null, { status: 204 }));
    const c = new LrsClient(env, f.fn);
    await c.putStatement(stmt);
    await expect(c.putStatement(stmt)).resolves.toBeUndefined();
  });

  it('a 409 (same id, different statement) is an error, not success', async () => {
    const f = fake(new Response('conflict', { status: 409 }));
    await expect(new LrsClient(env, f.fn).putStatement(stmt)).rejects.toMatchObject({ name: 'LrsError', status: 409 });
  });

  it('postStatements POSTs the list; an empty list sends nothing', async () => {
    const f = fake(json(['id']));
    const c = new LrsClient(env, f.fn);
    await c.postStatements([]);
    expect(f.calls).toHaveLength(0);
    await c.postStatements([stmt]);
    expect(f.calls[0].url).toBe(`${LRS_XAPI}/statements`);
    expect(f.calls[0].init.method).toBe('POST');
  });

  it('getStatements sends agent, registration, since and limit, and returns more only when set', async () => {
    const f = fake(json({ statements: [stmt], more: '' }), json({ statements: [], more: '/wp-json/learning-ledger/xapi/statements?more=tok' }));
    const c = new LrsClient(env, f.fn);
    const a = await c.getStatements({ agent: actor, registration: stateKey.registration, since: '2026-10-01T00:00:00Z', limit: 50 });
    const u = new URL(f.calls[0].url);
    expect(`${u.origin}${u.pathname}`).toBe(`${LRS_XAPI}/statements`);
    expect(JSON.parse(u.searchParams.get('agent')!)).toEqual(actor);
    expect(u.searchParams.get('registration')).toBe(stateKey.registration);
    expect(u.searchParams.get('since')).toBe('2026-10-01T00:00:00Z');
    expect(u.searchParams.get('limit')).toBe('50');
    expect(a.statements).toHaveLength(1);
    expect(a.more).toBeUndefined();
    const b = await c.getStatements({ agent: actor });
    expect(b.more).toBe('/wp-json/learning-ledger/xapi/statements?more=tok');
  });

  it('getState returns body and ETag, or null on 404', async () => {
    const f = fake(json({ n: 1 }, 200, { ETag: '"e1"' }), new Response('no', { status: 404 }));
    const c = new LrsClient(env, f.fn);
    expect(await c.getState(stateKey)).toEqual({ body: { n: 1 }, etag: '"e1"' });
    expect(await c.getState(stateKey)).toBeNull();
    const u = new URL(f.calls[0].url);
    expect(u.pathname).toBe(new URL(`${LRS_XAPI}/activities/state`).pathname);
    expect(u.searchParams.get('activityId')).toBe(stateKey.activityId);
    expect(JSON.parse(u.searchParams.get('agent')!)).toEqual(actor);
    expect(u.searchParams.get('registration')).toBe(stateKey.registration);
    expect(u.searchParams.get('stateId')).toBe('progress');
  });

  it('putState maps 412 to { conflict: true }', async () => {
    const f = fake(new Response('stale', { status: 412 }));
    expect(await new LrsClient(env, f.fn).putState(stateKey, { n: 2 }, '"old"')).toEqual({ conflict: true });
    expect(hdr(f.calls[0], 'If-Match')).toBe('"old"');
  });

  it('putState creates with If-None-Match: * and reads the new ETag when the PUT sends none', async () => {
    const f = fake(new Response(null, { status: 204 }), json({ n: 1 }, 200, { ETag: '"new"' }));
    const r = await new LrsClient(env, f.fn).putState(stateKey, { n: 1 });
    expect(hdr(f.calls[0], 'If-None-Match')).toBe('*');
    expect(hdr(f.calls[0], 'If-Match')).toBeNull();
    expect(f.calls[0].init.body).toBe('{"n":1}');
    expect(r).toEqual({ etag: '"new"' });
  });

  it('putState uses the ETag header of the PUT response when present', async () => {
    const f = fake(new Response(null, { status: 204, headers: { ETag: '"put"' } }));
    expect(await new LrsClient(env, f.fn).putState(stateKey, {}, '"old"')).toEqual({ etag: '"put"' });
    expect(f.calls).toHaveLength(1);
  });

  it('importCourse PUTs the zip to /courses and checks the stored ETag', async () => {
    const f = fake(json({ course: 'c', version: 1, etag: '"abc"', changed: true }, 201), json({ course: 'c', version: 1, etag: '"zzz"' }, 200));
    const c = new LrsClient(env, f.fn);
    const zip = new Uint8Array([80, 75, 3, 4]);
    await c.importCourse(zip, '"abc"');
    expect(f.calls[0].url).toBe(`${LRS_API}/courses`);
    expect(f.calls[0].init.method).toBe('PUT');
    expect(hdr(f.calls[0], 'Content-Type')).toBe('application/zip');
    expect(f.calls[0].init.body).toBe(zip);
    await expect(c.importCourse(zip, '"abc"')).rejects.toBeInstanceOf(LrsError);
  });

  it('eraseActor posts the actor and revokeBadges', async () => {
    const f = fake(json({ statements: 1 }), json({ statements: 0 }));
    const c = new LrsClient(env, f.fn);
    await c.eraseActor(actor, { revokeBadges: true });
    await c.eraseActor(actor, { revokeBadges: false });
    expect(f.calls[0].url).toBe(`${LRS_API}/actors/erase`);
    expect(f.calls[0].init.method).toBe('POST');
    expect(JSON.parse(String(f.calls[0].init.body))).toEqual({ actor, revokeBadges: true });
    expect(JSON.parse(String(f.calls[1].init.body))).toEqual({ actor, revokeBadges: false });
  });

  it('mints view and claim links and lists badges', async () => {
    const badge = '33333333-3333-4333-8333-333333333333';
    const summary = [{ id: badge, achievement: { id: 'a', name: 'A', image: null }, status: 'pending', created_at: '2026-10-28T00:00:00Z' }];
    const f = fake(json({ url: 'https://v', expires_at: 'x' }, 201), json({ url: 'https://c', expires_at: 'x' }, 201), json(summary));
    const c = new LrsClient(env, f.fn);
    expect(await c.mintViewLink(actor)).toBe('https://v');
    expect(await c.mintClaimLink(actor, badge)).toBe('https://c');
    expect(await c.listBadges(stateKey.registration)).toEqual(summary);
    expect(f.calls[0].url).toBe(`${LRS_API}/view-links`);
    expect(JSON.parse(String(f.calls[0].init.body))).toEqual({ actor });
    expect(f.calls[1].url).toBe(`${LRS_API}/badges/${badge}/claim-links`);
    expect(JSON.parse(String(f.calls[1].init.body))).toEqual({ actor });
    expect(f.calls[2].url).toBe(`${LRS_API}/badges?registration=${stateKey.registration}`);
  });

  it('throws LrsUnavailable on timeout, network failure and 5xx', async () => {
    for (const r of [new DOMException('t', 'TimeoutError'), new TypeError('fetch failed'), new Response('x', { status: 503 })]) {
      const f = fake(r);
      await expect(new LrsClient(env, f.fn).getStatements({ agent: actor })).rejects.toBeInstanceOf(LrsUnavailable);
    }
  });

  it('throws LrsUnavailable on 429 and 408, so callers back off instead of giving up', async () => {
    for (const status of [429, 408]) {
      const f = fake(new Response(null, { status, headers: { 'Retry-After': '1' } }));
      await expect(new LrsClient(env, f.fn).putStatement(stmt)).rejects.toBeInstanceOf(LrsUnavailable);
    }
  });

  it('sets a 3 s timeout signal and never follows redirects', async () => {
    const spy = vi.spyOn(AbortSignal, 'timeout');
    const f = fake(new Response(null, { status: 204 }));
    await new LrsClient(env, f.fn).putStatement(stmt);
    expect(spy).toHaveBeenCalledWith(3000);
    expect(f.calls[0].init.redirect).toBe('manual');
    spy.mockRestore();
  });

  describe('on the Workers runtime', () => {
    // Workers accepts only 'follow' and 'manual' for init.redirect and throws a TypeError otherwise.
    const workers = (respond: () => Response) => {
      const calls: Call[] = [];
      const fn = (async (url: string | URL | Request, init?: RequestInit) => {
        if (init?.redirect !== 'follow' && init?.redirect !== 'manual') throw new TypeError(`Invalid redirect value, must be one of "follow" or "manual" ("${String(init?.redirect)}" given)`);
        calls.push({ url: String(url), init: init ?? {} });
        return respond();
      }) as unknown as typeof fetch;
      return { fn, calls };
    };

    it('completes a request', async () => {
      const w = workers(() => new Response(null, { status: 204 }));
      await new LrsClient(env, w.fn).putStatement(stmt);
      expect(w.calls).toHaveLength(1);
    });

    it('answers a 302 with an LrsError and does not follow it', async () => {
      const w = workers(() => new Response(null, { status: 302, headers: { Location: 'https://evil.example/x' } }));
      const err = await new LrsClient(env, w.fn).getStatements({ agent: actor }).catch((e) => e);
      expect(err).toBeInstanceOf(LrsError);
      expect(err.status).toBe(302);
      expect(err.message).toBe('the LRS answered with a redirect');
      expect(w.calls).toHaveLength(1);
    });

    it('treats an opaque-redirect response as a refused redirect', async () => {
      const opaque = { status: 0, type: 'opaqueredirect', ok: false, headers: new Headers() } as unknown as Response;
      const w = workers(() => opaque);
      const err = await new LrsClient(env, w.fn).getStatements({ agent: actor }).catch((e) => e);
      expect(err).toBeInstanceOf(LrsError);
      expect(err.message).toBe('the LRS answered with a redirect');
    });
  });

  it('keeps the cause when the LRS did not answer, never the credentials', async () => {
    const f = fake(new TypeError('x'.repeat(300)));
    const err = await new LrsClient(env, f.fn).putStatement(stmt).catch((e) => e);
    expect(err).toBeInstanceOf(LrsUnavailable);
    expect(err.message).toBe('the LRS did not answer: TypeError ' + 'x'.repeat(120));
    expect(err.message).not.toContain(SECRET);
  });

  it('is unavailable, without calling out, when the credentials are not configured', async () => {
    const f = fake();
    const c = new LrsClient({ DB: env.DB } as Env, f.fn);
    await expect(c.putStatement(stmt)).rejects.toBeInstanceOf(LrsUnavailable);
    expect(f.calls).toHaveLength(0);
  });

  it('never logs or leaks the secret, including in errors', async () => {
    const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((m) => vi.spyOn(console, m).mockImplementation(() => {}));
    const f = fake(new Response('bad', { status: 401 }), new Response('x', { status: 500 }), new TypeError(`fetch failed ${SECRET}`));
    const c = new LrsClient(env, f.fn);
    const errs: unknown[] = [];
    for (let i = 0; i < 3; i++) errs.push(await c.putStatement(stmt).catch((e) => e));
    for (const e of errs) expect(String((e as Error).message) + String((e as Error).stack)).not.toContain(SECRET);
    for (const s of spies) {
      expect(JSON.stringify(s.mock.calls)).not.toContain(SECRET);
      s.mockRestore();
    }
    expect(errs[0]).toMatchObject({ name: 'LrsError', status: 401 });
  });

  it('built without a fetchFn, calls the global fetch with no receiver (Workers)', async () => {
    const original = globalThis.fetch;
    globalThis.fetch = function (this: unknown) {
      if (this !== undefined && this !== globalThis) throw new TypeError('Illegal invocation');
      return Promise.resolve(new Response(null, { status: 204 }));
    } as unknown as typeof fetch;
    try {
      await expect(new LrsClient(env).putStatement(stmt)).resolves.toBeUndefined();
    } finally {
      globalThis.fetch = original;
    }
  });
});
