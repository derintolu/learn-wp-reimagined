import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LEDGER_BASE, LRS_API, LRS_XAPI } from '../../functions/_lib/config';
import { createSqliteD1 } from '../../dev/sqliteD1';
import { brokerLimited } from '../helpers/brokerLimited';
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
import { REQUEST_TTL_MS, resolveToken, sha256Hex } from '../../functions/_lib/oauth/store';
import { activityId, XAPI_BASE } from '../../src/shared/xapi';

const SEED_HEX = '9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60';
const KEY = Buffer.from('302e020100300506032b657004220420' + SEED_HEX, 'hex').toString('base64');
const NOW = Date.UTC(2026, 9, 28, 12, 0, 0);
const DAY = 86_400_000;

let db: ReturnType<typeof createSqliteD1>;
let env: Env;
let calls: { method: string; url: string; body: string }[];
let answer: (method: string, url: string) => Response | undefined;

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
});
afterEach(() => {
  vi.unstubAllGlobals();
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

  it('delete my data deletes the Sensei learner without keeping badges; retention keeps them', async () => {
    const s = await addSession('abc', 77, NOW);
    await eraseLearner(env, s, { revokeBadges: true });
    const t = await addSession('def', 78, NOW);
    await eraseLearner(env, t, { revokeBadges: false });
    expect(calls.filter((c) => c.method === 'DELETE').map((c) => c.url.replace(LEDGER_BASE, ''))).toEqual([
      '/course-server/learners/77',
      '/course-server/learners/78?revokeBadges=false',
    ]);
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

  it('removes the cached official record', async () => {
    const s = await addSession('abc', null, NOW);
    await db.prepare('INSERT INTO record_cache (actor_name, body, at) VALUES (?, ?, ?)').bind('abc', '{}', NOW).run();
    await db.prepare('INSERT INTO record_cache (actor_name, body, at) VALUES (?, ?, ?)').bind('other', '{}', NOW).run();
    await eraseLearner(env, s, { revokeBadges: true });
    expect((await db.prepare('SELECT actor_name FROM record_cache').all<{ actor_name: string }>()).results).toEqual([{ actor_name: 'other' }]);
  });

  it('every table keyed by actor_name is erased', () => {
    const src = ['functions/_lib/db.ts', 'functions/_lib/session/lifecycle.ts'].map((f) => readFileSync(f, 'utf8')).join('\n');
    const tables = [...src.matchAll(/CREATE TABLE IF NOT EXISTS (\w+) \(([^']*)\)/g)].filter((m) => /\bactor_name\b/.test(m[2])).map((m) => m[1]);
    // sessions is removed last by deleteSession; oauth_codes and oauth_tokens by revokeAllForActor; drift_actors when
    // the learner's entries leave the stored drift reports.
    const handled = new Set([...ERASE_BEFORE_LRS, ...ERASE_AFTER_LRS, 'sessions', 'oauth_codes', 'oauth_tokens', 'drift_actors']);
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
    expect(calls.filter((c) => c.method === 'DELETE').map((c) => c.url.replace(LEDGER_BASE, ''))).toEqual(['/course-server/learners/5?revokeBadges=false']);
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

  it('a report over 64 KiB is stored and read back in parts under the broker limit', async () => {
    const log = { max: 0 };
    env = { ...env, DB: brokerLimited(db, log) };
    await addSession('abc', 77, NOW - DAY);
    await recordShadowFact(env, 'abc', { lessonId: 'theme-json-basics', kind: 'completed' }, NOW);
    const keys = Array.from({ length: 1000 }, (_, i) => `lesson-${String(i).padStart(4, '0')}-${'x'.repeat(90)}`);
    wire(keys.map((k) => lrsStatement(k, 'completed')), { completed: [], tested_out: [] });
    const r = await sweep(env, NOW);
    expect(r.drift.mismatched[0].lrsOnly).toHaveLength(1000);
    expect(JSON.stringify(r.drift).length).toBeGreaterThan(70_000);
    expect(log.max).toBeLessThanOrEqual(65_536);
    expect(await latestDrift(env)).toEqual(r.drift);
  });

  it('keeps only the latest seven reports', async () => {
    for (let d = 0; d < 9; d++) await sweep(env, NOW + d * DAY);
    const day = (n: number) => new Date(NOW + n * DAY).toISOString().slice(0, 10);
    const days = async (sql: string) => (await db.prepare(sql).all<{ day: string }>()).results.map((r) => r.day);
    const kept = [2, 3, 4, 5, 6, 7, 8].map(day);
    expect(await days('SELECT day FROM drift_reports ORDER BY day')).toEqual(kept);
    expect(await days('SELECT DISTINCT day FROM drift_report_parts ORDER BY day')).toEqual(kept);
  });

  it('erasing a learner removes their entries from every stored report', async () => {
    const abc = await addSession('abc', 77, NOW - DAY);
    await addSession('def', 78, NOW - DAY);
    for (const a of ['abc', 'def']) await recordShadowFact(env, a, { lessonId: 'theme-json-basics', kind: 'completed' }, NOW - DAY);
    wire([lrsStatement('theme-json-basics', 'completed')], { completed: [], tested_out: [] });
    await sweep(env, NOW - DAY);
    await sweep(env, NOW);
    const parts = async () => (await db.prepare('SELECT part FROM drift_report_parts ORDER BY day, seq').all<{ part: string }>()).results.map((r) => r.part).join('');
    expect((await parts()).match(/"abc"/g)).toHaveLength(2);
    await eraseLearner(env, abc, { revokeBadges: true });
    expect((await latestDrift(env))!.mismatched.map((m) => m.actor)).toEqual(['def']);
    expect(await parts()).not.toContain('"abc"');
    expect((await parts()).match(/"def"/g)).toHaveLength(2);
    expect((await db.prepare("SELECT COUNT(*) AS c FROM drift_actors WHERE actor_name = 'abc'").first<{ c: number }>())!.c).toBe(0);
  });

  it('drops a report stored whole before reports moved to parts, which no erase could clean', async () => {
    await db.prepare('CREATE TABLE IF NOT EXISTS drift_reports (day VARCHAR(10) PRIMARY KEY, body TEXT, created BIGINT)').run();
    await db
      .prepare('INSERT INTO drift_reports (day, body, created) VALUES (?, ?, ?)')
      .bind('2026-10-01', JSON.stringify({ checked: 1, mismatched: [{ actor: 'abc', lrsOnly: ['x'], senseiOnly: [] }] }), NOW - 27 * DAY)
      .run();
    expect(await latestDrift(env)).toBeNull();
    expect((await db.prepare('SELECT COUNT(*) AS c FROM drift_reports').first<{ c: number }>())!.c).toBe(0);
  });

  it('asks the ledger for the configured program', async () => {
    await addSession('abc', 77, NOW - DAY);
    await recordShadowFact(env, 'abc', { lessonId: 'theme-json-basics', kind: 'completed' }, NOW);
    wire([], { completed: [], tested_out: [] });
    await sweep(env, NOW);
    expect(calls.find((c) => c.url.includes('/progress'))!.url).toContain('program=9');
  });

});

describe('routes', () => {
  const auth = (t: string) => ({ headers: { authorization: `Bearer ${t}` } });
  it('/api/sweep needs the cron secret and returns the counts', async () => {
    expect((await sweepRoute(new Request('http://x/api/sweep'), { params: {}, env })).status).toBe(401);
    const res = await sweepRoute(new Request('http://x/api/sweep', auth('cron')), { params: {}, env });
    expect(await res.json()).toEqual({ expired: 0, retained: 0, drift: { checked: 0, mismatched: [] }, tokensExpired: 0, codesExpired: 0 });
  });

  it('/api/sweep deletes OAuth requests and codes expired past the replay grace, and keeps the rest', async () => {
    await ensureOAuthSchema(db);
    const now = Date.now();
    const code = (hash: string, kind: string, expires: number) =>
      db
        .prepare("INSERT INTO oauth_codes (code_hash, kind, client_id, redirect_uri, code_challenge, created, expires, used) VALUES (?, ?, 'c', 'http://r', 'x', 1, ?, 0)")
        .bind(hash, kind, expires)
        .run();
    await code('old-request', 'request', now - REQUEST_TTL_MS - 1000);
    await code('old-code', 'code', now - REQUEST_TTL_MS - 1000);
    await code('in-grace', 'code', now - 1000);
    await code('live', 'request', now + 60_000);
    const res = await sweepRoute(new Request('http://x/api/sweep', auth('cron')), { params: {}, env });
    expect(await res.json()).toMatchObject({ codesExpired: 2 });
    const left = (await db.prepare('SELECT code_hash FROM oauth_codes ORDER BY code_hash').all<{ code_hash: string }>()).results.map((r) => r.code_hash);
    expect(left).toEqual(['in-grace', 'live']);
  });

  it('/api/sweep deletes expired OAuth tokens and keeps live ones', async () => {
    await ensureOAuthSchema(db);
    const now = Date.now();
    const token = (hash: string, kind: string, expires: number) =>
      db
        .prepare("INSERT INTO oauth_tokens (token_hash, kind, family_id, client_id, actor_name, wp_user_id, registration, created, expires, used) VALUES (?, ?, 'f', 'c', 'abc', 1, 'r', 1, ?, 0)")
        .bind(hash, kind, expires)
        .run();
    await token('old-access', 'access', now - 1000);
    await token('old-refresh', 'refresh', now - 1000);
    await token('live-access', 'access', now + 3_600_000);
    await token('live-refresh', 'refresh', now + 30 * DAY);
    const res = await sweepRoute(new Request('http://x/api/sweep', auth('cron')), { params: {}, env });
    expect(await res.json()).toMatchObject({ tokensExpired: 2 });
    const left = (await db.prepare('SELECT token_hash FROM oauth_tokens ORDER BY token_hash').all<{ token_hash: string }>()).results.map((r) => r.token_hash);
    expect(left).toEqual(['live-access', 'live-refresh']);
  });

  it('/api/admin/drift needs the admin token and serves the stored report', async () => {
    expect((await driftRoute(new Request('http://x/api/admin/drift', auth('nope')), { params: {}, env })).status).toBe(401);
    await sweepRoute(new Request('http://x/api/sweep', auth('cron')), { params: {}, env });
    const res = await driftRoute(new Request('http://x/api/admin/drift', auth('adm')), { params: {}, env });
    expect(await res.json()).toMatchObject({ drift: { checked: 0, mismatched: [] } });
  });
});
