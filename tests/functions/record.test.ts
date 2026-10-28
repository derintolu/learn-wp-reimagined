import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { SERVER_FLAGS, LRS_API, LRS_XAPI } from '../../functions/_lib/config';
import { createSqliteD1 } from '../../dev/sqliteD1';
import { buildContent } from '../../scripts/build-content';
import { setContentForTests } from '../../functions/_lib/content';
import { ensureSchema } from '../../functions/_lib/db';
import type { Env } from '../../functions/_lib/env';
import { decideEvents } from '../../functions/_lib/events/decide';
import { createSession, SESSION_COOKIE } from '../../functions/_lib/session/session';
import { OFFICIAL_COURSE_ID, auIdOf, officialActor } from '../../functions/_lib/record/official';
import { enqueue, drain } from '../../functions/_lib/lrs/outbox';
import { lrsHealth } from '../../functions/_lib/record/registration';
import { GET as getRecord } from '../../functions/api/record';
import { GET as getExport } from '../../functions/api/record/export';
import { POST as postViewLink } from '../../functions/api/record/view-link';
import { ADL_VERBS, STATE_IDS, activityIds } from '../../vendor/course-xapi-mcp/core/constants';
import { fakeLrs } from '../helpers/fakeLrs';

const NOW = Date.UTC(2026, 9, 27, 12, 0, 0);
const REG = '7d3c1a2b-4e5f-4a6b-8c7d-9e0f1a2b3c4d';
const FREE = 'theme-json-basics';

let db: ReturnType<typeof createSqliteD1>;
let env: Env;
let lrs: ReturnType<typeof fakeLrs>;
let cookie: string;
let actorName: string;
let held: any[];
let lrsGets: number;
let n = 0;

const stmt = (verb: string, key: string, i: number, extra: object = {}) => ({
  id: `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`,
  actor: officialActor(actorName),
  verb: { id: verb },
  object: { objectType: 'Activity', id: activityIds.au(auIdOf(key)) },
  context: { registration: REG },
  timestamp: new Date(NOW + i).toISOString(),
  stored: new Date(NOW + i + 5).toISOString(),
  authority: { objectType: 'Agent', account: { homePage: 'https://lrs.sqwrlz.com', name: 'ck_test' } },
  ...extra,
});

const call = (h: typeof getRecord, method = 'GET', withCookie = true) =>
  h(new Request('https://learnwp.sqwrlz.com/api/record', { method, headers: withCookie ? { cookie: `${SESSION_COOKIE}=${cookie}` } : {} }), { params: {}, env });

beforeEach(async () => {
  setContentForTests(buildContent('tests/fixtures/content'));
  db = createSqliteD1();
  env = { DB: db, SESSION_KEY: 'test-session-key-not-a-secret', LRS_KEY: 'ck_test', LRS_SECRET: 'cs_test' };
  await ensureSchema(db);
  const made = await createSession(env, NOW);
  cookie = made.cookie.split(';')[0].split('=')[1];
  actorName = made.session.actorName;
  lrs = fakeLrs();
  held = [];
  lrsGets = 0;
  n = 0;
  lrs.state.set([OFFICIAL_COURSE_ID, JSON.stringify(officialActor(actorName)), '', STATE_IDS.registration].join('|'), { registration: REG });
  lrs.state.set([OFFICIAL_COURSE_ID, JSON.stringify(officialActor(actorName)), REG, STATE_IDS.learner].join('|'), { files: { 'style.css': 'a{}' }, other: 1 });
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    if (url.startsWith(`${LRS_XAPI}/statements?`) && method === 'GET') {
      lrsGets++;
      const u = new URL(url);
      const page = u.searchParams.get('page') ? 1 : 0;
      const half = Math.ceil(held.length / 2);
      const body = held.length > 1 ? (page === 0 ? { statements: held.slice(0, half), more: '/wp-json/learning-ledger/xapi/statements?page=2' } : { statements: held.slice(half) }) : { statements: held };
      return new Response(JSON.stringify(body), { status: 200 });
    }
    if (url.startsWith(`${LRS_API}/badges?`)) return new Response(JSON.stringify([{ id: 'b1', achievement: { id: 'a', name: 'Block theme', image: null }, status: 'issued', created_at: 'x' }]), { status: 200 });
    if (url === `${LRS_API}/view-links` && method === 'POST') return new Response(JSON.stringify({ url: 'https://lrs.sqwrlz.com/view/abc' }), { status: 201 });
    if (url === `${LRS_XAPI}/statements` && method === 'POST') held.push(...JSON.parse(String(init?.body)));
    return lrs.fetch(input, init);
  });
  lrsHealth.downUntil = 0;
  SERVER_FLAGS.officialRecord = true;
});
afterEach(() => {
  SERVER_FLAGS.officialRecord = false;
  SERVER_FLAGS.lrsShadow = false;
  vi.unstubAllGlobals();
});

describe('official record routes', () => {
  it('no session → 401', async () => {
    for (const [h, m] of [[getRecord, 'GET'], [getExport, 'GET'], [postViewLink, 'POST']] as const) {
      expect((await call(h, m, false)).status).toBe(401);
    }
    expect(lrsGets).toBe(0);
  });

  it('flag off → 404 and the LRS is never called', async () => {
    SERVER_FLAGS.officialRecord = false;
    for (const [h, m] of [[getRecord, 'GET'], [getExport, 'GET'], [postViewLink, 'POST']] as const) {
      expect((await call(h, m)).status).toBe(404);
    }
    expect(lrs.calls).toEqual([]);
  });

  it('projects the record across LRS pages, with badges', async () => {
    held = [stmt(ADL_VERBS.waived, FREE, 1, { result: { extensions: { 'https://w3id.org/xapi/cmi5/result/extensions/reason': 'Tested Out' } } }), stmt(ADL_VERBS.completed, FREE, 2)];
    const res = await call(getRecord);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.completed).toEqual([FREE]);
    expect(body.testedOut).toEqual([]);
    expect(body.badges).toHaveLength(1);
    expect(lrsGets).toBe(2);
  });

  it('record is cached until the next event', async () => {
    held = [stmt(ADL_VERBS.completed, FREE, 1)];
    expect((await (await call(getRecord)).json()).completed).toEqual([FREE]);
    held = [];
    expect((await (await call(getRecord)).json()).completed).toEqual([FREE]);
    expect(lrsGets).toBe(1);

    await decideEvents(env, actorName, [{ eventId: 'evt-00000001', type: 'lessonOpened', lessonId: FREE } as any], NOW + 10);
    expect((await (await call(getRecord)).json()).completed).toEqual([]);
    expect(lrsGets).toBe(2);
  });

  it('an event for another actor leaves the cache alone', async () => {
    held = [stmt(ADL_VERBS.completed, FREE, 1)];
    await call(getRecord);
    await decideEvents(env, 'someone-else', [{ eventId: 'evt-00000002', type: 'lessonOpened', lessonId: FREE } as any], NOW + 10);
    held = [];
    expect((await (await call(getRecord)).json()).completed).toEqual([FREE]);
  });

  it('export carries stored and authority, is labelled a copy, and includes State files', async () => {
    held = [stmt(ADL_VERBS.completed, FREE, 1)];
    const res = await call(getExport);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-disposition')).toBe('attachment; filename="learn-wp-reimagined-record.json"');
    const body = await res.json();
    expect(body.copy).toBe(true);
    expect(body.label).toMatch(/copy/);
    expect(body.record.statements).toHaveLength(1);
    expect(body.record.statements[0].stored).toBeTruthy();
    expect(body.record.statements[0].authority.account.name).toBe('ck_test');
    expect(body.files).toEqual({ 'style.css': 'a{}' });
  });

  it("export includes the studio's files (lwr-files), merged with the agent's, the studio's edit winning", async () => {
    held = [];
    const key = (stateId: string) => [OFFICIAL_COURSE_ID, JSON.stringify(officialActor(actorName)), REG, stateId].join('|');
    lrs.state.set(key('lwr-files'), { files: { 'style.css': 'a{color:red}', 'theme.json': '{}' }, times: { 'style.css': '2026-10-28T10:00:00.000Z' } });
    const body = await (await call(getExport)).json();
    expect(body.files).toEqual({ 'style.css': 'a{color:red}', 'theme.json': '{}' });
    // A learner who only used the studio has no engine document: their files are still exported.
    lrs.state.delete(key(STATE_IDS.learner));
    expect((await (await call(getExport)).json()).files).toEqual({ 'style.css': 'a{color:red}', 'theme.json': '{}' });
  });

  it('view-link returns the LRS url', async () => {
    const res = await call(postViewLink, 'POST');
    expect(await res.json()).toEqual({ url: 'https://lrs.sqwrlz.com/view/abc' });
  });

  it('an LRS outage answers 503', async () => {
    lrs.state.clear();
    lrs.down = true;
    vi.stubGlobal('fetch', lrs.fetch);
    expect((await call(getRecord)).status).toBe(503);
  });

  it('a record read before the drain shows the statement once the drain stores it', async () => {
    await call(getRecord); // fills the cache with nothing completed
    await enqueue(env, [stmt(ADL_VERBS.completed, FREE, 1) as any], NOW);
    expect((await (await call(getRecord)).json()).completed).toEqual([]);
    await drain(env, NOW, 5000);
    expect((await (await call(getRecord)).json()).completed).toEqual([FREE]);
  });

  it('a cached record expires after the TTL', async () => {
    const now = vi.spyOn(Date, 'now');
    now.mockReturnValue(NOW);
    held = [];
    await call(getRecord);
    held = [stmt(ADL_VERBS.completed, FREE, 1)];
    now.mockReturnValue(NOW + 30_000);
    expect((await (await call(getRecord)).json()).completed).toEqual([]);
    now.mockReturnValue(NOW + 61_000);
    expect((await (await call(getRecord)).json()).completed).toEqual([FREE]);
    now.mockRestore();
  });
});
