import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { SERVER_FLAGS } from '../../functions/_lib/config';
import { createSqliteD1 } from '../../dev/sqliteD1';
import { buildContent } from '../../scripts/build-content';
import { setContentForTests } from '../../functions/_lib/content';
import { ensureRecordSchema, ensureSchema } from '../../functions/_lib/db';
import type { Env } from '../../functions/_lib/env';
import { POST as events } from '../../functions/api/events';
import { GET as lrsDrain } from '../../functions/api/lrs-drain';
import { SESSION_COOKIE, createSession } from '../../functions/_lib/session/session';
import { BACKOFF_MINUTES, DEAD_LETTER_AFTER, DRAIN_BATCH, INLINE_DRAIN_BUDGET_MS, drain, enqueue } from '../../functions/_lib/lrs/outbox';
import { lrsHealth } from '../../functions/_lib/record/registration';
import { auIdOf } from '../../functions/_lib/record/official';
import { ADL_VERBS, CMI5, activityIds } from '../../vendor/course-xapi-mcp/core/constants';
import { checkProfile } from '../../vendor/course-xapi-mcp/core/xapi/profile-check';
import type { XapiStatement } from '../../vendor/course-xapi-mcp/core/xapi/types';
import { fakeLrs } from '../helpers/fakeLrs';

const NOW = Date.UTC(2026, 9, 27, 12, 0, 0);
const MIN = 60_000;
const REG = '7d3c1a2b-4e5f-4a6b-8c7d-9e0f1a2b3c4d';
const FREE = 'theme-json-basics';
const CRON = 'cron-secret-for-tests';

let db: ReturnType<typeof createSqliteD1>;
let env: Env;
let lrs: ReturnType<typeof fakeLrs>;

const stmt = (i: number, extra: object = {}) =>
  ({ id: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`, verb: { id: 'v' }, ...extra }) as unknown as XapiStatement;
const rows = async () =>
  (await db.prepare('SELECT statement_id, body, attempts, next_at FROM lrs_outbox ORDER BY created, statement_id').all<{ statement_id: string; body: string; attempts: number; next_at: number }>()).results;

beforeEach(async () => {
  setContentForTests(buildContent('tests/fixtures/content'));
  db = createSqliteD1();
  env = { DB: db, SESSION_KEY: 'test-session-key-not-a-secret', LRS_KEY: 'ck_test', LRS_SECRET: 'cs_test', CRON_SECRET: CRON };
  await ensureSchema(db);
  await ensureRecordSchema(db);
  lrs = fakeLrs();
  vi.stubGlobal('fetch', lrs.fetch);
  lrsHealth.downUntil = 0;
});
afterEach(() => {
  SERVER_FLAGS.lrsShadow = false;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('outbox', () => {
  it('re-enqueueing a statement id is a no-op', async () => {
    await enqueue(env, [stmt(1, { timestamp: 'first' })], NOW);
    await enqueue(env, [stmt(1, { timestamp: 'second' }), stmt(2)], NOW + 1000);
    const r = await rows();
    expect(r.map((x) => x.statement_id)).toEqual([stmt(1).id, stmt(2).id]);
    expect(JSON.parse(r[0].body).timestamp).toBe('first');
  });

  it('drain deletes rows once stored and backs off on failure', async () => {
    await enqueue(env, [stmt(1), stmt(2), stmt(3)], NOW);
    expect(await drain(env, NOW, 800)).toEqual({ sent: 3, left: 0 });
    expect(lrs.statements.map((s) => s.id)).toEqual([stmt(1).id, stmt(2).id, stmt(3).id]);
    expect(await rows()).toEqual([]);

    expect(BACKOFF_MINUTES).toEqual([1, 5, 15, 60]);
    lrs.down = true;
    await enqueue(env, [stmt(4)], NOW);
    let t = NOW;
    for (const wait of [1, 5, 15, 60, 60]) {
      expect(await drain(env, t, 800)).toEqual({ sent: 0, left: 1 });
      const [r] = await rows();
      expect(r.next_at).toBe(t + wait * MIN);
      const posts = lrs.posts.length;
      expect(await drain(env, r.next_at - 1, 800)).toEqual({ sent: 0, left: 1 });
      expect(lrs.posts.length).toBe(posts);
      t = r.next_at;
    }
    expect((await rows())[0].attempts).toBe(5);
    lrs.down = false;
    expect(await drain(env, t, 800)).toEqual({ sent: 1, left: 0 });
  });

  it('drains in batches of 50, oldest first', async () => {
    expect(DRAIN_BATCH).toBe(50);
    await enqueue(env, Array.from({ length: 120 }, (_, i) => stmt(i)), NOW);
    expect(await drain(env, NOW, 10_000)).toEqual({ sent: 120, left: 0 });
    expect(lrs.posts.map((p) => p.length)).toEqual([50, 50, 20]);
    expect(lrs.posts[0][0].id).toBe(stmt(0).id);
  });

  it('stops starting batches once the budget is spent', async () => {
    await enqueue(env, [stmt(1)], NOW);
    expect(await drain(env, NOW, 0)).toEqual({ sent: 0, left: 1 });
    expect(lrs.calls).toEqual([]);
  });

  it('rows queued later in a request are due at once, in queue order', async () => {
    await enqueue(env, [stmt(1)], NOW, 0);
    await enqueue(env, [stmt(2), stmt(3)], NOW, 1);
    expect(await drain(env, NOW, 800)).toEqual({ sent: 3, left: 0 });
    expect(lrs.posts[0].map((s) => s.id)).toEqual([stmt(1).id, stmt(2).id, stmt(3).id]);
  });

  it('a statement the LRS keeps refusing is dead-lettered, not retried for ever', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    await enqueue(env, [stmt(1)], NOW);
    lrs.rejectIds.add(stmt(1).id);
    let t = NOW;
    for (let i = 1; i < DEAD_LETTER_AFTER; i++) {
      expect(await drain(env, t, 800)).toEqual({ sent: 0, left: 1 });
      t = (await rows())[0].next_at;
    }
    expect(log).not.toHaveBeenCalled();
    expect(await drain(env, t, 800)).toEqual({ sent: 0, left: 0 });
    expect(log).toHaveBeenCalledWith('lrs statement dead-lettered', stmt(1).id, 400);
    const [r] = await rows();
    expect(r.attempts).toBe(DEAD_LETTER_AFTER);
    const posts = lrs.posts.length;
    expect(await drain(env, t + 365 * 24 * 60 * MIN, 800)).toEqual({ sent: 0, left: 0 });
    expect(lrs.posts.length).toBe(posts);
  });

  it('a rejected statement does not hold back the rest of its batch', async () => {
    await enqueue(env, [stmt(1), stmt(2), stmt(3)], NOW);
    lrs.rejectIds.add(stmt(2).id);
    expect(await drain(env, NOW, 800)).toEqual({ sent: 2, left: 1 });
    const [r] = await rows();
    expect(r).toMatchObject({ statement_id: stmt(2).id, attempts: 1, next_at: NOW + MIN });
  });
});

describe('POST /api/events with the LRS in shadow', () => {
  async function post(body: unknown, cookie: string) {
    return events(
      new Request('http://x/api/events', { method: 'POST', headers: { cookie: `${SESSION_COOKIE}=${cookie}` }, body: JSON.stringify(body) }),
      { params: {}, env },
    );
  }
  async function returningLearner() {
    const { session, cookie } = await createSession(env, Date.now());
    await db.prepare('UPDATE sessions SET registration = ? WHERE sid_hash = ?').bind(REG, session.sidHash).run();
    return cookie.split(';')[0].split('=').slice(1).join('=');
  }
  const completed = { learnerId: '3f2b8c1e-5d4a-4e6f-8a9b-0c1d2e3f4a5b', events: [{ eventId: 'evt-00000001', type: 'lessonCompleted', lessonId: FREE }] };

  it('LRS down: the event still answers and the outbox keeps the row', async () => {
    SERVER_FLAGS.lrsShadow = true;
    const cookie = await returningLearner();
    lrs.down = true;
    const res = await post(completed, cookie);
    expect(res.status).toBe(200);
    const { results } = (await res.json()) as any;
    expect(results[0]).toMatchObject({ ok: true });
    expect(results[0].statements).toHaveLength(1);
    expect(lrs.calls.some((c) => c.method === 'POST' && c.url.endsWith('/statements'))).toBe(true);
    const r = await rows();
    expect(r.map((x) => JSON.parse(x.body).verb.id)).toEqual([ADL_VERBS.launched, ADL_VERBS.initialized, ADL_VERBS.completed]);
    expect(r.every((x) => x.attempts === 1)).toBe(true);
  });

  it('a batch of several events is drained whole after deciding', async () => {
    SERVER_FLAGS.lrsShadow = true;
    const cookie = await returningLearner();
    const res = await post(
      {
        learnerId: completed.learnerId,
        events: [
          { eventId: 'evt-00000011', type: 'lessonOpened', lessonId: FREE },
          { eventId: 'evt-00000012', type: 'beatViewed', lessonId: FREE, beatIndex: 0 },
          { eventId: 'evt-00000013', type: 'lessonCompleted', lessonId: FREE },
        ],
      },
      cookie,
    );
    expect(res.status).toBe(200);
    expect(lrs.statements.map((s) => s.verb.id)).toEqual([ADL_VERBS.launched, ADL_VERBS.initialized, ADL_VERBS.experienced, ADL_VERBS.completed]);
    expect(await rows()).toEqual([]);
  });

  it('a hanging LRS: a new learner is answered within the budget, and the LRS is not asked again at once', async () => {
    SERVER_FLAGS.lrsShadow = true;
    const { cookie } = await createSession(env, Date.now());
    const value = cookie.split(';')[0].split('=').slice(1).join('=');
    lrs.hang = true;
    const t0 = Date.now();
    const res = await post(completed, value);
    expect(Date.now() - t0).toBeLessThan(INLINE_DRAIN_BUDGET_MS + 400);
    expect(res.status).toBe(200);
    expect(((await res.json()) as any).results[0]).toMatchObject({ ok: true });
    expect(await rows()).toEqual([]);
    const calls = lrs.calls.length;
    const t1 = Date.now();
    expect((await post(completed, value)).status).toBe(200);
    expect(Date.now() - t1).toBeLessThan(300);
    expect(lrs.calls.length).toBe(calls);
  });

  it('a hanging LRS: a returning learner is answered within the budget and the rows stay queued', async () => {
    SERVER_FLAGS.lrsShadow = true;
    const cookie = await returningLearner();
    lrs.hang = true;
    const t0 = Date.now();
    const res = await post(completed, cookie);
    expect(Date.now() - t0).toBeLessThan(INLINE_DRAIN_BUDGET_MS + 400);
    expect(res.status).toBe(200);
    expect((await rows()).map((x) => JSON.parse(x.body).verb.id)).toEqual([ADL_VERBS.launched, ADL_VERBS.initialized, ADL_VERBS.completed]);
  });

  it('LRS up: the statements are posted after deciding and leave the outbox', async () => {
    SERVER_FLAGS.lrsShadow = true;
    const cookie = await returningLearner();
    const res = await post(completed, cookie);
    expect(res.status).toBe(200);
    expect(lrs.statements.map((s) => s.verb.id)).toEqual([ADL_VERBS.launched, ADL_VERBS.initialized, ADL_VERBS.completed]);
    expect(await rows()).toEqual([]);
  });
});

describe('GET /api/lrs-drain', () => {
  const get = (auth?: string) =>
    lrsDrain(new Request('http://x/api/lrs-drain', { headers: auth ? { authorization: auth } : {} }), { params: {}, env });

  it('needs the CRON_SECRET bearer', async () => {
    expect((await get()).status).toBe(401);
    expect((await get('Bearer wrong')).status).toBe(401);
    expect((await get(`Bearer ${CRON}`)).status).toBe(200);
  });

  it('idle AU session is abandoned by the cron', async () => {
    SERVER_FLAGS.lrsShadow = true;
    const { session } = await createSession(env, Date.now());
    await db.prepare('UPDATE sessions SET registration = ? WHERE sid_hash = ?').bind(REG, session.sidHash).run();
    const now = Date.now();
    const sid = '0a1b2c3d-4e5f-4061-8728-394a5b6c7d8e';
    await db
      .prepare('INSERT INTO au_sessions (actor_name, au_key, session_id, started, last) VALUES (?, ?, ?, ?, ?)')
      .bind(session.actorName, FREE, sid, now - 50 * MIN, now - 31 * MIN)
      .run();
    await db
      .prepare('INSERT INTO au_sessions (actor_name, au_key, session_id, started, last) VALUES (?, ?, ?, ?, ?)')
      .bind(session.actorName, 'patterns', '1a1b2c3d-4e5f-4061-8728-394a5b6c7d8e', now - 10 * MIN, now - 5 * MIN)
      .run();
    const res = await get(`Bearer ${CRON}`);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ abandoned: 1, sent: 1, left: 0 });
    const [s] = lrs.statements as XapiStatement[];
    expect(s.verb.id).toBe(ADL_VERBS.abandoned);
    expect(s.object.id).toBe(activityIds.au(auIdOf(FREE)));
    expect(s.context.extensions?.[CMI5.extSessionId]).toBe(sid);
    expect(s.context.registration).toBe(REG);
    expect(s.result?.duration).toBe('PT19M');
    expect(checkProfile(s, { lmsActor: true })).toEqual([]);
    const left = await db.prepare('SELECT au_key FROM au_sessions').all<{ au_key: string }>();
    expect(left.results.map((r) => r.au_key)).toEqual(['patterns']);
  });

  it('does nothing with the flag off', async () => {
    await enqueue(env, [stmt(1)], NOW);
    expect(await (await get(`Bearer ${CRON}`)).json()).toEqual({ sent: 0, left: 0, abandoned: 0 });
    expect(lrs.calls).toEqual([]);
  });
});
