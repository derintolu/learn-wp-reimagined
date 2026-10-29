import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createSqliteD1 } from '../../dev/sqliteD1';
import { buildContent } from '../../scripts/build-content';
import { setContentForTests } from '../../functions/_lib/content';
import { ensureOAuthSchema, ensureRecordSchema, ensureSchema } from '../../functions/_lib/db';
import type { Env } from '../../functions/_lib/env';
import { POST as create, GET as read, DELETE as del } from '../../functions/api/session';
import { POST as events } from '../../functions/api/events';
import { SESSION_COOKIE, SESSION_IDLE_MS, TOUCH_EVERY_MS, readSession } from '../../functions/_lib/session/session';
import { XAPI_BASE } from '../../src/shared/xapi';
import { enrolHealth } from '../../functions/_lib/session/enrol';
import { GET as senseiGet } from '../../functions/api/sensei';

const KEY = 'test-session-key-not-a-secret';
const NOW = Date.UTC(2026, 9, 27, 12, 0, 0);
const BODY_LEARNER = '3f2b8c1e-5d4a-4e6f-8a9b-0c1d2e3f4a5b';
const FREE = 'theme-json-basics';

let db: ReturnType<typeof createSqliteD1>;
let env: Env;
const ctx = () => ({ params: {}, env });
const ip = (n = 1) => ({ 'cf-connecting-ip': `10.0.0.${n}` });
const post = (n = 1) => create(new Request('http://x/api/session', { method: 'POST', headers: ip(n) }), ctx());
const cookieOf = (res: Response) => res.headers.get('set-cookie')!.split(';')[0].split('=').slice(1).join('=');
const withCookie = (v: string, init: RequestInit = {}) =>
  new Request('http://x/api/session', { ...init, headers: { cookie: `${SESSION_COOKIE}=${v}`, ...(init.headers as object) } });
const count = async () => (await db.prepare('SELECT COUNT(*) AS c FROM sessions').first<{ c: number }>())!.c;
const SEED_HEX = '9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60';
const SIGNING = Buffer.from('302e020100300506032b657004220420' + SEED_HEX, 'hex').toString('base64');

beforeEach(async () => {
  setContentForTests(buildContent('tests/fixtures/content'));
  db = createSqliteD1();
  // Every session gets a Sensei learner, and "Delete my data" erases in the LRS: both answered by the stub below.
  env = { DB: db, SESSION_KEY: KEY, CONNECTOR_SIGNING_KEY: SIGNING, CONNECTOR_KEY_ID: 'kid1', LRS_KEY: 'a', LRS_SECRET: 'b' };
  await ensureSchema(db);
  let next = 500;
  vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
    if (init?.method === 'POST' && /\/learners$/.test(url)) {
      const id = next++;
      return new Response(JSON.stringify({ user_id: id, actor: { objectType: 'Agent', account: { homePage: XAPI_BASE, name: `ledger-${id}` } } }), { status: 201 });
    }
    return new Response('{}', { status: 200 });
  });
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('sessions', () => {
  it('creates a session and stores only the HMAC', async () => {
    const res = await post();
    expect(res.status).toBe(200);
    const sc = res.headers.get('set-cookie')!;
    expect(sc).toMatch(/HttpOnly/);
    expect(sc).toMatch(/Secure/);
    expect(sc).toMatch(/SameSite=Lax/);
    expect(sc).toMatch(/Path=\//);
    expect(sc).toMatch(/Max-Age=15552000/);
    const body = (await res.json()) as any;
    expect(body.actor.homePage).toBe(XAPI_BASE);
    const value = cookieOf(res);
    const rows = (await db.prepare('SELECT * FROM sessions').all<any>()).results;
    expect(rows).toHaveLength(1);
    expect(rows[0].sid_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(rows[0])).not.toContain(value);
    expect(rows[0].actor_name).toBe(body.actor.name);
  });

  it('GET returns the actor for a valid cookie', async () => {
    const created = await post();
    const actor = ((await created.json()) as any).actor;
    const res = await read(withCookie(cookieOf(created)), ctx());
    expect(((await res.json()) as any).actor).toEqual(actor);
    const none = await read(new Request('http://x/api/session'), ctx());
    expect(await none.json()).toEqual({ actor: null });
  });

  it('expired cookie is treated as no session and cleared; the row is left for the retention sweep', async () => {
    const created = await post();
    const value = cookieOf(created);
    const later = Date.now() + SESSION_IDLE_MS + 1000;
    expect(await readSession(withCookie(value), env, later)).toBeNull();
    expect(await count()).toBe(1);
    // through the route: row expired by rewriting touched, cookie cleared
    const again = await post(2);
    await db.prepare('UPDATE sessions SET touched = 1').run();
    const res = await read(withCookie(cookieOf(again)), ctx());
    expect(await res.json()).toEqual({ actor: null });
    expect(res.headers.get('set-cookie')).toMatch(/Max-Age=0/);
  });

  it('tampered cookie yields no session, not a 500', async () => {
    const created = await post();
    const res = await read(withCookie(cookieOf(created) + 'x'), ctx());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ actor: null });
    expect(res.headers.get('set-cookie')).toMatch(/Max-Age=0/);
    expect((await read(withCookie('%%%'), ctx())).status).toBe(200);
  });

  it('11th create in a window is 429', async () => {
    for (let i = 0; i < 10; i++) expect((await post()).status).toBe(200);
    const res = await post();
    expect(res.status).toBe(429);
    expect(((await res.json()) as any).error.code).toBe('limited');
    expect((await post(2)).status).toBe(200);
  });

  it('DELETE removes the row and clears the cookie', async () => {
    const created = await post();
    const res = await del(withCookie(cookieOf(created), { method: 'DELETE' }), ctx());
    expect(await res.json()).toEqual({ deleted: true });
    expect(res.headers.get('set-cookie')).toMatch(/Max-Age=0/);
    expect(await count()).toBe(0);
  });

  it('503 disabled without SESSION_KEY', async () => {
    env = { DB: db };
    expect((await post()).status).toBe(503);
    expect((await read(new Request('http://x/api/session'), ctx())).status).toBe(503);
  });

  it('events use the session actor and ignore body learnerId', async () => {
    const created = await post();
    const actor = ((await created.json()) as any).actor.name;
    const ev = (headers: Record<string, string>, learnerId?: string) =>
      events(
        new Request('http://x/api/events', {
          method: 'POST',
          headers,
          body: JSON.stringify({ ...(learnerId ? { learnerId } : {}), events: [{ eventId: 'evt-00000001', type: 'beatViewed', lessonId: FREE, beatIndex: 0 }] }),
        }),
        ctx(),
      );
    const res = await ev({ cookie: `${SESSION_COOKIE}=${cookieOf(created)}` }, BODY_LEARNER);
    expect(res.status).toBe(200);
    const text = JSON.stringify(await res.json());
    expect(text).toContain(actor);
    expect(text).not.toContain(BODY_LEARNER);
    // no session: 401, and the body learnerId again without a key
    const r401 = await ev({}, BODY_LEARNER);
    expect(r401.status).toBe(401);
    expect(((await r401.json()) as any).error.code).toBe('no-session');
    env = { DB: db };
    expect((await ev({}, BODY_LEARNER)).status).toBe(200);
  });

  it('touch writes at most once an hour', async () => {
    const created = await post();
    const value = cookieOf(created);
    const t0 = (await db.prepare('SELECT touched FROM sessions').first<any>())!.touched;
    await readSession(withCookie(value), env, t0 + TOUCH_EVERY_MS - 1);
    expect((await db.prepare('SELECT touched FROM sessions').first<any>())!.touched).toBe(t0);
    await readSession(withCookie(value), env, t0 + TOUCH_EVERY_MS);
    expect((await db.prepare('SELECT touched FROM sessions').first<any>())!.touched).toBe(t0 + TOUCH_EVERY_MS);
  });
});

describe('sessions bound to Sensei learners', () => {
  const learner = (name = 'ledger-actor-1', id = 77, homePage = XAPI_BASE) =>
    new Response(JSON.stringify({ user_id: id, actor: { objectType: 'Agent', account: { homePage, name } } }), { status: 201 });
  let calls: Array<{ method: string; url: string }>;
  const stub = (handler: (method: string, url: string) => Response) => {
    calls = [];
    vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
      calls.push({ method: init.method!, url });
      return handler(init.method!, url);
    });
  };

  beforeEach(() => {
    env = { DB: db, SESSION_KEY: KEY, CONNECTOR_SIGNING_KEY: SIGNING, CONNECTOR_KEY_ID: 'kid1', LRS_KEY: 'a', LRS_SECRET: 'b' };
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('session actor comes from the connector', async () => {
    stub(() => learner());
    const res = await post();
    expect(res.status).toBe(200);
    expect(((await res.json()) as any).actor).toEqual({ homePage: XAPI_BASE, name: 'ledger-actor-1' });
    const row = await db.prepare('SELECT actor_name, wp_user_id FROM sessions').first<any>();
    expect(row.actor_name).toBe('ledger-actor-1');
    expect(Number(row.wp_user_id)).toBe(77);
    expect(calls).toHaveLength(1);
  });

  it('refuses a learner whose actor homePage is not the site (503, learner deleted, no session row)', async () => {
    // Learning Ledger names the actor by WordPress home_url(); every official statement names XAPI_BASE.
    stub((m) => (m === 'POST' ? learner('ledger-actor-1', 77, 'https://other-host.example') : new Response('{}', { status: 200 })));
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = await post();
    expect(res.status).toBe(503);
    expect(((await res.json()) as any).error.code).toBe('connector-unavailable');
    expect(res.headers.get('set-cookie')).toBeNull();
    expect(await count()).toBe(0);
    expect(calls.map((c) => c.method)).toEqual(['POST', 'DELETE']);
    expect(calls[1].url).toMatch(/learners\/77$/);
    expect(log).toHaveBeenCalled();
    log.mockRestore();
  });

  it('GET answers the same actor POST did', async () => {
    stub(() => learner());
    const created = await post();
    const posted = ((await created.json()) as any).actor;
    const got = await read(withCookie(cookieOf(created)), ctx());
    expect(((await got.json()) as any).actor).toEqual(posted);
  });

  it('connector down gives 503 and no session row', async () => {
    stub(() => new Response('x', { status: 503 }));
    const res = await post();
    expect(res.status).toBe(503);
    expect(((await res.json()) as any).error.code).toBe('connector-unavailable');
    expect(res.headers.get('set-cookie')).toBeNull();
    expect(await count()).toBe(0);
  });

  const isNewLearner = (m: string, u: string) => m === 'POST' && /\/learners$/.test(u);

  it('DELETE session erases the learner in the LRS, then deletes the WordPress learner', async () => {
    stub((m, u) => (isNewLearner(m, u) ? learner() : new Response('{}', { status: 200 })));
    const created = await post();
    const res = await del(withCookie(cookieOf(created), { method: 'DELETE' }), ctx());
    expect(await res.json()).toEqual({ deleted: true });
    expect(calls.map((c) => c.method)).toEqual(['POST', 'POST', 'DELETE']);
    expect(calls[1].url).toMatch(/\/actors\/erase$/);
    expect(calls[2].url).toMatch(/learners\/77$/);
    expect(await count()).toBe(0);
  });

  it('DELETE keeps the session when the learner cannot be deleted yet', async () => {
    stub((m, u) => (isNewLearner(m, u) ? learner() : /\/actors\/erase$/.test(u) ? new Response('{}', { status: 200 }) : new Response('x', { status: 503 })));
    const created = await post();
    const res = await del(withCookie(cookieOf(created), { method: 'DELETE' }), ctx());
    expect(res.status).toBe(503);
    expect(await count()).toBe(1);
  });
});

describe('a Sensei learner for sessions made before learners were on', () => {
  let calls: Array<{ method: string; url: string }>;
  let nextId: number;
  let down: boolean;
  let legacy: { cookie: string; actor: string };

  const learnerRow = async () => Number((await db.prepare('SELECT wp_user_id FROM sessions').first<any>())!.wp_user_id ?? 0) || null;
  const send = (cookie: string, n = 1) =>
    events(
      new Request('http://x/api/events', {
        method: 'POST',
        headers: { cookie: `${SESSION_COOKIE}=${cookie}`, ...ip(n) },
        body: JSON.stringify({ events: [{ eventId: `evt-${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`, type: 'beatViewed', lessonId: FREE, beatIndex: 0 }] }),
      }),
      ctx(),
    );
  const created = () => calls.filter((c) => c.method === 'POST' && /\/learners$/.test(c.url));

  beforeEach(async () => {
    env = { DB: db, SESSION_KEY: KEY, CONNECTOR_SIGNING_KEY: SIGNING, CONNECTOR_KEY_ID: 'kid1', SENSEI_COURSE_IDS: JSON.stringify({ 'block-theme': 13, 'learner': 12 }) };
    enrolHealth.downUntil = 0;
    calls = [];
    nextId = 100;
    down = false;
    vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
      calls.push({ method: init.method!, url });
      if (down) return new Response('x', { status: 503 });
      if (init.method === 'POST' && /\/learners$/.test(url)) {
        const id = nextId++;
        await new Promise((r) => setTimeout(r, 5));
        return new Response(JSON.stringify({ user_id: id, actor: { objectType: 'Agent', account: { homePage: XAPI_BASE, name: `ledger-${id}` } } }), { status: 201 });
      }
      return new Response('{}', { status: 200 });
    });
    // A session minted before Sensei learners were on: no wp_user_id, and an actor name of its own.
    const res = await post();
    legacy = { cookie: cookieOf(res), actor: crypto.randomUUID() };
    await db.prepare('UPDATE sessions SET wp_user_id = NULL, actor_name = ?').bind(legacy.actor).run();
    nextId = 100;
    await ensureOAuthSchema(db);
    await db
      .prepare("INSERT INTO oauth_tokens (token_hash, kind, family_id, client_id, actor_name, wp_user_id, registration, created, expires, used) VALUES ('t', 'refresh', 'f', 'c', ?, 0, '', 1, 2, 0)")
      .bind(legacy.actor)
      .run();
    await db
      .prepare("INSERT INTO oauth_tokens (token_hash, kind, family_id, client_id, actor_name, wp_user_id, registration, created, expires, used) VALUES ('other', 'refresh', 'f2', 'c', 'someone-else', 0, '', 1, 2, 0)")
      .run();
    calls = [];
  });
  afterEach(() => {
    enrolHealth.downUntil = 0;
    vi.unstubAllGlobals();
  });

  it('gets a learner on its first event, adopts the ledger actor, and is enrolled on that event', async () => {
    expect((await send(legacy.cookie)).status).toBe(200);
    expect(await learnerRow()).toBe(100);
    expect((await db.prepare('SELECT actor_name FROM sessions').first<any>())!.actor_name).toBe('ledger-100');
    expect(((await (await read(withCookie(legacy.cookie), ctx())).json()) as any).actor).toEqual({ homePage: XAPI_BASE, name: 'ledger-100' });
    expect(await db.prepare("SELECT actor_name, wp_user_id FROM oauth_tokens WHERE token_hash = 't'").first<any>()).toEqual({ actor_name: 'ledger-100', wp_user_id: 100 });
    expect(await db.prepare("SELECT actor_name, wp_user_id FROM oauth_tokens WHERE token_hash = 'other'").first<any>()).toEqual({ actor_name: 'someone-else', wp_user_id: 0 });
    expect(created()).toHaveLength(1);
    expect(calls.some((c) => /\/learners\/100\/enrolments$/.test(c.url))).toBe(true);
    // The next event makes no second learner.
    await send(legacy.cookie);
    expect(created()).toHaveLength(1);
  });

  it('two concurrent first events leave exactly one learner', async () => {
    const [a, b] = await Promise.all([send(legacy.cookie, 1), send(legacy.cookie, 2)]);
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    const kept = await learnerRow();
    expect(kept).not.toBeNull();
    expect(created()).toHaveLength(2);
    const deleted = calls.filter((c) => c.method === 'DELETE').map((c) => Number(c.url.split('/').pop()));
    expect(deleted).toHaveLength(1);
    expect(deleted[0]).not.toBe(kept);
    expect((await db.prepare('SELECT actor_name FROM sessions').first<any>())!.actor_name).toBe(`ledger-${kept}`);
  });

  it('connector down: the event succeeds, no learner, backs off, then retries', async () => {
    down = true;
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect((await send(legacy.cookie)).status).toBe(200);
    expect(await learnerRow()).toBeNull();
    expect(created()).toHaveLength(1);
    // Within the back-off no connector call is made.
    expect((await send(legacy.cookie)).status).toBe(200);
    expect(created()).toHaveLength(1);
    // /api/sensei still answers 401 for the session.
    const sres = await senseiGet(withCookie(legacy.cookie), ctx());
    expect(sres.status).toBe(401);
    // After the back-off, with the connector back, the next event gets the learner.
    down = false;
    enrolHealth.downUntil = Date.now() - 1;
    await send(legacy.cookie);
    expect(await learnerRow()).toBe(100);
    log.mockRestore();
  });

  it('records nothing official under the old actor while the session has no learner', async () => {
    down = true;
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect((await send(legacy.cookie)).status).toBe(200);
    expect(await learnerRow()).toBeNull();
    await ensureRecordSchema(db);
    for (const t of ['official_pending', 'official_pending_parts', 'lrs_outbox', 'au_sessions', 'shadow_facts', 'official_outcomes']) {
      const n = await db.prepare(`SELECT COUNT(*) AS c FROM ${t} WHERE actor_name = ?`).bind(legacy.actor).first<{ c: number }>();
      expect([t, n!.c]).toEqual([t, 0]);
    }
    log.mockRestore();
  });
});
