import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { SERVER_FLAGS } from '../../functions/_lib/config';
import { createSqliteD1 } from '../../dev/sqliteD1';
import { buildContent } from '../../scripts/build-content';
import { getContent, setContentForTests } from '../../functions/_lib/content';
import { ensureSchema } from '../../functions/_lib/db';
import type { Env } from '../../functions/_lib/env';
import { decideEvents } from '../../functions/_lib/events/decide';
import { deriveStatementId } from '../../functions/_lib/events/ids';
import { createSession, type Session } from '../../functions/_lib/session/session';
import { OFFICIAL_COURSE_ID, OFFICIAL_ID_OFFSET, auIdOf, buildOfficial, officialActor, type AuSession } from '../../functions/_lib/record/official';
import { getRegistration, lrsHealth } from '../../functions/_lib/record/registration';
import { listShadowFacts } from '../../functions/_lib/record/shadow';
import { importCourseOnNewVersion } from '../../functions/_lib/lrs/import';
import { parseEvents, type EventResult, type ServerEvent } from '../../src/shared/events';
import { EXT_CHOSEN_BY, XAPI_BASE } from '../../src/shared/xapi';
import type { ContentBundle } from '../../src/shared/types';
import { ADL_VERBS, CMI5, CXM_EXT, STATE_IDS, activityIds } from '../../vendor/course-xapi-mcp/core/constants';
import { checkProfile } from '../../vendor/course-xapi-mcp/core/xapi/profile-check';
import type { XapiStatement } from '../../vendor/course-xapi-mcp/core/xapi/types';
import { fakeLrs } from '../helpers/fakeLrs';

const NOW = Date.UTC(2026, 9, 27, 12, 0, 0);
const DAY = '2026-10-27';
const REG = '7d3c1a2b-4e5f-4a6b-8c7d-9e0f1a2b3c4d';
const SESSION = '0a1b2c3d-4e5f-4061-8728-394a5b6c7d8e';
const FREE = 'theme-json-basics';

let db: ReturnType<typeof createSqliteD1>;
let env: Env;
let lrs: ReturnType<typeof fakeLrs>;
let n = 0;
const eid = () => `evt-${String(++n).padStart(8, '0')}`;

const au = (auKey: string, over: Partial<AuSession> = {}): AuSession => ({ auKey, sessionId: SESSION, started: NOW - 60_000, last: NOW, isNew: false, ...over });
const ctx = (auKey: string, over: Partial<AuSession> = {}, bundle: ContentBundle = getContent()) => ({
  actor: officialActor('a1'),
  registration: REG,
  bundle,
  auSession: au(auKey, over),
});
const ok = (e: ServerEvent, extra: object = {}) => ({ eventId: e.eventId, ok: true as const, statements: [], ...extra });
const isDefined = (s: XapiStatement) => (s.context.contextActivities?.category ?? []).some((c) => c.id === CMI5.categoryCmi5);
const verbOf = (s: XapiStatement) => Object.entries(ADL_VERBS).find(([, iri]) => iri === s.verb.id)?.[0] ?? s.verb.id.split('/').pop();
const answer = (lessonId: string, outcome: 'advance' | 'review' | 'skip'): ServerEvent => ({ eventId: eid(), type: 'checkpointAnswered', lessonId, response: 'my answer', outcome });
const expectConformant = (list: XapiStatement[]) => {
  for (const s of list) expect(checkProfile(s, { lmsActor: true }), `${verbOf(s)} ${s.object.id}`).toEqual([]);
};

const decide = (session: Session | null, evs: unknown[], now = NOW) => {
  const p = parseEvents({ learnerId: '3f2b8c1e-5d4a-4e6f-8a9b-0c1d2e3f4a5b', events: evs });
  if (!p.ok) throw new Error(p.error);
  return decideEvents(env, session?.actorName ?? p.learnerId, p.events, now, { session });
};
const outbox = async () =>
  (await db.prepare('SELECT statement_id, body FROM lrs_outbox ORDER BY created, statement_id').all<{ statement_id: string; body: string }>()).results.map(
    (r) => JSON.parse(r.body) as XapiStatement,
  );

beforeEach(async () => {
  setContentForTests(buildContent('tests/fixtures/content'));
  db = createSqliteD1();
  env = { DB: db, SESSION_KEY: 'test-session-key-not-a-secret', LRS_KEY: 'ck_test', LRS_SECRET: 'cs_test' };
  await ensureSchema(db);
  lrs = fakeLrs();
  vi.stubGlobal('fetch', lrs.fetch);
  lrsHealth.downUntil = 0;
});
afterEach(() => {
  SERVER_FLAGS.lrsShadow = false;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('buildOfficial', () => {
  it('placement skip emits one waived Tested Out per skipped lesson', async () => {
    const e: ServerEvent = {
      eventId: eid(),
      type: 'placed',
      placement: { pathId: 'block-theme', startLessonId: 'patterns', skip: ['theme-json-basics', 'templates-and-parts'], reason: 'Knows theme.json already.' },
    };
    const s = await buildOfficial(ctx('placement', { isNew: true }), e, ok(e));
    expect(s.map(verbOf)).toEqual(['launched', 'initialized', 'placed', 'terminated', 'waived', 'waived']);
    const waived = s.filter((x) => verbOf(x) === 'waived');
    expect(waived.map((w) => w.object.id)).toEqual([activityIds.au(auIdOf('theme-json-basics')), activityIds.au(auIdOf('templates-and-parts'))]);
    for (const w of waived) {
      expect(w.result?.extensions?.[CMI5.extReason]).toBe('Tested Out');
      expect(w.context.extensions?.[CMI5.extSessionId]).not.toBe(SESSION);
    }
    const placed = s.find((x) => verbOf(x) === 'placed')!;
    expect(placed.result?.extensions?.[CXM_EXT['start-lesson']]).toBe(auIdOf('patterns'));
    expectConformant(s);
  });

  it('a skip branch waives every jumped lesson', async () => {
    const bundle = structuredClone(getContent());
    bundle.lessons[FREE].checkpoint!.branches.find((b) => b.outcome === 'skip')!.to = 'patterns';
    const e = answer(FREE, 'skip');
    const s = await buildOfficial(ctx(FREE, {}, bundle), e, ok(e, { outcome: 'skip', to: 'patterns', passed: true, chosenBy: 'judge' }));
    expect(s.filter((x) => verbOf(x) === 'waived').map((w) => w.object.id)).toEqual([activityIds.au(auIdOf('templates-and-parts'))]);
    expect(s.filter(isDefined).map(verbOf)).toEqual(['passed', 'waived']);
    expectConformant(s);

    const next = answer(FREE, 'advance');
    const adv = await buildOfficial(ctx(FREE), next, ok(next, { outcome: 'advance', to: 'templates-and-parts', passed: true, chosenBy: 'judge' }));
    expect(adv.filter((x) => verbOf(x) === 'waived')).toEqual([]);
  });

  it('review marks nothing', async () => {
    const e = answer(FREE, 'review');
    const s = await buildOfficial(ctx(FREE), e, ok(e, { outcome: 'review', to: FREE, passed: false, chosenBy: 'learner' }));
    expect(s.filter(isDefined)).toEqual([]);
    expect(s.map(verbOf)).toEqual(['answered', 'failed', 'branched']);
    expectConformant(s);
  });

  it('learner-chosen fallback carries the marker', async () => {
    const e = answer(FREE, 'advance');
    const r = ok(e, { outcome: 'advance', to: 'templates-and-parts', passed: true });
    const learner = await buildOfficial(ctx(FREE), e, { ...r, chosenBy: 'learner' });
    const judge = await buildOfficial(ctx(FREE), e, { ...r, chosenBy: 'judge' });
    const branched = (l: XapiStatement[]) => l.find((x) => verbOf(x) === 'branched')!;
    expect(branched(learner).result?.extensions?.[EXT_CHOSEN_BY]).toBe('learner');
    expect(branched(judge).result?.extensions?.[EXT_CHOSEN_BY]).toBeUndefined();
    expect(branched(learner).result?.extensions?.[CXM_EXT.to]).toBe(auIdOf('templates-and-parts'));
  });

  it('activity ids are {au@id}/au', async () => {
    expect(auIdOf(FREE)).toBe(`${XAPI_BASE}/activities/lessons/${FREE}`);
    expect(OFFICIAL_COURSE_ID).toBe(`${XAPI_BASE}/activities/course`);
    const opened: ServerEvent = { eventId: eid(), type: 'lessonOpened', lessonId: FREE };
    const beat: ServerEvent = { eventId: eid(), type: 'beatViewed', lessonId: FREE, beatIndex: 0 };
    const done: ServerEvent = { eventId: eid(), type: 'lessonCompleted', lessonId: FREE };
    const all = [
      ...(await buildOfficial(ctx(FREE, { isNew: true }), opened, ok(opened))),
      ...(await buildOfficial(ctx(FREE), beat, ok(beat))),
      ...(await buildOfficial(ctx(FREE), done, ok(done))),
    ];
    expect(all.map(verbOf)).toEqual(['launched', 'initialized', 'experienced', 'completed']);
    const auActivity = `${XAPI_BASE}/activities/lessons/${FREE}/au`;
    for (const s of all) {
      if (isDefined(s)) expect(s.object.id).toBe(auActivity);
      else expect(s.context.contextActivities?.parent?.[0].id).toBe(auActivity);
      expect(s.context.registration).toBe(REG);
      expect(s.actor).toEqual({ objectType: 'Agent', account: { homePage: XAPI_BASE, name: 'a1' } });
    }
    expectConformant(all);
  });

  it('ids derive from the eventId past the phase 1 ids, so a rebuild gives the same ids', async () => {
    const e: ServerEvent = { eventId: eid(), type: 'lessonCompleted', lessonId: FREE };
    const [a] = await buildOfficial(ctx(FREE), e, ok(e));
    const [b] = await buildOfficial(ctx(FREE), e, ok(e));
    expect(a.id).toBe(b.id);
    const phase1 = await Promise.all([0, 1, 2, 3].map((i) => deriveStatementId(e.eventId, i)));
    expect(phase1).not.toContain(a.id);
    const official = await Promise.all(Array.from({ length: 20 }, (_, i) => deriveStatementId(e.eventId, OFFICIAL_ID_OFFSET + i)));
    expect(official).toContain(a.id);
  });
});

describe('registration', () => {
  it('is minted once, kept in the State document the standard names, and cached on the session', async () => {
    const { session } = await createSession(env, NOW);
    const r1 = await getRegistration(env, session);
    expect(r1).toMatch(/^[0-9a-f-]{36}$/);
    const key = [OFFICIAL_COURSE_ID, JSON.stringify(officialActor(session.actorName)), '', STATE_IDS.registration].join('|');
    expect(lrs.state.get(key)).toEqual({ registration: r1 });
    const calls = lrs.calls.length;
    expect(await getRegistration(env, session)).toBe(r1);
    expect(lrs.calls.length).toBe(calls);
  });

  it('reuses the registration the LRS already holds for the learner', async () => {
    const { session } = await createSession(env, NOW);
    const key = [OFFICIAL_COURSE_ID, JSON.stringify(officialActor(session.actorName)), '', STATE_IDS.registration].join('|');
    lrs.state.set(key, { registration: REG });
    expect(await getRegistration(env, session)).toBe(REG);
  });
});

describe('decide with the LRS in shadow', () => {
  it('flag off: no outbox, no shadow facts, no LRS calls', async () => {
    const { session } = await createSession(env, NOW);
    const [r] = (await decide(session, [{ eventId: eid(), type: 'lessonCompleted', lessonId: FREE }])) as any[];
    expect(r.ok).toBe(true);
    expect(lrs.calls).toEqual([]);
    const tables = await db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('lrs_outbox', 'shadow_facts')").all();
    expect(tables.results).toEqual([]);
  });

  it('builds, queues and records the official statements, and the studio still gets phase 1', async () => {
    SERVER_FLAGS.lrsShadow = true;
    const { session } = await createSession(env, NOW);
    const [opened, completed] = (await decide(session, [
      { eventId: eid(), type: 'lessonOpened', lessonId: FREE },
      { eventId: eid(), type: 'lessonCompleted', lessonId: FREE },
    ])) as any[];
    expect(opened).toMatchObject({ ok: true, statements: [] });
    expect(completed.statements).toHaveLength(1);
    const queued = await outbox();
    expect(queued.map(verbOf)).toEqual(['launched', 'initialized', 'completed']);
    expect(queued.every((s) => s.context.registration === queued[0].context.registration)).toBe(true);
    expect(await listShadowFacts(env, DAY)).toEqual([{ actor: session.actorName, facts: [{ lessonId: FREE, kind: 'completed' }] }]);
  });

  it('the same event twice gives one set of official statements', async () => {
    SERVER_FLAGS.lrsShadow = true;
    const { session } = await createSession(env, NOW);
    const ev = { eventId: eid(), type: 'checkpointAnswered', lessonId: FREE, response: 'my answer', outcome: 'advance' };
    await decide(session, [ev]);
    const first = await outbox();
    await decide(session, [ev], NOW + 5_000);
    const second = await outbox();
    expect(second.map((s) => s.id)).toEqual(first.map((s) => s.id));
    expect(second).toEqual(first);
    expect(first.map(verbOf)).toEqual(['launched', 'initialized', 'answered', 'passed', 'branched', 'passed']);
  });

  it('a second lessonCompleted for the same lesson sends no second completed', async () => {
    SERVER_FLAGS.lrsShadow = true;
    const { session } = await createSession(env, NOW);
    await decide(session, [{ eventId: eid(), type: 'lessonCompleted', lessonId: FREE }]);
    await decide(session, [{ eventId: eid(), type: 'lessonCompleted', lessonId: FREE }], NOW + 1_000);
    expect((await outbox()).filter((s) => verbOf(s) === 'completed')).toHaveLength(1);
  });

  it('opening another lesson terminates the open session; lessonLeft terminates its own', async () => {
    SERVER_FLAGS.lrsShadow = true;
    const { session } = await createSession(env, NOW);
    await decide(session, [
      { eventId: eid(), type: 'lessonOpened', lessonId: FREE },
      { eventId: eid(), type: 'lessonOpened', lessonId: 'templates-and-parts' },
      { eventId: eid(), type: 'lessonLeft', lessonId: 'templates-and-parts' },
      { eventId: eid(), type: 'lessonLeft', lessonId: 'templates-and-parts' },
    ]);
    const q = await outbox();
    expect(q.map(verbOf)).toEqual(['launched', 'initialized', 'terminated', 'launched', 'initialized', 'terminated']);
    expect(q[2].object.id).toBe(activityIds.au(auIdOf(FREE)));
    expect(q[5].object.id).toBe(activityIds.au(auIdOf('templates-and-parts')));
    expect((await db.prepare('SELECT COUNT(*) AS c FROM au_sessions').first<{ c: number }>())!.c).toBe(0);
  });

  it('records shadow facts for placement, waivers, branches and caught bugs', async () => {
    SERVER_FLAGS.lrsShadow = true;
    const { session } = await createSession(env, NOW);
    await decide(session, [
      { eventId: eid(), type: 'placed', placement: { pathId: 'block-theme', startLessonId: 'templates-and-parts', skip: [FREE], reason: 'Knows theme.json.' } },
      { eventId: eid(), type: 'checkpointAnswered', lessonId: 'templates-and-parts', response: 'r', outcome: 'review' },
      { eventId: eid(), type: 'codeSubmitted', lessonId: 'patterns', target: 'bug', file: 'patterns/hero.php', files: { 'patterns/hero.php': 'Slug: theme/hero' } },
    ]);
    const [{ facts }] = await listShadowFacts(env, DAY);
    expect(facts).toEqual(
      expect.arrayContaining([
        { lessonId: 'templates-and-parts', kind: 'placed' },
        { lessonId: FREE, kind: 'waived' },
        { lessonId: 'templates-and-parts', kind: 'branched' },
        { lessonId: 'patterns', kind: 'caught' },
      ]),
    );
    expect(facts).toHaveLength(4);
    expectConformant(await outbox());
  });

  it('with Sensei enrolment on too: both run, and a slow enrolment does not eat the shadow budget', async () => {
    SERVER_FLAGS.lrsShadow = true;
    const { session } = await createSession(env, NOW);
    SERVER_FLAGS.senseiLearners = true;
    try {
      const enrol = vi.fn(() => new Promise<void>((resolve) => setTimeout(resolve, 900)));
      const p = parseEvents({ learnerId: '3f2b8c1e-5d4a-4e6f-8a9b-0c1d2e3f4a5b', events: [{ eventId: eid(), type: 'lessonCompleted', lessonId: FREE }] });
      if (!p.ok) throw new Error(p.error);
      const [r] = await decideEvents(env, session.actorName, p.events, NOW, { wpUserId: 9, connector: { enrol } as any, session });
      expect(r.ok).toBe(true);
      expect(enrol).toHaveBeenCalledWith(9, 'block-theme');
      expect((await outbox()).map(verbOf)).toEqual(['launched', 'initialized', 'completed']);
    } finally {
      SERVER_FLAGS.senseiLearners = false;
    }
  });

  it('no session: nothing official is recorded', async () => {
    SERVER_FLAGS.lrsShadow = true;
    const [r] = (await decide(null, [{ eventId: eid(), type: 'lessonCompleted', lessonId: FREE }])) as any[];
    expect(r.ok).toBe(true);
    expect(lrs.calls).toEqual([]);
  });

  it('an unreachable LRS with no known registration still answers the event, and is not asked again at once', async () => {
    SERVER_FLAGS.lrsShadow = true;
    lrs.down = true;
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { session } = await createSession(env, NOW);
    const [r] = (await decide(session, [{ eventId: eid(), type: 'lessonCompleted', lessonId: FREE }])) as EventResult[];
    expect(r.ok).toBe(true);
    const calls = lrs.calls.length;
    expect(calls).toBeGreaterThan(0);
    await decide(session, [{ eventId: eid(), type: 'lessonCompleted', lessonId: FREE }]);
    expect(lrs.calls.length).toBe(calls);
    expect(await outbox()).toEqual([]);
    expect(log).not.toHaveBeenCalled();
  });

  it('a placement never waives a lesson already satisfied', async () => {
    SERVER_FLAGS.lrsShadow = true;
    const { session } = await createSession(env, NOW);
    await decide(session, [
      { eventId: eid(), type: 'checkpointAnswered', lessonId: FREE, response: 'r', outcome: 'advance' },
      { eventId: eid(), type: 'lessonCompleted', lessonId: FREE },
      { eventId: eid(), type: 'placed', placement: { pathId: 'block-theme', startLessonId: 'patterns', skip: [FREE, 'templates-and-parts'], reason: 'Knows it.' } },
    ]);
    const waived = (await outbox()).filter((s) => verbOf(s) === 'waived').map((s) => s.object.id);
    expect(waived).toEqual([activityIds.au(auIdOf('templates-and-parts'))]);
  });

  it('a skip branch never waives a jumped lesson already satisfied', async () => {
    SERVER_FLAGS.lrsShadow = true;
    getContent().lessons[FREE].checkpoint!.branches.find((b) => b.outcome === 'skip')!.to = 'patterns';
    const { session } = await createSession(env, NOW);
    const decisionId = crypto.randomUUID();
    await db.prepare('INSERT INTO decisions (id, lesson_id, outcome, created, used) VALUES (?, ?, ?, ?, 0)').bind(decisionId, FREE, 'skip', NOW).run();
    const good = { 'theme.json': '{"version":3,"settings":{"color":{"palette":[{"slug":"a"}]}}}' };
    await decide(session, [
      { eventId: eid(), type: 'checkpointAnswered', lessonId: 'templates-and-parts', response: 'r', outcome: 'advance', files: good },
      { eventId: eid(), type: 'lessonCompleted', lessonId: 'templates-and-parts' },
      { eventId: eid(), type: 'checkpointAnswered', lessonId: FREE, response: 'r', outcome: 'skip', decisionId },
    ]);
    const q = await outbox();
    expect(q.filter((s) => verbOf(s) === 'branched')).toHaveLength(2);
    expect(q.filter((s) => verbOf(s) === 'waived')).toEqual([]);
  });

  it('a lesson completed but not yet passed is still waived, as the standard does', async () => {
    SERVER_FLAGS.lrsShadow = true;
    const { session } = await createSession(env, NOW);
    await decide(session, [
      { eventId: eid(), type: 'lessonCompleted', lessonId: FREE },
      { eventId: eid(), type: 'placed', placement: { pathId: 'block-theme', startLessonId: 'templates-and-parts', skip: [FREE], reason: 'Knows it.' } },
    ]);
    expect((await outbox()).filter((s) => verbOf(s) === 'waived').map((s) => s.object.id)).toEqual([activityIds.au(auIdOf(FREE))]);
  });
});

describe('importCourseOnNewVersion', () => {
  it('a new course version is imported into the LRS once', async () => {
    SERVER_FLAGS.lrsShadow = true;
    const v1 = new Uint8Array([1, 2, 3]);
    const v2 = new Uint8Array([4, 5]);
    await importCourseOnNewVersion(env, v1, '"1-2-3"');
    await importCourseOnNewVersion(env, v1, '"1-2-3"');
    expect(lrs.imports).toEqual(['"1-2-3"']);
    await importCourseOnNewVersion(env, v2, '"4-5"');
    expect(lrs.imports).toEqual(['"1-2-3"', '"4-5"']);
  });

  it('does nothing with the flag off', async () => {
    await importCourseOnNewVersion(env, new Uint8Array([1]), '"1"');
    expect(lrs.calls).toEqual([]);
  });
});
