import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { XAPI_BASE } from '../../src/shared/xapi';
import { SERVER_FLAGS } from '../../functions/_lib/config';
import { createSqliteD1 } from '../../dev/sqliteD1';
import { ensureSchema } from '../../functions/_lib/db';
import type { Env } from '../../functions/_lib/env';
import { POST as create } from '../../functions/api/session';
import { GET as sensei } from '../../functions/api/sensei';
import { SESSION_COOKIE } from '../../functions/_lib/session/session';
import { lessonKeyBySenseiId } from '../../functions/_lib/ledger/lesson-ids';

const SEED_HEX = '9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60';
const SIGNING = Buffer.from('302e020100300506032b657004220420' + SEED_HEX, 'hex').toString('base64');
let db: ReturnType<typeof createSqliteD1>;
let env: Env;
let urls: string[];

const learner = () =>
  new Response(JSON.stringify({ user_id: 77, actor: { objectType: 'Agent', account: { homePage: XAPI_BASE, name: 'a1' } } }), { status: 201 });
const progress = () =>
  new Response(
    JSON.stringify({ courses: [{ course: 13, completed: [101, 102, 999], tested_out: [103], course_completed: false, certificate: null }] }),
    { status: 200 },
  );

async function cookie(): Promise<string> {
  const res = await create(new Request('http://x/api/session', { method: 'POST', headers: { 'cf-connecting-ip': '10.0.0.1' } }), { params: {}, env });
  return res.headers.get('set-cookie')!.split(';')[0];
}
const get = (c?: string) => sensei(new Request('http://x/api/sensei', { headers: c ? { cookie: c } : {} }), { params: {}, env });

beforeEach(async () => {
  db = createSqliteD1();
  await ensureSchema(db);
  SERVER_FLAGS.senseiLearners = true;
  env = {
    DB: db,
    SESSION_KEY: 'k',
    CONNECTOR_SIGNING_KEY: SIGNING,
    CONNECTOR_KEY_ID: 'kid1',
    SENSEI_COURSE_IDS: '{"block-theme":13}',
    SENSEI_LESSON_IDS: '{"one":101,"two":102,"three":103}',
    LEDGER_PROGRAM_ID: '5',
  };
  urls = [];
  vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
    urls.push(url);
    return init.method === 'POST' ? learner() : progress();
  });
});
afterEach(() => {
  SERVER_FLAGS.senseiLearners = false;
  vi.unstubAllGlobals();
});

describe('GET /api/sensei', () => {
  it('returns the learner progress with lessons mapped to studio ids', async () => {
    const c = await cookie();
    const res = await get(c);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      enrolled: ['block-theme'],
      completedLessons: ['one', 'two'],
      testedOutLessons: ['three'],
      completedCourses: [],
      certificates: [],
      certificateDownload: false,
    });
    expect(urls.at(-1)).toContain('/learners/77/progress?program=5');
  });

  it('connector down gives 503 connector-unavailable', async () => {
    const c = await cookie();
    vi.stubGlobal('fetch', async () => new Response('x', { status: 503 }));
    const res = await get(c);
    expect(res.status).toBe(503);
    expect(((await res.json()) as any).error.code).toBe('connector-unavailable');
  });

  it('flag off answers 404 and never calls the connector', async () => {
    const c = await cookie();
    SERVER_FLAGS.senseiLearners = false;
    const n = urls.length;
    expect((await get(c)).status).toBe(404);
    expect(urls.length).toBe(n);
  });

  it('no session gives 401', async () => {
    expect((await get()).status).toBe(401);
    expect((await get(`${SESSION_COOKIE}=nope`)).status).toBe(401);
  });

  it('without a program id configured gives 503 disabled', async () => {
    const c = await cookie();
    delete env.LEDGER_PROGRAM_ID;
    const res = await get(c);
    expect(res.status).toBe(503);
    expect(((await res.json()) as any).error.code).toBe('disabled');
  });
});

describe('lessonKeyBySenseiId', () => {
  it('inverts the configured map and tolerates bad JSON', () => {
    expect(lessonKeyBySenseiId({ SENSEI_LESSON_IDS: '{"a":1,"b":"x"}' } as Env)).toEqual({ '1': 'a' });
    expect(lessonKeyBySenseiId({ SENSEI_LESSON_IDS: 'nope' } as Env)).toEqual({});
    expect(lessonKeyBySenseiId({} as Env)).toEqual({});
  });
});
