import { describe, expect, it } from 'vitest';
import { resolve } from 'node:path';
import { buildContent } from '../../scripts/build-content';
import { applyEvent, newRecord, parseRecord } from '../../src/shared/record';

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
    ['advance', ['answered', 'passed', 'branched']],
    ['skip', ['answered', 'passed', 'branched']],
    ['review', ['answered', 'failed', 'branched']],
  ] as const)('checkpointAnswered %s', (outcome, expected) => {
    const branch = cp.branches.find((b) => b.outcome === outcome);
    if (!branch) return;
    const r = applyEvent(newRecord(), { type: 'checkpointAnswered', lessonId: withCp, response: 'ans', outcome, to: branch.to }, c);
    expect(verbOf(r)).toEqual(expected);
    expect(r.current?.lessonId).toBe(branch.to);
    expect(r.statements.every((s) => s.actor.account.name === r.learnerId)).toBe(true);
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
