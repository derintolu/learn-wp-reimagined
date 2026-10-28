import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createSqliteD1 } from '../../dev/sqliteD1';
import { buildContent } from '../../scripts/build-content';
import { setContentForTests } from '../../functions/_lib/content';
import { ensureSchema } from '../../functions/_lib/db';
import type { Env } from '../../functions/_lib/env';
import { recordShadowFact } from '../../functions/_lib/record/shadow';
import { auIdOf } from '../../functions/_lib/record/official';
import { GET, factsFromStatements } from '../../functions/api/admin/shadow';
import { LRS_XAPI } from '../../functions/_lib/config';
import { ADL_VERBS, CMI5, activityIds } from '../../vendor/course-xapi-mcp/core/constants';

const NOW = Date.UTC(2026, 9, 27, 12, 0, 0);
const DAY = '2026-10-27';
const LESSON = 'theme-json-basics';

let env: Env;
let lrsStatements: unknown[];

const completed = (lessonId: string, timestamp = `${DAY}T12:00:00.000Z`) => ({
  id: crypto.randomUUID(),
  actor: { objectType: 'Agent', account: { homePage: 'https://learnwp.sqwrlz.com', name: 'a1' } },
  verb: { id: ADL_VERBS.completed },
  object: { objectType: 'Activity', id: activityIds.au(auIdOf(lessonId)) },
  context: { contextActivities: { category: [{ id: CMI5.categoryCmi5 }] } },
  timestamp,
});

const call = (token: string | undefined, header?: string, day: string | null = DAY) =>
  GET(new Request(`http://x/api/admin/shadow${day ? `?day=${day}` : ''}`, { headers: header ? { authorization: header } : {} }), {
    params: {},
    env: { ...env, ADMIN_TOKEN: token },
  });

beforeEach(async () => {
  setContentForTests(buildContent('tests/fixtures/content'));
  const db = createSqliteD1();
  await ensureSchema(db);
  env = { DB: db, LRS_KEY: 'ck_test', LRS_SECRET: 'cs_test' } as Env;
  lrsStatements = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      expect(String(url).startsWith(`${LRS_XAPI}/statements?`)).toBe(true);
      return new Response(JSON.stringify({ statements: lrsStatements }), { status: 200 });
    }),
  );
});
afterEach(() => vi.unstubAllGlobals());

describe('GET /api/admin/shadow', () => {
  it('401 without the admin token', async () => {
    expect((await call('secret')).status).toBe(401);
    expect((await call('secret', 'Bearer wrong')).status).toBe(401);
    expect((await call(undefined, 'Bearer ')).status).toBe(401);
  });

  it('400 without a valid day', async () => {
    expect((await call('secret', 'Bearer secret', null)).status).toBe(400);
    expect((await call('secret', 'Bearer secret', '27-10-2026')).status).toBe(400);
  });

  it('zero diffs when the LRS holds every fact', async () => {
    await recordShadowFact(env, 'a1', { lessonId: LESSON, kind: 'completed' }, NOW);
    lrsStatements = [completed(LESSON)];
    const res = await call('secret', 'Bearer secret');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ day: DAY, actors: 1, diffs: [] });
  });

  it('reports a fact missing in the LRS', async () => {
    await recordShadowFact(env, 'a1', { lessonId: LESSON, kind: 'completed' }, NOW);
    const body = await (await call('secret', 'Bearer secret')).json();
    expect(body).toEqual({
      day: DAY,
      actors: 1,
      diffs: [{ actor: 'a1', missingInLrs: [{ lessonId: LESSON, kind: 'completed' }], extraInLrs: [] }],
    });
  });

  it('reports a fact the LRS holds that the server never recorded, and ignores other days', async () => {
    await recordShadowFact(env, 'a1', { lessonId: LESSON, kind: 'waived' }, NOW);
    lrsStatements = [completed(LESSON), completed(LESSON, '2026-10-28T00:00:01.000Z')];
    const body = (await (await call('secret', 'Bearer secret')).json()) as { diffs: unknown[] };
    expect(body.diffs).toEqual([
      { actor: 'a1', missingInLrs: [{ lessonId: LESSON, kind: 'waived' }], extraInLrs: [{ lessonId: LESSON, kind: 'completed' }] },
    ]);
  });

  it('502 when the LRS is unavailable', async () => {
    await recordShadowFact(env, 'a1', { lessonId: LESSON, kind: 'completed' }, NOW);
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 503 })));
    expect((await call('secret', 'Bearer secret')).status).toBe(502);
  });
});

describe('factsFromStatements', () => {
  it('reads facts back from statements', () => {
    expect(factsFromStatements([completed(LESSON) as never])).toEqual([{ lessonId: LESSON, kind: 'completed' }]);
  });
});
