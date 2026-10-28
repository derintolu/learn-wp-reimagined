import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { SERVER_FLAGS, LRS_API } from '../../functions/_lib/config';
import { createSqliteD1 } from '../../dev/sqliteD1';
import { buildContent } from '../../scripts/build-content';
import { getContent, setContentForTests } from '../../functions/_lib/content';
import { ensureRecordSchema, ensureSchema } from '../../functions/_lib/db';
import type { Env } from '../../functions/_lib/env';
import { GET as list } from '../../functions/api/badges';
import { POST as claimLink } from '../../functions/api/badges/claim-link';
import { cacheRegistration, createSession, readSession } from '../../functions/_lib/session/session';
import { auIdOf } from '../../functions/_lib/record/official';
import { activityIds } from '../../vendor/course-xapi-mcp/core/constants';
import { XAPI_BASE } from '../../src/shared/xapi';

const NOW = Date.UTC(2026, 9, 28, 12, 0, 0);
const REG = '11111111-1111-4111-8111-111111111111';
const BADGE = '33333333-3333-4333-8333-333333333333';
const OTHER = '44444444-4444-4444-8444-444444444444';

let env: Env;
let cookie: string;
let actorName: string;
let minted: { url: string; body: any }[];
let listBody: unknown;
let mintStatus: number;

const call = (h: typeof list, cookieHeader: string | null, init: RequestInit = {}) =>
  h(new Request('http://x/api/badges', { ...init, headers: { ...(cookieHeader ? { cookie: cookieHeader } : {}), ...(init.headers as object) } }), { params: {}, env });
const claim = (badge: unknown, cookieHeader: string | null = cookie) =>
  call(claimLink, cookieHeader, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ badge }) });

beforeEach(async () => {
  SERVER_FLAGS.badges = true;
  setContentForTests(buildContent('tests/fixtures/content'));
  const db = createSqliteD1();
  await ensureSchema(db);
  await ensureRecordSchema(db);
  env = { DB: db, SESSION_KEY: 'k', LRS_KEY: 'ck', LRS_SECRET: 'cs' } as Env;
  const made = await createSession(env, NOW);
  cookie = made.cookie.split(';')[0];
  actorName = made.session.actorName;
  await cacheRegistration(env, (await readSession(new Request('http://x', { headers: { cookie } }), env, NOW))!, REG);
  minted = [];
  mintStatus = 201;
  listBody = [
    { id: BADGE, achievement: { id: `${XAPI_BASE}/badges/block-theme`, name: 'Block themes', image: null }, status: 'pending', created_at: 'x' },
  ];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      if (url === `${LRS_API}/badges?registration=${REG}`) return new Response(JSON.stringify(listBody), { status: 200 });
      const m = /\/badges\/([^/]+)\/claim-links$/.exec(url);
      if (m && init?.method === 'POST') {
        const body = JSON.parse(String(init.body));
        minted.push({ url, body });
        if (mintStatus !== 201) return new Response(null, { status: mintStatus });
        return new Response(JSON.stringify({ url: `https://lrs.sqwrlz.com/claim/token-${minted.length}` }), { status: 201 });
      }
      return new Response(null, { status: 404 });
    }),
  );
});
afterEach(() => {
  SERVER_FLAGS.badges = false;
  vi.unstubAllGlobals();
});

describe('GET /api/badges', () => {
  it('is 404 with the flag off', async () => {
    SERVER_FLAGS.badges = false;
    expect((await call(list, cookie)).status).toBe(404);
  });

  it('needs a session', async () => {
    expect((await call(list, null)).status).toBe(401);
  });

  it('lists the learner badges with the tested-out count for the path', async () => {
    const lessons = getContent().paths['block-theme'].lessons;
    const outcome = (id: string, verb: string, registration = REG) =>
      env.DB
        .prepare('INSERT INTO official_outcomes (actor_name, registration, activity_id, verb, event_id) VALUES (?, ?, ?, ?, ?)')
        .bind(actorName, registration, activityIds.au(auIdOf(id)), verb, 'e')
        .run();
    for (const id of [lessons[0], lessons[1]]) await outcome(id, 'waived');
    await outcome(lessons[2], 'completed');
    // A lesson waived in an earlier registration (before restart_course) does not count for this one.
    await outcome(lessons[3], 'waived', '22222222-2222-4222-8222-222222222222');
    const res = await call(list, cookie);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([{ id: BADGE, pathId: 'block-theme', name: 'Block themes', status: 'pending', testedOut: 2 }]);
  });

  it('drops badges that are not for a path here or not pending or claimed', async () => {
    listBody = [
      { id: BADGE, achievement: { id: `${XAPI_BASE}/badges/nope`, name: 'x', image: null }, status: 'pending', created_at: 'x' },
      { id: OTHER, achievement: { id: `${XAPI_BASE}/badges/learner`, name: 'y', image: null }, status: 'revoked', created_at: 'x' },
    ];
    expect(await (await call(list, cookie)).json()).toEqual([]);
  });

  it('is rate limited per learner, before the LRS is asked', async () => {
    for (let i = 0; i < 30; i++) expect((await call(list, cookie)).status).toBe(200);
    const asked = vi.mocked(fetch).mock.calls.length;
    const res = await call(list, cookie);
    expect(res.status).toBe(429);
    expect(((await res.json()) as any).error.code).toBe('rate-limited');
    expect(vi.mocked(fetch).mock.calls.length).toBe(asked);
  });

  it('is 503 when the LRS is down', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 503 })));
    expect((await call(list, cookie)).status).toBe(503);
  });
});

describe('POST /api/badges/claim-link', () => {
  it('claim-link requires a session', async () => {
    expect((await claim(BADGE, null)).status).toBe(401);
    expect(minted).toHaveLength(0);
  });

  it('is 404 with the flag off', async () => {
    SERVER_FLAGS.badges = false;
    expect((await claim(BADGE)).status).toBe(404);
  });

  it('each call mints a new link', async () => {
    const a = await (await claim(BADGE)).json();
    const b = await (await claim(BADGE)).json();
    expect(a.url).toBe('https://lrs.sqwrlz.com/claim/token-1');
    expect(b.url).toBe('https://lrs.sqwrlz.com/claim/token-2');
    expect(minted).toHaveLength(2);
    expect(minted[0].url).toBe(`${LRS_API}/badges/${BADGE}/claim-links`);
    expect(minted[0].body.actor.account.name).toBe(actorName);
  });

  it('is never cached', async () => {
    expect((await claim(BADGE)).headers.get('cache-control')).toBe('no-store');
  });

  it('rejects a body without a badge id', async () => {
    expect((await claim('not-a-uuid')).status).toBe(400);
    expect((await claim(undefined)).status).toBe(400);
    expect(minted).toHaveLength(0);
  });

  it('maps the LRS refusing the badge to 404 or 409', async () => {
    mintStatus = 404;
    expect((await claim(BADGE)).status).toBe(404);
    mintStatus = 409;
    expect((await claim(BADGE)).status).toBe(409);
  });

  it('refuses a link that is not on the LRS origin', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ url: 'https://evil.example/claim' }), { status: 201 })));
    expect((await claim(BADGE)).status).toBe(502);
  });

  it('is 503 when the LRS is down', async () => {
    mintStatus = 503;
    expect((await claim(BADGE)).status).toBe(503);
  });
});
