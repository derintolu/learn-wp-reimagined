import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SERVER_FLAGS } from '../../functions/_lib/config';
import { LEDGER_BASE, LRS_API, LRS_XAPI } from '../../functions/_lib/config';
import { createSqliteD1 } from '../../dev/sqliteD1';
import { ensureSchema, ensureRecordSchema, ensureOAuthSchema } from '../../functions/_lib/db';
import type { Env } from '../../functions/_lib/env';
import { ERASE_AFTER_LRS, ERASE_BEFORE_LRS, eraseLearner, sweep, latestDrift } from '../../functions/_lib/session/lifecycle';
import { readFileSync } from 'node:fs';
import { SESSION_IDLE_MS, type Session } from '../../functions/_lib/session/session';
import { DELETE as del } from '../../functions/api/session';
import { SESSION_COOKIE } from '../../functions/_lib/session/session';
import { GET as sweepRoute } from '../../functions/api/sweep';
import { GET as driftRoute } from '../../functions/api/admin/drift';
import { recordShadowFact } from '../../functions/_lib/record/shadow';
import { enqueue, drain } from '../../functions/_lib/lrs/outbox';
import { resolveToken, sha256Hex } from '../../functions/_lib/oauth/store';
import { activityId, XAPI_BASE } from '../../src/shared/xapi';

const SEED_HEX = '9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60';
const KEY = Buffer.from('302e020100300506032b657004220420' + SEED_HEX, 'hex').toString('base64');
const NOW = Date.UTC(2026, 9, 28, 12, 0, 0);
const DAY = 86_400_000;

let db: ReturnType<typeof createSqliteD1>;
let env: Env;
let calls: { method: string; url: string; body: string }[];
let answer: (method: string, url: string) => Response | undefined;

const flags = { ...SERVER_FLAGS };
beforeEach(async () => {
  db = createSqliteD1();
  env = {
    DB: db,
    SESSION_KEY: 'k',
    CRON_SECRET: 'cron',
    ADMIN_TOKEN: 'adm',
    CONNECTOR_SIGNING_KEY: KEY,
    CONNECTOR_KEY_ID: 'kid1',
    LRS_KEY: 'a',
    LRS_SECRET: 'b',
    SENSEI_COURSE_IDS: '{"learner":12}',
    LEDGER_PROGRAM_ID: '9',
    SENSEI_LESSON_IDS: '{"theme-json-basics":101,"block-patterns":102}',
  };
  await ensureSchema(db);
  await ensureRecordSchema(db);
  calls = [];
  answer = () => undefined;
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    calls.push({ method, url, body: String(init?.body ?? '') });
    return answer(method, url) ?? new Response('{}', { status: 200 });
  });
  Object.assign(SERVER_FLAGS, { senseiLearners: true, lrsShadow: true });
});
afterEach(() => {
  vi.unstubAllGlobals();
  Object.assign(SERVER_FLAGS, flags);
});

const addSession = async (name: string, wp: number | null, touched: number, sid = `sid-${name}`) => {
  await db
    .prepare('INSERT INTO sessions (sid_hash, actor_name, wp_user_id, created, touched) VALUES (?, ?, ?, ?, ?)')
    .bind(sid, name, wp, touched, touched)
    .run();
  return { sidHash: sid, actorName: name, wpUserId: wp, createdAt: touched, touchedAt: touched } as Session;
};
const count = async () => (await db.prepare('SELECT COUNT(*) AS c FROM sessions').first<{ c: number }>())!.c;
const eraseCalls = () => calls.filter((c) => c.url === `${LRS_API}/actors/erase`);

describe('eraseLearner', () => {
  it('delete my data erases in the LRS with revokeBadges true', async () => {
    const s = await addSession('abc', 77, NOW);
    await eraseLearner(env, s, { revokeBadges: true });
    const [erase] = eraseCalls();
    expect(JSON.parse(erase.body)).toEqual({
      actor: { objectType: 'Agent', account: { homePage: XAPI_BASE, name: 'abc' } },
      revokeBadges: true,
    });
    expect(calls.map((c) => c.method + ' ' + c.url.replace(LEDGER_BASE, '').replace(LRS_API, ''))).toEqual([
      'POST /actors/erase',
      'DELETE /course-server/learners/77',
    ]);
    expect(await count()).toBe(0);
  });

  it('removes the learner OAuth tokens and local record rows', async () => {
    const s = await addSession('abc', null, NOW);
    await ensureOAuthSchema(db);
    await db
      .prepare("INSERT INTO oauth_tokens (token_hash, kind, family_id, client_id, actor_name, wp_user_id, registration, created, expires, used) VALUES ('h', 'access', 'f', 'c', 'abc', 1, 'r', 1, 2, 0)")
      .run();
    await recordShadowFact(env, 'abc', { lessonId: 'x', kind: 'completed' }, NOW);
    await eraseLearner(env, s, { revokeBadges: true });
    expect((await db.prepare('SELECT COUNT(*) AS c FROM oauth_tokens').first<{ c: number }>())!.c).toBe(0);
    expect((await db.prepare('SELECT COUNT(*) AS c FROM shadow_facts').first<{ c: number }>())!.c).toBe(0);
  });

  it('with every flag off it touches only the session row', async () => {
    Object.assign(SERVER_FLAGS, { senseiLearners: false, lrsShadow: false });
    const s = await addSession('abc', null, NOW);
    await eraseLearner(env, s, { revokeBadges: true });
    expect(calls).toEqual([]);
    expect(await count()).toBe(0);
  });

  it('removes the cached official record', async () => {
    const s = await addSession('abc', null, NOW);
    await db.prepare('INSERT INTO record_cache (actor_name, body, at) VALUES (?, ?, ?)').bind('abc', '{}', NOW).run();
    await db.prepare('INSERT INTO record_cache (actor_name, body, at) VALUES (?, ?, ?)').bind('other', '{}', NOW).run();
    await eraseLearner(env, s, { revokeBadges: true });
    expect((await db.prepare('SELECT actor_name FROM record_cache').all<{ actor_name: string }>()).results).toEqual([{ actor_name: 'other' }]);
  });

  it('after an LRS flag rollback, still erases a learner the LRS has seen (a cached registration)', async () => {
    Object.assign(SERVER_FLAGS, { senseiLearners: false, lrsShadow: false });
    const s = await addSession('abc', null, NOW);
    await db.prepare('UPDATE sessions SET registration = ? WHERE sid_hash = ?').bind('7d3c1a2b-4e5f-4a6b-8c7d-9e0f1a2b3c4d', s.sidHash).run();
    await recordShadowFact(env, 'abc', { lessonId: 'x', kind: 'completed' }, NOW);
    await eraseLearner(env, s, { revokeBadges: true });
    expect(eraseCalls()).toHaveLength(1);
    expect((await db.prepare('SELECT COUNT(*) AS c FROM shadow_facts').first<{ c: number }>())!.c).toBe(0);
    expect(await count()).toBe(0);
  });

  it('after a Sensei flag rollback, still deletes a learner made in WordPress', async () => {
    Object.assign(SERVER_FLAGS, { senseiLearners: false, lrsShadow: false });
    const s = await addSession('abc', 77, NOW);
    await eraseLearner(env, s, { revokeBadges: true });
    expect(calls.map((c) => c.method + ' ' + c.url.replace(LEDGER_BASE, ''))).toEqual(['DELETE /course-server/learners/77']);
    expect(await count()).toBe(0);
  });

  it('with the flags off and the record tables never made (today), touches only the session row', async () => {
    Object.assign(SERVER_FLAGS, { senseiLearners: false, lrsShadow: false });
    db = createSqliteD1();
    env = { ...env, DB: db };
    await ensureSchema(db);
    const s = await addSession('abc', null, NOW);
    await eraseLearner(env, s, { revokeBadges: true });
    expect(calls).toEqual([]);
    expect(await count()).toBe(0);
    expect(await db.prepare("SELECT name FROM sqlite_master WHERE name = 'lrs_outbox'").first()).toBeNull();
  });

  it('every table keyed by actor_name is erased', () => {
    const src = readFileSync('functions/_lib/db.ts', 'utf8');
    const tables = [...src.matchAll(/CREATE TABLE IF NOT EXISTS (\w+) \(([^']*)\)/g)].filter((m) => /\bactor_name\b/.test(m[2])).map((m) => m[1]);
    // sessions is removed last by deleteSession; oauth_codes and oauth_tokens by revokeAllForActor.
    const handled = new Set([...ERASE_BEFORE_LRS, ...ERASE_AFTER_LRS, 'sessions', 'oauth_codes', 'oauth_tokens']);
    expect(tables.length).toBeGreaterThan(5);
    expect(tables.filter((t) => !handled.has(t))).toEqual([]);
  });

  it('keeps the session when a step fails, so the delete can be retried', async () => {
    const s = await addSession('abc', 77, NOW);
    answer = (m, u) => (m === 'DELETE' ? new Response('x', { status: 403 }) : undefined);
    await expect(eraseLearner(env, s, { revokeBadges: true })).rejects.toThrow();
    expect(await count()).toBe(1);
  });

  it('treats an already-gone learner (404) as done', async () => {
    const s = await addSession('abc', 77, NOW);
    answer = (m) => (m === 'DELETE' ? new Response('x', { status: 404 }) : undefined);
    await eraseLearner(env, s, { revokeBadges: true });
    expect(await count()).toBe(0);
  });
});

describe('erase and the LRS outbox', () => {
  it('drops the learner queued statements, so a later drain posts nothing for them', async () => {
    const s = await addSession('abc', null, NOW);
    const st = (id: string, name: string) =>
      ({ id, actor: { objectType: 'Agent', account: { homePage: XAPI_BASE, name } }, verb: { id: 'http://x/v' }, object: { id: 'http://x/o' } }) as any;
    await enqueue(env, [st('00000000-0000-4000-8000-000000000001', 'abc'), st('00000000-0000-4000-8000-000000000002', 'other')], NOW);
    await eraseLearner(env, s, { revokeBadges: true });
    calls.length = 0;
    await drain(env, NOW + 1, 5000);
    const posts = calls.filter((c) => c.url === `${LRS_XAPI}/statements` && c.method === 'POST');
    expect(posts).toHaveLength(1);
    expect(posts[0].body).toContain('other');
    expect(posts[0].body).not.toContain('"abc"');
  });
});

describe('agent activity keeps a learner', () => {
  const TOKEN = 'T'.repeat(43);
  const tokenRow = async (name: string) => {
    await ensureOAuthSchema(db);
    await db
      .prepare('INSERT INTO oauth_tokens (token_hash, kind, family_id, client_id, actor_name, wp_user_id, registration, created, expires, used) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0)')
      .bind(await sha256Hex(TOKEN), 'access', 'f', 'c', name, 1, 'r', NOW, NOW + 3_600_000)
      .run();
  };
  const use = (now: number) => resolveToken(env, new Request('http://x/mcp', { headers: { authorization: `Bearer ${TOKEN}` } }), now);

  it('a successful token use refreshes the session, so the sweep keeps that learner', async () => {
    await addSession('agent', 5, NOW - SESSION_IDLE_MS - 10 * DAY);
    await addSession('gone', 6, NOW - SESSION_IDLE_MS - 10 * DAY);
    await tokenRow('agent');
    expect(await use(NOW)).not.toBeNull();
    const r = await sweep(env, NOW);
    expect(r.expired).toBe(1);
    expect((await db.prepare('SELECT actor_name FROM sessions').first<any>()).actor_name).toBe('agent');
  });

  it('a failed token use does not refresh the session', async () => {
    await addSession('agent', 5, NOW - SESSION_IDLE_MS - 10 * DAY);
    await tokenRow('agent');
    expect(await use(NOW + 4_000_000)).toBeNull();
    expect((await sweep(env, NOW + 4_000_000)).expired).toBe(1);
  });
});

describe('DELETE /api/session', () => {
  it('answers a refused learner delete with a clear retryable error and keeps the session', async () => {
    const s = await addSession('abc', 77, NOW);
    answer = (m) => (m === 'DELETE' ? new Response('x', { status: 403 }) : undefined);
    const value = 'cookie-value';
    const k = await crypto.subtle.importKey('raw', new TextEncoder().encode('k'), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const hash = Array.from(new Uint8Array(await crypto.subtle.sign('HMAC', k, new TextEncoder().encode(value))), (b) => b.toString(16).padStart(2, '0')).join('');
    await db.prepare('UPDATE sessions SET sid_hash = ? WHERE sid_hash = ?').bind(hash, s.sidHash).run();
    const req = () => new Request('http://x/api/session', { method: 'DELETE', headers: { cookie: `${SESSION_COOKIE}=${value}` } });
    const res = await del(req(), { params: {}, env });
    expect(res.status).toBe(502);
    expect(JSON.stringify(await res.json())).toContain('delete-failed');
    // still retryable: once the ledger allows it, the same cookie deletes everything
    answer = () => undefined;
    const again = await del(req(), { params: {}, env });
    expect(await again.json()).toEqual({ deleted: true });
    expect(await count()).toBe(0);
  });
});

describe('sweep', () => {
  it('retention erases with revokeBadges false', async () => {
    await addSession('old', 5, NOW - SESSION_IDLE_MS - DAY);
    await addSession('fresh', 6, NOW - DAY);
    const r = await sweep(env, NOW);
    expect(r.expired).toBe(1);
    expect(r.retained).toBe(1);
    expect(JSON.parse(eraseCalls()[0].body).revokeBadges).toBe(false);
    expect(await count()).toBe(1);
    expect((await db.prepare('SELECT actor_name FROM sessions').first<any>()).actor_name).toBe('fresh');
  });

  it('a failing step is retried on the next sweep, not skipped', async () => {
    await addSession('old', 5, NOW - SESSION_IDLE_MS - DAY);
    answer = (m, u) => (u === `${LRS_API}/actors/erase` ? new Response('x', { status: 503 }) : undefined);
    let r = await sweep(env, NOW);
    expect(r.expired).toBe(0);
    expect(await count()).toBe(1);
    answer = () => undefined;
    r = await sweep(env, NOW + DAY);
    expect(r.expired).toBe(1);
    expect(await count()).toBe(0);
  });

  it('one learner failing does not stop the others', async () => {
    await addSession('a', 5, NOW - SESSION_IDLE_MS - 2 * DAY);
    await addSession('b', 6, NOW - SESSION_IDLE_MS - DAY);
    answer = (m, u) => (u.includes('/learners/5') ? new Response('x', { status: 503 }) : undefined);
    const r = await sweep(env, NOW);
    expect(r.expired).toBe(1);
    expect((await db.prepare('SELECT actor_name FROM sessions').first<any>()).actor_name).toBe('a');
  });
});

describe('drift', () => {
  const lrsStatement = (key: string, verb: string) => ({
    verb: { id: `http://adlnet.gov/expapi/verbs/${verb}` },
    object: { id: `${activityId(['lessons', key])}/au` },
    context: { contextActivities: { category: [{ id: 'https://w3id.org/xapi/cmi5/context/categories/cmi5' }] } },
  });
  const wire = (lrs: unknown[], sensei: { completed: number[]; tested_out: number[] }) => {
    answer = (m, u) => {
      if (u.startsWith(`${LRS_XAPI}/statements?`)) return new Response(JSON.stringify({ statements: lrs }), { status: 200 });
      if (u.includes('/progress')) return new Response(JSON.stringify({ courses: [{ course: 12, ...sensei }] }), { status: 200 });
      return undefined;
    };
  };

  it('drift reports a lesson complete in the LRS but not Sensei', async () => {
    await addSession('abc', 77, NOW - DAY);
    await recordShadowFact(env, 'abc', { lessonId: 'theme-json-basics', kind: 'completed' }, NOW);
    wire([lrsStatement('theme-json-basics', 'completed'), lrsStatement('block-patterns', 'waived')], { completed: [], tested_out: [102] });
    const r = await sweep(env, NOW);
    expect(r.drift).toEqual({ checked: 1, mismatched: [{ actor: 'abc', lrsOnly: ['theme-json-basics'], senseiOnly: [] }] });
    expect(await latestDrift(env)).toEqual(r.drift);
  });

  it('reports a lesson complete in Sensei but not the LRS, and none when they agree', async () => {
    await addSession('abc', 77, NOW - DAY);
    await recordShadowFact(env, 'abc', { lessonId: 'theme-json-basics', kind: 'completed' }, NOW);
    wire([], { completed: [101], tested_out: [] });
    expect((await sweep(env, NOW)).drift.mismatched).toEqual([{ actor: 'abc', lrsOnly: [], senseiOnly: ['theme-json-basics'] }]);
    wire([lrsStatement('theme-json-basics', 'completed')], { completed: [101], tested_out: [] });
    expect((await sweep(env, NOW)).drift).toEqual({ checked: 1, mismatched: [] });
  });

  it('says not configured, not checked 0, without LEDGER_PROGRAM_ID', async () => {
    delete env.LEDGER_PROGRAM_ID;
    await recordShadowFact(env, 'abc', { lessonId: 'theme-json-basics', kind: 'completed' }, NOW);
    expect((await sweep(env, NOW)).drift).toEqual({ checked: 0, mismatched: [], status: 'not-configured' });
  });

  it('asks the ledger for the configured program', async () => {
    await addSession('abc', 77, NOW - DAY);
    await recordShadowFact(env, 'abc', { lessonId: 'theme-json-basics', kind: 'completed' }, NOW);
    wire([], { completed: [], tested_out: [] });
    await sweep(env, NOW);
    expect(calls.find((c) => c.url.includes('/progress'))!.url).toContain('program=9');
  });

  it('checks nothing with the Sensei or LRS flag off', async () => {
    SERVER_FLAGS.senseiLearners = false;
    await recordShadowFact(env, 'abc', { lessonId: 'theme-json-basics', kind: 'completed' }, NOW);
    expect((await sweep(env, NOW)).drift).toEqual({ checked: 0, mismatched: [] });
  });
});

describe('routes', () => {
  const auth = (t: string) => ({ headers: { authorization: `Bearer ${t}` } });
  it('/api/sweep needs the cron secret and returns the counts', async () => {
    expect((await sweepRoute(new Request('http://x/api/sweep'), { params: {}, env })).status).toBe(401);
    const res = await sweepRoute(new Request('http://x/api/sweep', auth('cron')), { params: {}, env });
    expect(await res.json()).toMatchObject({ expired: 0, retained: 0, drift: { checked: 0, mismatched: [] } });
  });

  it('/api/admin/drift needs the admin token and serves the stored report', async () => {
    expect((await driftRoute(new Request('http://x/api/admin/drift', auth('nope')), { params: {}, env })).status).toBe(401);
    await sweepRoute(new Request('http://x/api/sweep', auth('cron')), { params: {}, env });
    const res = await driftRoute(new Request('http://x/api/admin/drift', auth('adm')), { params: {}, env });
    expect(await res.json()).toMatchObject({ drift: { checked: 0, mismatched: [] } });
  });
});
