import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SERVER_FLAGS } from '../../functions/_lib/config';
import { createSqliteD1 } from '../../dev/sqliteD1';
import { buildContent } from '../../scripts/build-content';
import { setContentForTests } from '../../functions/_lib/content';
import { ensureSchema } from '../../functions/_lib/db';
import type { Env } from '../../functions/_lib/env';
import { POST as create, GET as read, DELETE as del } from '../../functions/api/session';
import { POST as events } from '../../functions/api/events';
import { SESSION_COOKIE, SESSION_IDLE_MS, TOUCH_EVERY_MS, readSession } from '../../functions/_lib/session/session';
import { XAPI_BASE } from '../../src/shared/xapi';

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

beforeEach(async () => {
  setContentForTests(buildContent('tests/fixtures/content'));
  db = createSqliteD1();
  env = { DB: db, SESSION_KEY: KEY };
  await ensureSchema(db);
});
afterEach(() => {
  SERVER_FLAGS.sessions = false;
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

  it('expired cookie is treated as no session and cleared', async () => {
    const created = await post();
    const value = cookieOf(created);
    const later = Date.now() + SESSION_IDLE_MS + 1000;
    expect(await readSession(withCookie(value), env, later)).toBeNull();
    expect(await count()).toBe(0);
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
    // no session: phase 1 while the flag is off, 401 when on, phase 1 again without a key
    expect((await ev({}, BODY_LEARNER)).status).toBe(200);
    SERVER_FLAGS.sessions = true;
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
