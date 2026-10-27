import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { buildContent } from '../../scripts/build-content';
import type { RecordEvent } from '../../src/shared/record';
import { statementsForEvent } from '../../src/shared/statements';
import { EXT_CHOSEN_BY, EXT_FROM_LESSON, EXT_OUTCOME, XAPI_BASE, activityId, type XapiStatement } from '../../src/shared/xapi';

const c = buildContent(resolve(__dirname, '../fixtures/content'));
const ids = c.paths['block-theme'].lessons;
const withCp = ids.find((id) => c.lessons[id].checkpoint)!;
const cp = c.lessons[withCp].checkpoint!;
const L = 'learner-1';
const strip = (s: XapiStatement) => ({ ...s, id: '', timestamp: '' });
const verbs = (ss: XapiStatement[]) => ss.map((s) => s.verb.id.split('/').pop());

const events: RecordEvent[] = [
  { type: 'beatViewed', lessonId: ids[0], beatIndex: 1 },
  ...(['advance', 'skip', 'review'] as const).map((outcome) => ({
    type: 'checkpointAnswered' as const,
    lessonId: withCp,
    response: 'ans',
    outcome,
    to: cp.branches.find((b) => b.outcome === outcome)!.to,
  })),
  { type: 'codeChecked', lessonId: ids[0], file: 'style.css', passed: true },
  { type: 'codeChecked', lessonId: ids[0], file: 'style.css', passed: false },
  { type: 'lessonCompleted', lessonId: ids[0] },
];

describe('statementsForEvent', () => {
  // Golden output captured from applyEvent as of f251cb6 (before the extraction), ids and timestamps stripped.
  const golden = JSON.parse(readFileSync(resolve(__dirname, '../fixtures/statements-golden.json'), 'utf8')) as Record<
    string,
    { event: RecordEvent; statements: XapiStatement[] }
  >;
  it.each(Object.keys(golden))('matches the pre-extraction applyEvent output for %s', (k) => {
    const { event, statements } = golden[k];
    expect(statementsForEvent(L, event, c).map(strip)).toEqual(statements);
  });
  it('covers an unknown lesson (no parent, name is the id) and a missing beat', () => {
    const unknown = golden.unknownBeat.statements[0];
    expect(unknown.context).toBeUndefined();
    expect(unknown.object.definition?.name['en-US']).toBe('nope');
    expect(golden.missingBeat.statements[0].object.definition?.name['en-US']).toBe('theme.json basics');
  });
  it('checkpointAnswered yields answered, passed|failed, branched in order', () => {
    const e = events.find((x) => x.type === 'checkpointAnswered' && x.outcome === 'review')!;
    expect(verbs(statementsForEvent(L, e, c))).toEqual(['answered', 'failed', 'branched']);
    const e2 = events.find((x) => x.type === 'checkpointAnswered' && x.outcome === 'advance')!;
    expect(verbs(statementsForEvent(L, e2, c))).toEqual(['answered', 'passed', 'branched']);
  });
  it('fileEdited and placed yield nothing', () => {
    expect(statementsForEvent(L, { type: 'fileEdited', file: 'a', content: 'b' }, c)).toEqual([]);
    expect(
      statementsForEvent(L, { type: 'placed', placement: { pathId: 'block-theme', startLessonId: ids[0], skip: [], reason: 'x' } }, c),
    ).toEqual([]);
  });
  it('uses opts.ids in order and opts.timestamp', () => {
    const e = events.find((x) => x.type === 'checkpointAnswered')!;
    const out = statementsForEvent(L, e, c, { ids: ['a', 'b', 'c'], timestamp: '2026-01-01T00:00:00.000Z' });
    expect(out.map((s) => s.id)).toEqual(['a', 'b', 'c']);
    expect(out.every((s) => s.timestamp === '2026-01-01T00:00:00.000Z')).toBe(true);
  });
  it('chosenBy learner marks only the branched statement', () => {
    const e = events.find((x) => x.type === 'checkpointAnswered' && x.outcome === 'advance')! as Extract<RecordEvent, { type: 'checkpointAnswered' }>;
    const out = statementsForEvent(L, e, c, { chosenBy: 'learner' });
    expect(EXT_CHOSEN_BY).toBe(`${XAPI_BASE}/xapi/extensions/chosen-by`);
    expect(out[0].result?.extensions).toBeUndefined();
    expect(out[1].result?.extensions).toBeUndefined();
    expect(out[2].result?.extensions).toEqual({
      [EXT_OUTCOME]: 'advance',
      [EXT_FROM_LESSON]: activityId(['lessons', withCp]),
      [EXT_CHOSEN_BY]: 'learner',
    });
    expect(statementsForEvent(L, e, c, { chosenBy: 'judge' })[2].result?.extensions?.[EXT_CHOSEN_BY]).toBeUndefined();
  });
});
