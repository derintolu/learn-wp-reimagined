import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { SERVER_FLAGS } from '../../functions/_lib/config';
import { getContent } from '../../functions/_lib/content';
import { createSqliteD1 } from '../../dev/sqliteD1';
import { buildContent } from '../../scripts/build-content';
import { setContentForTests } from '../../functions/_lib/content';
import { ensureSchema } from '../../functions/_lib/db';
import type { Env } from '../../functions/_lib/env';
import { POST as events } from '../../functions/api/events';
import { decideEvents } from '../../functions/_lib/events/decide';
import { ConnectorError, ConnectorUnavailable } from '../../functions/_lib/ledger/connector';
import { ENROL_RETRY_MS, enrolHealth } from '../../functions/_lib/session/enrol';
import { deriveStatementId } from '../../functions/_lib/events/ids';
import { EVENTS_MAX, EVENTS_MAX_BYTES, parseEvents } from '../../src/shared/events';
import { EXT_CHOSEN_BY } from '../../src/shared/xapi';

const LEARNER = '3f2b8c1e-5d4a-4e6f-8a9b-0c1d2e3f4a5b';
const FREE = 'theme-json-basics'; // free-text; fallback: advance, review
const CODE = 'templates-and-parts'; // code checkpoint; checks: version 3 + "slug"
const GOOD = { 'theme.json': '{"version":3,"settings":{"color":{"palette":[{"slug":"a"}]}}}' };
const BAD = { 'theme.json': '{"version":2}' };

let db: ReturnType<typeof createSqliteD1>;
let env: Env;
let n = 0;
const eid = () => `evt-${String(++n).padStart(8, '0')}`;
const NOW = Date.UTC(2026, 9, 27, 12, 0, 0);

const decide = (evs: unknown[], now = NOW) => {
  const p = parseEvents({ learnerId: LEARNER, events: evs });
  if (!p.ok) throw new Error(p.error);
  return decideEvents(env, p.learnerId, p.events, now);
};
async function issue(lessonId: string, outcome: string, created = NOW) {
  const id = crypto.randomUUID();
  await db.prepare('INSERT INTO decisions (id, lesson_id, outcome, created, used) VALUES (?, ?, ?, ?, 0)').bind(id, lessonId, outcome, created).run();
  return id;
}
const answer = (lessonId: string, outcome: string, extra: object = {}) => ({ eventId: eid(), type: 'checkpointAnswered', lessonId, response: 'my answer', outcome, ...extra });
const extOf = (r: any) => r.statements[2].result.extensions[EXT_CHOSEN_BY];

beforeEach(async () => {
  setContentForTests(buildContent('tests/fixtures/content'));
  db = createSqliteD1();
  env = { DB: db };
  await ensureSchema(db);
});

describe('decideEvents', () => {
  it('re-runs code checks server-side and ignores any client "passed"', async () => {
    const [bad, good] = (await decide([
      { eventId: eid(), type: 'codeSubmitted', lessonId: CODE, target: 'checkpoint', file: 'theme.json', files: BAD, passed: true },
      { eventId: eid(), type: 'codeSubmitted', lessonId: CODE, target: 'checkpoint', file: 'theme.json', files: GOOD },
    ])) as any[];
    expect(bad.ok && bad.passed).toBe(false);
    expect(bad.statements).toHaveLength(1);
    expect(bad.statements[0].verb.id).toMatch(/failed/);
    expect(good.passed).toBe(true);
    expect(good.statements[0].verb.id).toMatch(/passed/);
  });

  it('checks a planted bug against its fixChecks', async () => {
    const [r] = (await decide([
      { eventId: eid(), type: 'codeSubmitted', lessonId: 'patterns', target: 'bug', file: 'patterns/hero.php', files: { 'patterns/hero.php': 'Slug: theme/hero' } },
    ])) as any[];
    expect(r.passed).toBe(true);
  });

  it('accepts a judged outcome once per decisionId', async () => {
    const decisionId = await issue(FREE, 'skip');
    const [first] = (await decide([answer(FREE, 'skip', { decisionId })])) as any[];
    expect(first.ok).toBe(true);
    expect(first.chosenBy).toBe('judge');
    expect(first.to).toBe('templates-and-parts');
    expect(first.statements).toHaveLength(3);
    const [second] = (await decide([answer(FREE, 'skip', { decisionId })])) as any[];
    expect(second.ok).toBe(false);
    expect(second.error).toBe('not-allowed');
  });

  it('second use of a decisionId for a fallback outcome falls back to learner-chosen', async () => {
    const decisionId = await issue(FREE, 'advance');
    await decide([answer(FREE, 'advance', { decisionId })]);
    const [r] = (await decide([answer(FREE, 'advance', { decisionId })])) as any[];
    expect(r.ok && r.chosenBy).toBe('learner');
  });

  it('rejects a decisionId issued for another lesson', async () => {
    const decisionId = await issue('ln-what-is-wordpress', 'skip');
    const [r] = (await decide([answer(FREE, 'skip', { decisionId })])) as any[];
    expect(r).toMatchObject({ ok: false, error: 'not-allowed' });
  });

  it('rejects an expired decisionId', async () => {
    const decisionId = await issue(FREE, 'skip', NOW - 31 * 60_000);
    const [r] = (await decide([answer(FREE, 'skip', { decisionId })])) as any[];
    expect(r).toMatchObject({ ok: false, error: 'not-allowed' });
  });

  it('accepts a fallback outcome without a decision and marks it learner-chosen', async () => {
    const [r] = (await decide([answer(FREE, 'review')])) as any[];
    expect(r.ok).toBe(true);
    expect(r.chosenBy).toBe('learner');
    expect(extOf(r)).toBe('learner');
  });

  it('rejects an outcome that is neither judged nor a fallback option', async () => {
    const [r] = (await decide([answer(FREE, 'skip')])) as any[];
    expect(r).toMatchObject({ ok: false, error: 'not-allowed' });
  });

  it('refuses advance on a code checkpoint whose files fail, allows it when they pass, and review always', async () => {
    const [bad, none, good, review] = (await decide([
      answer(CODE, 'advance', { files: BAD }),
      answer(CODE, 'advance'),
      answer(CODE, 'advance', { files: GOOD }),
      answer(CODE, 'review'),
    ])) as any[];
    expect(bad).toMatchObject({ ok: false, error: 'not-allowed' });
    expect(none).toMatchObject({ ok: false, error: 'not-allowed' });
    expect(good).toMatchObject({ ok: true, to: 'patterns' });
    expect(review).toMatchObject({ ok: true, to: 'theme-json-basics' });
  });

  it('one unknown lesson does not sink the batch', async () => {
    const res = (await decide([
      { eventId: eid(), type: 'lessonCompleted', lessonId: 'nope' },
      { eventId: eid(), type: 'lessonCompleted', lessonId: FREE },
      { eventId: eid(), type: 'beatViewed', lessonId: FREE, beatIndex: 99 },
    ])) as any[];
    expect(res[0]).toMatchObject({ ok: false, error: 'unknown-lesson' });
    expect(res[1].ok).toBe(true);
    expect(res[2]).toMatchObject({ ok: false, error: 'invalid' });
  });

  it('same eventId twice yields identical statement ids, real UUIDs', async () => {
    const e = answer(FREE, 'review');
    const [a] = (await decide([e], NOW)) as any[];
    const [b] = (await decide([e], NOW + 5000)) as any[];
    expect(a.statements.map((s: any) => s.id)).toEqual(b.statements.map((s: any) => s.id));
    expect(new Set(a.statements.map((s: any) => s.id)).size).toBe(3);
    for (const s of a.statements) expect(s.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    const [c] = (await decide([{ eventId: eid(), type: 'lessonCompleted', lessonId: FREE }, ])) as any[];
    expect(c.statements[0].id).toBe(await deriveStatementId((c as any).eventId, 0));
  });

  it('validates a placement and emits no statements', async () => {
    const [ok, bad] = (await decide([
      { eventId: eid(), type: 'placed', placement: { pathId: 'block-theme', startLessonId: 'templates-and-parts', skip: [FREE], reason: 'Knows it.' } },
      { eventId: eid(), type: 'placed', placement: { pathId: 'nope' } },
    ])) as any[];
    expect(ok).toMatchObject({ ok: true, statements: [] });
    expect(bad).toMatchObject({ ok: false, error: 'invalid' });
  });
});

describe('decideEvents, review fixes', () => {
  it('replays a judged event with the same eventId as judge-chosen with identical ids', async () => {
    const decisionId = await issue(FREE, 'skip');
    const e = answer(FREE, 'skip', { decisionId });
    const [a] = (await decide([e])) as any[];
    const [b] = (await decide([e])) as any[];
    expect(a.chosenBy).toBe('judge');
    expect(b).toMatchObject({ ok: true, chosenBy: 'judge' });
    expect(b.statements.map((x: any) => x.id)).toEqual(a.statements.map((x: any) => x.id));
    expect(b.statements[2].result.extensions[EXT_CHOSEN_BY]).toBeUndefined();
  });

  it('rejects a decision issued for a different outcome than the one answered', async () => {
    const decisionId = await issue(FREE, 'advance');
    const [r] = (await decide([answer(FREE, 'skip', { decisionId })])) as any[];
    expect(r).toMatchObject({ ok: false, error: 'not-allowed' });
  });

  it('code checkpoint: review and fallback skip are learner-chosen, advance is not', async () => {
    const [rev, skip, adv] = (await decide([answer(CODE, 'review'), answer(CODE, 'skip'), answer(CODE, 'advance', { files: GOOD })])) as any[];
    expect(rev.chosenBy).toBe('learner');
    expect(skip).toMatchObject({ ok: true, chosenBy: 'learner' });
    expect(extOf(skip)).toBe('learner');
    expect(adv.chosenBy).toBeUndefined();
  });

  it('code checkpoint: skip not in the fallback is not-allowed', async () => {
    const cp = getContent().lessons[CODE].checkpoint!;
    const saved = cp.fallback;
    cp.fallback = saved.filter((f) => f.outcome !== 'skip');
    try {
      const [r] = (await decide([answer(CODE, 'skip')])) as any[];
      expect(r).toMatchObject({ ok: false, error: 'not-allowed' });
    } finally {
      cp.fallback = saved;
    }
  });

  it('a database failure propagates instead of becoming a permanent invalid', async () => {
    const decisionId = await issue(FREE, 'skip');
    const broken: Env = { DB: { prepare: () => { throw new Error('db down'); } } as any };
    const p = parseEvents({ learnerId: LEARNER, events: [answer(FREE, 'skip', { decisionId })] });
    if (!p.ok) throw new Error(p.error);
    await expect(decideEvents(broken, p.learnerId, p.events, NOW)).rejects.toThrow('db down');
  });
});

describe('POST /api/events', () => {
  const post = (body: unknown, env2: Env = env) =>
    events(new Request('http://x/api/events', { method: 'POST', body: typeof body === 'string' ? body : JSON.stringify(body) }), { params: {}, env: env2 });

  it('503 disabled when the flag is off', async () => {
    SERVER_FLAGS.serverEvents = false;
    try {
      expect((await post({ learnerId: LEARNER, events: [] })).status).toBe(503);
    } finally {
      SERVER_FLAGS.serverEvents = true;
    }
  });

  it('a database failure during decisions is a 5xx', async () => {
    const decisionId = await issue(FREE, 'skip');
    const flaky: Env = {
      DB: {
        prepare: (sql: string) => {
          if (/UPDATE decisions/.test(sql)) throw new Error('db down');
          return db.prepare(sql);
        },
      } as any,
    };
    const res = await post({ learnerId: LEARNER, events: [answer(FREE, 'skip', { decisionId })] }, flaky);
    expect(res.status).toBe(500);
  });

  it('returns results for a batch', async () => {
    const res = await post({ learnerId: LEARNER, events: [{ eventId: eid(), type: 'lessonCompleted', lessonId: FREE }] });
    expect(res.status).toBe(200);
    const { results } = (await res.json()) as any;
    expect(results[0].ok).toBe(true);
  });

  it('caps batches at 50 events and 256000 bytes', async () => {
    expect(EVENTS_MAX).toBe(50);
    expect(EVENTS_MAX_BYTES).toBe(256_000);
    const one = (i: number) => ({ eventId: `evt-${String(i).padStart(8, '0')}`, type: 'lessonCompleted', lessonId: FREE });
    const fifty = await post({ learnerId: LEARNER, events: Array.from({ length: 50 }, (_, i) => one(i)) });
    expect(fifty.status).toBe(200);
    const fiftyOne = await post({ learnerId: LEARNER, events: Array.from({ length: 51 }, (_, i) => one(i)) });
    expect(fiftyOne.status).toBe(400);
    const big = await post({ learnerId: LEARNER, events: [], pad: 'x'.repeat(EVENTS_MAX_BYTES) });
    expect(big.status).toBe(413);
  });

  it('rejects a non-UUID learnerId and malformed events', async () => {
    expect((await post({ learnerId: 'abc', events: [] })).status).toBe(400);
    expect((await post({ learnerId: LEARNER, events: [{ type: 'lessonCompleted' }] })).status).toBe(400);
    expect((await post('not json')).status).toBe(400);
  });

  it('rate limits at 120 per 10 minutes per client', async () => {
    const req = () => post({ learnerId: LEARNER, events: [] });
    for (let i = 0; i < 120; i++) expect((await req()).status).toBe(200);
    expect((await req()).status).toBe(429);
  });
});

describe('Sensei enrolment on events', () => {
  const placed = (pathId: string) => ({
    eventId: eid(),
    type: 'placed',
    placement: { pathId, startLessonId: Object.values(getContent().paths).find((p) => p.id === pathId)!.lessons[0], skip: [], reason: 'r' },
  });
  const run = (evs: unknown[], enrol: (u: number, k: string) => Promise<void>, wpUserId: number | null = 9) => {
    const p = parseEvents({ learnerId: LEARNER, events: evs });
    if (!p.ok) throw new Error(p.error);
    return decideEvents(env, p.learnerId, p.events, NOW, { wpUserId, connector: { enrol } as any });
  };
  afterEach(() => {
    SERVER_FLAGS.senseiLearners = false;
    enrolHealth.downUntil = 0;
  });
  const rows = async () => (await db.prepare('SELECT wp_user_id, course_key FROM enrolments').all<any>()).results;

  it('enrols once per path', async () => {
    SERVER_FLAGS.senseiLearners = true;
    const enrol = vi.fn(async () => {});
    await run([placed('block-theme'), placed('block-theme')], enrol);
    expect(enrol).toHaveBeenCalledTimes(1);
    expect(enrol).toHaveBeenCalledWith(9, 'block-theme');
    expect((await rows()).map((r) => r.course_key)).toEqual(['block-theme']);
  });

  it('enrols on the first event in a path, by the lesson path', async () => {
    SERVER_FLAGS.senseiLearners = true;
    const enrol = vi.fn(async () => {});
    await run([{ eventId: eid(), type: 'beatViewed', lessonId: CODE, beatIndex: 0 }], enrol);
    expect(enrol).toHaveBeenCalledWith(9, getContent().lessons[CODE].pathId);
  });

  it('enrol failure does not fail the event and is retried on the next event in that path', async () => {
    SERVER_FLAGS.senseiLearners = true;
    const enrol = vi.fn().mockRejectedValueOnce(new Error('down')).mockResolvedValue(undefined);
    const [r1] = (await run([placed('block-theme')], enrol)) as any[];
    expect(r1.ok).toBe(true);
    expect(await rows()).toEqual([]);
    const [r2] = (await run([placed('block-theme')], enrol)) as any[];
    expect(r2.ok).toBe(true);
    expect(enrol).toHaveBeenCalledTimes(2);
    expect(await rows()).toHaveLength(1);
  });

  it('a slow or down connector costs one enrol attempt per batch, then backs off for a minute', async () => {
    SERVER_FLAGS.senseiLearners = true;
    const enrol = vi.fn(async () => {
      throw new ConnectorUnavailable('timeout');
    });
    const lessons = getContent().paths['block-theme'].lessons;
    const batch = () => Array.from({ length: 10 }, () => ({ eventId: eid(), type: 'beatViewed', lessonId: lessons[0], beatIndex: 0 }));
    const results = (await run(batch(), enrol)) as any[];
    expect(results.every((r) => r.ok)).toBe(true);
    expect(enrol).toHaveBeenCalledTimes(1);
    // The next batch within the minute does not wait on the connector at all.
    await run(batch(), enrol);
    expect(enrol).toHaveBeenCalledTimes(1);
    expect(await rows()).toEqual([]);
    // After the minute, the next event tries again.
    const p = parseEvents({ learnerId: LEARNER, events: batch() });
    if (!p.ok) throw new Error(p.error);
    enrol.mockImplementation(async () => {});
    await decideEvents(env, p.learnerId, p.events, NOW + ENROL_RETRY_MS, { wpUserId: 9, connector: { enrol } as any });
    expect(enrol).toHaveBeenCalledTimes(2);
    expect(await rows()).toHaveLength(1);
  });

  it('a refused enrolment is tried once per batch and path, and again on the next batch', async () => {
    SERVER_FLAGS.senseiLearners = true;
    const enrol = vi.fn(async () => {
      throw new ConnectorError(403, 'refused');
    });
    await run([placed('block-theme'), placed('block-theme'), placed('block-theme')], enrol);
    expect(enrol).toHaveBeenCalledTimes(1);
    await run([placed('block-theme')], enrol);
    expect(enrol).toHaveBeenCalledTimes(2);
  });

  it('does nothing with the flag off or without a learner', async () => {
    SERVER_FLAGS.senseiLearners = false;
    const enrol = vi.fn(async () => {});
    await run([placed('block-theme')], enrol);
    SERVER_FLAGS.senseiLearners = true;
    await run([placed('block-theme')], enrol, null);
    expect(enrol).not.toHaveBeenCalled();
    SERVER_FLAGS.senseiLearners = false;
  });
});
