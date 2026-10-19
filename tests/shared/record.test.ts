import { describe, expect, it } from 'vitest';
import { resolve } from 'node:path';
import { buildContent } from '../../scripts/build-content';
import { applyEvent, newRecord, parseRecord, type RecordEvent } from '../../src/shared/record';
import { XAPI_BASE, validateStatement } from '../../src/shared/xapi';

const c = buildContent(resolve(__dirname, '../fixtures/content'));
const ids = c.paths['block-theme'].lessons;
const withCp = ids.find((id) => c.lessons[id].checkpoint)!;
const cp = c.lessons[withCp].checkpoint!;
const verbOf = (r: ReturnType<typeof newRecord>) => r.statements.map((s) => s.verb.id.split('/').pop());

describe('applyEvent', () => {
  it('is pure and records a placement', () => {
    const r = newRecord();
    const p = { pathId: 'block-theme' as const, startLessonId: ids[1], skip: [ids[0]], reason: 'x' };
    const r2 = applyEvent(r, { type: 'placed', placement: p }, c);
    expect(r.placement).toBeUndefined();
    expect(r2.placement).toEqual(p);
    expect(r2.current).toEqual({ pathId: 'block-theme', lessonId: ids[1], beatIndex: 0 });
  });
  it('beatViewed adds experienced and moves current', () => {
    const r = applyEvent(newRecord(), { type: 'beatViewed', lessonId: ids[0], beatIndex: 1 }, c);
    expect(verbOf(r)).toEqual(['experienced']);
    expect(r.current).toEqual({ pathId: 'block-theme', lessonId: ids[0], beatIndex: 1 });
  });
  it.each([
    ['advance', ['answered', 'passed', 'branched'], true],
    ['skip', ['answered', 'passed', 'branched'], true],
    ['review', ['answered', 'failed', 'branched'], false],
  ] as const)('checkpointAnswered %s', (outcome, expected, success) => {
    const branch = cp.branches.find((b) => b.outcome === outcome);
    expect(branch).toBeDefined();
    const r = applyEvent(newRecord(), { type: 'checkpointAnswered', lessonId: withCp, response: 'ans', outcome, to: branch!.to }, c);
    expect(verbOf(r)).toEqual(expected);
    expect(r.current?.lessonId).toBe(branch!.to);
    expect(r.statements.every((s) => s.actor.account.name === r.learnerId)).toBe(true);
    const [answered, verdict, branched] = r.statements;
    expect(answered.result).toEqual({ response: 'ans' });
    expect(verdict.result).toEqual({ success });
    expect(branched.result?.extensions).toEqual({
      [`${XAPI_BASE}/xapi/extensions/outcome`]: outcome,
      [`${XAPI_BASE}/xapi/extensions/from-lesson`]: `${XAPI_BASE}/activities/lessons/${encodeURIComponent(withCp)}`,
    });
    expect(answered.context?.contextActivities?.parent?.[0].id).toBe(`${XAPI_BASE}/activities/paths/block-theme`);
    expect(r.statements.flatMap((s) => validateStatement(s))).toEqual([]);
  });
  it('every statement from every event type validates and omits version', () => {
    let r = newRecord();
    const evs: RecordEvent[] = [
      { type: 'placed', placement: { pathId: 'block-theme', startLessonId: ids[0], skip: [], reason: 'x' } },
      { type: 'beatViewed', lessonId: ids[0], beatIndex: 0 },
      { type: 'checkpointAnswered', lessonId: withCp, response: 'a', outcome: 'advance', to: ids[1] },
      { type: 'checkpointAnswered', lessonId: withCp, response: 'a', outcome: 'review', to: ids[0] },
      { type: 'codeChecked', lessonId: withCp, file: 'my file #1?.json', passed: true },
      { type: 'codeChecked', lessonId: withCp, file: 'a.json', passed: false },
      { type: 'fileEdited', file: 'a.json', content: 'x' },
      { type: 'lessonCompleted', lessonId: ids[0] },
    ];
    for (const ev of evs) r = applyEvent(r, ev, c);
    expect(r.statements.length).toBeGreaterThan(6);
    for (const st of r.statements) {
      expect(validateStatement(st)).toEqual([]);
      expect('version' in st).toBe(false);
    }
  });
  it('encodes file names in activity ids and the record still parses', () => {
    const r = applyEvent(newRecord(), { type: 'codeChecked', lessonId: withCp, file: 'my file #1?.json', passed: true }, c);
    expect(r.statements[0].object.id).toMatch(/\/files\/my%20file%20%231%3F\.json$/);
    expect(parseRecord(JSON.parse(JSON.stringify(r))).ok).toBe(true);
  });
  it('codeChecked records passed or failed', () => {
    const ok = applyEvent(newRecord(), { type: 'codeChecked', lessonId: withCp, file: 'a.json', passed: true }, c);
    const bad = applyEvent(newRecord(), { type: 'codeChecked', lessonId: withCp, file: 'a.json', passed: false }, c);
    expect(verbOf(ok)).toEqual(['passed']);
    expect(verbOf(bad)).toEqual(['failed']);
  });
  it('lessonCompleted is idempotent', () => {
    const e = { type: 'lessonCompleted' as const, lessonId: ids[0] };
    const r = applyEvent(applyEvent(newRecord(), e, c), e, c);
    expect(verbOf(r)).toEqual(['completed']);
    expect(r.completedLessons).toEqual([ids[0]]);
  });
  it('fileEdited updates files and adds no statement', () => {
    const r = applyEvent(newRecord(), { type: 'fileEdited', file: 'a.html', content: 'x' }, c);
    expect(r.files).toEqual({ 'a.html': 'x' });
    expect(r.statements).toEqual([]);
  });
});

describe('parseRecord', () => {
  const good = () => applyEvent(newRecord(), { type: 'lessonCompleted', lessonId: ids[0] }, c);
  it('round-trips a valid record', () => {
    const r = good();
    expect(parseRecord(JSON.parse(JSON.stringify(r)))).toEqual({ ok: true, record: r });
  });
  it('rejects wrong format', () => {
    const r = parseRecord({ ...good(), format: 'other' });
    expect(r.ok).toBe(false);
  });
  it('rejects a newer version', () => {
    const r = parseRecord({ ...good(), version: 2 });
    expect(r).toEqual({ ok: false, error: expect.stringContaining('This record was made by a newer version') });
  });
  it('rejects invalid statements and non-objects', () => {
    const g = good() as any;
    g.statements[0].verb = {};
    expect(parseRecord(g).ok).toBe(false);
    expect(parseRecord('x').ok).toBe(false);
    expect(parseRecord({ ...good(), files: { a: 1 } }).ok).toBe(false);
  });
});
