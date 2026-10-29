// A slow first registration (ruling R52): the live LRS answers each call in about 600 ms, so a new learner's
// registration (a State GET, then a PUT) cannot be ready within the shadow budget. The event still answers in
// time, the LRS is not marked down, and no learning fact is lost.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { SERVER_FLAGS } from '../../functions/_lib/config';
import { PHASES_OFF, restoreServerFlags, setServerFlags } from '../helpers/flags';
import { createSqliteD1 } from '../../dev/sqliteD1';
import { buildContent } from '../../scripts/build-content';
import { setContentForTests } from '../../functions/_lib/content';
import { ensureRecordSchema, ensureSchema } from '../../functions/_lib/db';
import type { Env } from '../../functions/_lib/env';
import { POST as events } from '../../functions/api/events';
import { SESSION_COOKIE, createSession, type Session } from '../../functions/_lib/session/session';
import { INLINE_DRAIN_BUDGET_MS } from '../../functions/_lib/lrs/outbox';
import { lrsHealth } from '../../functions/_lib/record/registration';
import { holdPending, listShadowFacts, replayPending } from '../../functions/_lib/record/shadow';
import { eraseLearner } from '../../functions/_lib/session/lifecycle';
import type { EventResult, ServerEvent } from '../../src/shared/events';
import type { XapiStatement } from '../../vendor/course-xapi-mcp/core/xapi/types';
import { fakeLrs } from '../helpers/fakeLrs';

const REG = '7d3c1a2b-4e5f-4a6b-8c7d-9e0f1a2b3c4d';
const FREE = 'theme-json-basics';
const LEARNER = '3f2b8c1e-5d4a-4e6f-8a9b-0c1d2e3f4a5b';

let db: ReturnType<typeof createSqliteD1>;
let env: Env;
let lrs: ReturnType<typeof fakeLrs>;
let waits: Promise<unknown>[];

const opened = { eventId: 'evt-00000001', type: 'lessonOpened', lessonId: FREE };
const completed = { eventId: 'evt-00000002', type: 'lessonCompleted', lessonId: FREE };
const verbOf = (s: XapiStatement) => s.verb.id.split('/').pop();
const today = () => new Date().toISOString().slice(0, 10);

async function learner(): Promise<{ session: Session; cookie: string }> {
  const { session, cookie } = await createSession(env, Date.now());
  return { session, cookie: cookie.split(';')[0].split('=').slice(1).join('=') };
}
async function post(evs: object[], cookie: string, withWaitUntil: boolean) {
  const ctx = { params: {}, env, ...(withWaitUntil ? { ctx: { waitUntil: (p: Promise<unknown>) => void waits.push(p) } } : {}) };
  const req = new Request('http://x/api/events', {
    method: 'POST',
    headers: { cookie: `${SESSION_COOKIE}=${cookie}` },
    body: JSON.stringify({ learnerId: LEARNER, events: evs }),
  });
  const t0 = Date.now();
  const res = await events(req, ctx);
  return { res, ms: Date.now() - t0 };
}
/** Runs everything handed to waitUntil, as the platform does after the response. */
async function settle() {
  while (waits.length) await waits.shift();
}
const cachedRegistration = async (s: Session) =>
  (await db.prepare('SELECT registration FROM sessions WHERE sid_hash = ?').bind(s.sidHash).first<{ registration: string | null }>())?.registration ?? null;
const outbox = async () =>
  (await db.prepare('SELECT body FROM lrs_outbox ORDER BY created, statement_id').all<{ body: string }>()).results.map((r) => JSON.parse(r.body) as XapiStatement);
const pendingCount = async () =>
  Number((await db.prepare('SELECT COUNT(*) AS n FROM official_pending').first<{ n: number }>())!.n) +
  Number((await db.prepare('SELECT COUNT(*) AS n FROM official_pending_parts').first<{ n: number }>())!.n);
const stateCalls = () => lrs.calls.filter((c) => c.url.includes('/activities/state')).length;

beforeEach(async () => {
  setServerFlags(PHASES_OFF);
  SERVER_FLAGS.lrsShadow = true;
  setContentForTests(buildContent('tests/fixtures/content'));
  db = createSqliteD1();
  env = { DB: db, SESSION_KEY: 'test-session-key-not-a-secret', LRS_KEY: 'ck_test', LRS_SECRET: 'cs_test' };
  await ensureSchema(db);
  await ensureRecordSchema(db);
  lrs = fakeLrs();
  lrs.delayMs = 600;
  vi.stubGlobal('fetch', lrs.fetch);
  lrsHealth.downUntil = 0;
  waits = [];
});
afterEach(() => {
  restoreServerFlags();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('a slow first registration', () => {
  it('answers within the budget; after the response the registration is cached and the statements and facts recorded', async () => {
    const { session, cookie } = await learner();
    const { res, ms } = await post([opened, completed], cookie, true);
    expect(res.status).toBe(200);
    expect(ms).toBeLessThan(INLINE_DRAIN_BUDGET_MS + 400);
    expect(((await res.json()) as any).results.every((r: EventResult) => r.ok)).toBe(true);
    // A late lookup is not an outage.
    expect(lrsHealth.downUntil).toBe(0);
    expect(await cachedRegistration(session)).toBeNull();

    await settle();
    const registration = await cachedRegistration(session);
    expect(registration).toMatch(/^[0-9a-f-]{36}$/);
    const sent = [...(await outbox()), ...lrs.statements];
    expect(sent.map(verbOf)).toEqual(['launched', 'initialized', 'completed']);
    expect(sent.every((s) => s.context.registration === registration)).toBe(true);
    expect(await listShadowFacts(env, today())).toEqual([{ actor: session.actorName, facts: [{ lessonId: FREE, kind: 'completed' }] }]);
    expect(await pendingCount()).toBe(0);
  }, 10_000);

  it('a second event in the same isolate still looks the registration up, and both are recorded once', async () => {
    const { session, cookie } = await learner();
    const first = await post([opened], cookie, true);
    expect(first.res.status).toBe(200);
    expect(lrsHealth.downUntil).toBe(0);
    const before = stateCalls();
    const second = await post([completed], cookie, true);
    expect(second.res.status).toBe(200);
    expect(second.ms).toBeLessThan(INLINE_DRAIN_BUDGET_MS + 400);
    expect(stateCalls()).toBeGreaterThan(before);

    await settle();
    const registration = await cachedRegistration(session);
    const sent = [...lrs.statements, ...(await outbox())];
    expect(sent.map(verbOf)).toEqual(['launched', 'initialized', 'completed']);
    expect(sent.every((s) => s.context.registration === registration)).toBe(true);
    expect(await listShadowFacts(env, today())).toEqual([{ actor: session.actorName, facts: [{ lessonId: FREE, kind: 'completed' }] }]);
    expect(await pendingCount()).toBe(0);
  }, 10_000);

  it('without waitUntil, the next event replays the held ones first, in order, at their own time', async () => {
    const { session, cookie } = await learner();
    const first = await post([opened], cookie, false);
    expect(first.res.status).toBe(200);
    expect(first.ms).toBeLessThan(INLINE_DRAIN_BUDGET_MS + 400);
    expect(await pendingCount()).toBeGreaterThan(0);
    expect(await outbox()).toEqual([]);

    lrs.delayMs = 0;
    const t1 = Date.now();
    expect((await post([completed], cookie, false)).res.status).toBe(200);
    const registration = await cachedRegistration(session);
    const sent = [...lrs.statements, ...(await outbox())];
    expect(sent.map(verbOf)).toEqual(['launched', 'initialized', 'completed']);
    expect(sent.every((s) => s.context.registration === registration)).toBe(true);
    // The held event keeps its decision time, so its ids and timestamps are the ones it would have had.
    expect(Date.parse(sent[0].timestamp!)).toBeLessThan(t1);
    expect(Date.parse(sent[2].timestamp!)).toBeGreaterThanOrEqual(t1);
    expect(await listShadowFacts(env, today())).toEqual([{ actor: session.actorName, facts: [{ lessonId: FREE, kind: 'completed' }] }]);
    expect(await pendingCount()).toBe(0);
  }, 10_000);

  it('the LRS down: the events are held, and a delete erases them', async () => {
    lrs.delayMs = 0;
    lrs.down = true;
    const { session, cookie } = await learner();
    expect((await post([opened, completed], cookie, false)).res.status).toBe(200);
    expect(await pendingCount()).toBeGreaterThan(0);
    lrs.down = false;
    await eraseLearner(env, session, { revokeBadges: false });
    expect(await pendingCount()).toBe(0);
  });

  it('replaying twice yields one set of statements and facts', async () => {
    lrs.delayMs = 0;
    const { session } = await learner();
    await db.prepare('UPDATE sessions SET registration = ? WHERE sid_hash = ?').bind(REG, session.sidHash).run();
    const evs = [opened, completed] as ServerEvent[];
    const results: EventResult[] = evs.map((e) => ({ eventId: e.eventId, ok: true, statements: [] }));
    const now = Date.now() - 5000;
    await holdPending(env, session.actorName, evs, results, now);
    await Promise.all([replayPending(env, session, REG), replayPending(env, session, REG)]);
    const once = (await outbox()).map((s) => JSON.stringify(s));
    expect(once.map((s) => verbOf(JSON.parse(s)))).toEqual(['launched', 'initialized', 'completed']);
    expect(await pendingCount()).toBe(0);
    // Held again (a replay that stopped before removing its rows): the same statements, nothing more.
    await holdPending(env, session.actorName, evs, results, now);
    expect(await replayPending(env, session, REG)).toBe(true);
    expect((await outbox()).map((s) => JSON.stringify(s))).toEqual(once);
    // At the decision time (statements sit 1 ms apart from it), not the replay's.
    expect(Date.parse(JSON.parse(once[0]).timestamp) - now).toBeLessThan(20);
    expect(await listShadowFacts(env, new Date(now).toISOString().slice(0, 10))).toEqual([{ actor: session.actorName, facts: [{ lessonId: FREE, kind: 'completed' }] }]);
    expect(await pendingCount()).toBe(0);
  });

  it('a replay past its deadline leaves the held events in place', async () => {
    lrs.delayMs = 0;
    const { session } = await learner();
    const evs = [opened] as ServerEvent[];
    await holdPending(env, session.actorName, evs, [{ eventId: opened.eventId, ok: true, statements: [] }], Date.now());
    const held = await pendingCount();
    expect(await replayPending(env, session, REG, Date.now() - 1)).toBe(false);
    expect(await pendingCount()).toBe(held);
    expect(await outbox()).toEqual([]);
  });

  it('a large held event is stored in parts under the operation limit', async () => {
    lrs.delayMs = 0;
    const { session } = await learner();
    const big = { eventId: 'evt-00000009', type: 'beatViewed', lessonId: FREE, beatIndex: 0, note: 'x'.repeat(150_000) } as unknown as ServerEvent;
    await holdPending(env, session.actorName, [big], [{ eventId: big.eventId, ok: true, statements: [] }], Date.now());
    const parts = (await db.prepare('SELECT LENGTH(part) AS n FROM official_pending_parts').all<{ n: number }>()).results;
    expect(parts.length).toBeGreaterThan(1);
    expect(parts.every((p) => p.n < 64 * 1024)).toBe(true);
    expect(await replayPending(env, session, REG)).toBe(true);
    expect((await outbox()).map(verbOf)).toEqual(['launched', 'initialized', 'experienced']);
  });
});
