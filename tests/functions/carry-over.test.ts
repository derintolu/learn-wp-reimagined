import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createSqliteD1 } from '../../dev/sqliteD1';
import { buildContent } from '../../scripts/build-content';
import { setContentForTests } from '../../functions/_lib/content';
import { ensureRecordSchema, ensureSchema } from '../../functions/_lib/db';
import type { Env } from '../../functions/_lib/env';
import { createSession, type Session } from '../../functions/_lib/session/session';
import { EXT_CARRIED_OVER, OFFICIAL_COURSE_ID, auIdOf, officialActor } from '../../functions/_lib/record/official';
import { POST } from '../../functions/api/carry-over';
import { GET as getState } from '../../functions/api/state';
import { ADL_VERBS, CMI5 } from '../../vendor/course-xapi-mcp/core/constants';
import { checkProfile } from '../../vendor/course-xapi-mcp/core/xapi/profile-check';
import { activityIds } from '../../vendor/course-xapi-mcp/core/constants';
import type { XapiStatement } from '../../vendor/course-xapi-mcp/core/xapi/types';
import { LEDGER_ENV, fakeLrs } from '../helpers/fakeLrs';
import { enrolHealth } from '../../functions/_lib/session/enrol';

const NOW = Date.UTC(2026, 9, 28, 12, 0, 0);
const REG = '7d3c1a2b-4e5f-4a6b-8c7d-9e0f1a2b3c4d';
const FIRST = 'theme-json-basics';
const SECOND = 'templates-and-parts';

let db: ReturnType<typeof createSqliteD1>;
let env: Env;
let lrs: ReturnType<typeof fakeLrs>;
let session: Session;
let cookie: string;

const stateKey = (stateId: string, registration = '') => [OFFICIAL_COURSE_ID, JSON.stringify(officialActor(session.actorName)), registration, stateId].join('|');
/** What the studio reads back: GET /api/state/:kind for this session. */
const studioState = async (kind: 'files' | 'resume') =>
  ((await (await getState(new Request(`http://x/api/state/${kind}`, { headers: { cookie } }), { params: { kind }, env })).json()) as { doc: any }).doc;
const call = (body: unknown, withCookie = true) =>
  POST(
    new Request('http://x/api/carry-over', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(withCookie ? { cookie } : {}) },
      body: JSON.stringify(body),
    }),
    { params: {}, env },
  );
/** Every official statement the call produced: drained to the LRS already, or still queued. */
const outbox = async () => [
  ...(lrs.statements as XapiStatement[]),
  ...(await db.prepare('SELECT body FROM lrs_outbox ORDER BY created, statement_id').all<{ body: string }>()).results.map((r) => JSON.parse(r.body) as XapiStatement),
];

beforeEach(async () => {
  setContentForTests(buildContent('tests/fixtures/content'));
  db = createSqliteD1();
  env = { DB: db, SESSION_KEY: 'test-session-key-not-a-secret', LRS_KEY: 'ck_test', LRS_SECRET: 'cs_test', ...LEDGER_ENV };
  await ensureSchema(db);
  await ensureRecordSchema(db);
  lrs = fakeLrs();
  vi.stubGlobal('fetch', lrs.fetch);
  const made = await createSession(env, Date.now());
  session = made.session;
  cookie = made.cookie.split(';')[0];
  lrs.state.set(stateKey('cxm-current-registration'), { registration: REG });
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('POST /api/carry-over', () => {
  it('carried-over lessons are waived Administrative with the extension', async () => {
    const res = await call({
      completedLessons: [FIRST, SECOND, 'no-such-lesson'],
      files: { 'theme.json': '{"version":3}' },
      current: { pathId: 'block-theme', lessonId: SECOND, beatIndex: 2 },
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ waived: [FIRST, SECOND] });
    const sent = await outbox();
    expect(sent).toHaveLength(2);
    expect(sent.map((s) => s.object.id)).toEqual([activityIds.au(auIdOf(FIRST)), activityIds.au(auIdOf(SECOND))]);
    for (const s of sent) {
      expect(s.verb.id).toBe(ADL_VERBS.waived);
      expect(s.result?.extensions?.[CMI5.extReason]).toBe('Administrative');
      expect(s.result?.extensions?.[EXT_CARRIED_OVER]).toBe(true);
      expect(s.context.registration).toBe(REG);
      expect(checkProfile(s, { lmsActor: true })).toEqual([]);
    }
    // The studio's own documents, under the learner's registration, in the shapes it reads.
    expect(lrs.state.has(stateKey('lwr-files'))).toBe(false);
    expect(lrs.state.has(stateKey('lwr-resume'))).toBe(false);
    expect(await studioState('files')).toEqual({ files: { 'theme.json': '{"version":3}' } });
    expect(await studioState('resume')).toEqual({ current: { pathId: 'block-theme', lessonId: SECOND, beatIndex: 2 }, updatedAt: expect.any(String) });
  });

  it('merges carried files into the studio document: a file edited there keeps its edit, the rest are added', async () => {
    lrs.state.set(stateKey('lwr-files', REG), {
      files: { 'theme.json': '{"version":3,"edited":true}' },
      fileLessons: { 'theme.json': FIRST },
      times: { 'theme.json': '2026-10-28T11:00:00.000Z' },
    });
    const here = { pathId: 'block-theme', lessonId: FIRST, beatIndex: 0 };
    lrs.state.set(stateKey('lwr-resume', REG), { current: here, updatedAt: '2026-10-28T11:00:00.000Z' });
    const res = await call({
      completedLessons: [],
      files: { 'theme.json': '{"version":3}', 'style.css': 'body{}' },
      current: { pathId: 'block-theme', lessonId: SECOND, beatIndex: 2 },
    });
    expect(res.status).toBe(200);
    expect(await studioState('files')).toEqual({
      files: { 'theme.json': '{"version":3,"edited":true}', 'style.css': 'body{}' },
      fileLessons: { 'theme.json': FIRST },
      times: { 'theme.json': '2026-10-28T11:00:00.000Z' },
    });
    // The place the studio already keeps is newer than the old record's.
    expect((await studioState('resume')).current).toEqual(here);
  });

  it('does not waive a lesson the official record already satisfies', async () => {
    await db
      .prepare('INSERT INTO official_outcomes (actor_name, registration, activity_id, verb, event_id) VALUES (?, ?, ?, ?, ?)')
      .bind(session.actorName, REG, activityIds.au(auIdOf(FIRST)), 'waived', 'evt-00000001')
      .run();
    const res = await call({ completedLessons: [FIRST, SECOND] });
    expect(await res.json()).toEqual({ waived: [SECOND] });
  });

  it('old statements are never posted', async () => {
    const old = { id: '11111111-1111-4111-8111-111111111111', verb: { id: 'http://x/v' }, object: { id: 'http://x/o' } };
    const res = await call({ completedLessons: [FIRST], files: {}, statements: [old] });
    expect(res.status).toBe(200);
    expect(JSON.stringify(await outbox())).not.toContain(old.id);
    expect((await outbox()).map((s) => s.verb.id)).toEqual([ADL_VERBS.waived]);
  });

  it('second call is 409', async () => {
    expect((await call({ completedLessons: [FIRST] })).status).toBe(200);
    const again = await call({ completedLessons: [SECOND] });
    expect(again.status).toBe(409);
    expect(await outbox()).toHaveLength(1);
  });

  it('a failure releases the claim so the learner can try again', async () => {
    lrs.down = true;
    expect((await call({ completedLessons: [FIRST] })).status).toBe(503);
    lrs.down = false;
    expect((await call({ completedLessons: [FIRST] })).status).toBe(200);
  });

  it('401 without a session, 400 for a bad body', async () => {
    expect((await call({ completedLessons: [] }, false)).status).toBe(401);
    expect((await call({ completedLessons: 'x' })).status).toBe(400);
    expect((await call({ completedLessons: [], files: { a: 1 } })).status).toBe(400);
    expect(lrs.calls).toEqual([]);
  });
});

/** The ledger refuses to make a learner (503) while `refuse` is set; every other call goes to the fake LRS. */
const learnerDown = (real: typeof fetch, refuse: { on: boolean }) =>
  (async (input: RequestInfo | URL, init?: RequestInit) =>
    refuse.on && init?.method === 'POST' && String(input).endsWith('/course-server/learners') ? new Response('x', { status: 503 }) : real(input, init)) as typeof fetch;
const OLD_ACTOR = 'legacy-actor-made-before-learners';
const sessionActor = async () => (await env.DB.prepare('SELECT actor_name FROM sessions').first<{ actor_name: string }>())!.actor_name;

describe('POST /api/carry-over for a session made before Sensei learners were on', () => {
  const refuse = { on: false };
  beforeEach(async () => {
    enrolHealth.downUntil = 0;
    refuse.on = false;
    vi.stubGlobal('fetch', learnerDown(lrs.fetch, refuse));
    await db.prepare('UPDATE sessions SET wp_user_id = NULL, actor_name = ?').bind(OLD_ACTOR).run();
  });
  afterEach(() => {
    enrolHealth.downUntil = 0;
    vi.restoreAllMocks();
  });

  it('answers 503 connector-unavailable and writes nothing official while no learner can be made', async () => {
    refuse.on = true;
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = await call({ completedLessons: [FIRST], files: { 'theme.json': '{}' }, current: { pathId: 'block-theme', lessonId: FIRST, beatIndex: 0 } });
    expect(res.status).toBe(503);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('connector-unavailable');
    expect((await db.prepare('SELECT COUNT(*) AS c FROM carry_overs').first<{ c: number }>())!.c).toBe(0);
    expect(await outbox()).toEqual([]);
    expect(lrs.calls).toEqual([]);
    // Not claimed: once a learner exists, the carry-over still works.
    refuse.on = false;
    enrolHealth.downUntil = 0;
    expect((await call({ completedLessons: [FIRST] })).status).toBe(200);
  });

  it('a learner adopted in the same request carries over under the ledger actor', async () => {
    const res = await call({ completedLessons: [FIRST] });
    expect(res.status).toBe(200);
    const actor = await sessionActor();
    expect(actor).toMatch(/^ledger-\d+$/);
    expect((await db.prepare('SELECT actor_name FROM carry_overs').all<{ actor_name: string }>()).results).toEqual([{ actor_name: actor }]);
    const sent = await outbox();
    expect(sent).toHaveLength(1);
    expect((sent[0].actor as { account: { name: string } }).account.name).toBe(actor);
    expect(JSON.stringify([...lrs.state.keys()])).not.toContain(OLD_ACTOR);
  });
});
